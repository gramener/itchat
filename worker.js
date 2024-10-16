import { getAssetFromKV } from "@cloudflare/kv-asset-handler";
import manifestJSON from "__STATIC_CONTENT_MANIFEST";

const assetManifest = JSON.parse(manifestJSON);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (routes[url.pathname]) return await routes[url.pathname]({ url, request, env, ctx });
    try {
      return await getAssetFromKV(
        { request, waitUntil: ctx.waitUntil.bind(ctx) },
        { ASSET_NAMESPACE: env.__STATIC_CONTENT, ASSET_MANIFEST: assetManifest }
      );
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  },
};

const routes = {
  "/token": async ({ url, env }) => {
    const code = url.searchParams.get("code");

    if (!code) {
      const authUrl = `https://accounts.zoho.com/oauth/v2/auth?response_type=code&client_id=${env.SDP_CLIENT_ID}&scope=SDPOnDemand.requests.ALL&redirect_uri=https://itchat.straive.app/token&access_type=offline`;
      return Response.redirect(authUrl, 302);
    }

    const tokenResponse = await fetch("https://accounts.zoho.com/oauth/v2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: env.SDP_CLIENT_ID,
        client_secret: env.SDP_CLIENT_SECRET,
        redirect_uri: "https://itchat.straive.app/token",
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.access_token && tokenData.refresh_token) {
      await env.tokens.put("access_token", tokenData.access_token);
      await env.tokens.put("refresh_token", tokenData.refresh_token);
      return new Response(JSON.stringify(tokenData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else {
      return new Response(JSON.stringify({ error: "Failed to obtain tokens", details: tokenData }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  },

  "/requests": async ({ url, env }) => {
    const email = url.searchParams.get("email");
    const sdpData = await getRequests(env, email);
    return new Response(JSON.stringify(sdpData), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },

  "/request": async ({ url, env }) => {
    let accessToken = await env.tokens.get("access_token");
    if (!accessToken) accessToken = await refreshAccessToken(env);

    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing request ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const sdpUrl = `https://sdpondemand.manageengine.com/app/itdesk/api/v3/requests/${id}`;

    const sdpResponse = await fetch(sdpUrl, {
      method: "GET",
      headers: {
        Accept: "application/vnd.manageengine.sdp.v3+json",
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    });

    if (sdpResponse.status === 401) {
      // Token expired, refresh and retry
      accessToken = await refreshAccessToken(env);
      return routes["/request"]({ url, env }); // Retry with new token
    }

    const sdpData = await sdpResponse.json();
    return new Response(JSON.stringify(sdpData), {
      status: sdpResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  },

  "/googlechat": async ({ request, env }) => {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const body = await request.json();
    let response;

    switch (body.type) {
      case "MESSAGE": {
        // Extract email from message text or use sender's email
        const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
        const emailMatch = body.message.text.match(emailRegex);
        const email = emailMatch ? emailMatch[0] : body.message.sender.email;

        const sdpData = await getRequests(env, email);
        const ticketSummary = sdpData.requests
          .map(
            (r) => `Link: https://servicedesk.straive.com/app/itdesk/ui/requests/${r.id}/details
Subject: ${r.subject}
Status: ${r.status.name}
Technician: ${r.technician?.email_id || "N/A"}
Created: ${r.created_time.display_value}
Due By: ${r.due_by_time?.display_value || "N/A"}`
          )
          .join("\n\n");

        // Fetch AI response
        const aiResponse = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.LLMFOUNDRY_TOKEN}:itchat.straive.app`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are a helpful customer service agent.
Explain to the user if they have any open tickets and when they'll get resolved.
If none are open, explain the status of their most recent ticket or two.
Here is the status of the user's tickets.`,
              },
              { role: "user", content: ticketSummary },
            ],
          }),
        });
        const aiData = await aiResponse.json();
        const summary = aiData.choices?.[0]?.message?.content ?? (aiData.error ? JSON.stringify(aiData.error) : "Unable to generate summary");
        const formattedSummary = summary
          .replace(/\[([^\]]+)\]\((https?:\/\/[^\s]+)\)/g, "<$2|$1>") // Replace Markdown links with Google Chat format
          .replace(/\*\*(.*?)\*\*/g, "*$1*"); // Replace bold (**) with italics (*) for emphasis
        response = {
          text:
            formattedSummary +
            (sdpData.requests.length == 0
              ? "\n\nPS: This app no longer works because the API account s.anand@straive.com does not have access to the IT tickets."
              : ""),
        };
        break;
      }
      case "ADDED_TO_SPACE":
        response = {
          text: `Thanks for adding me${
            body.space.type === "ROOM" ? " to " + body.space.displayName : ""
          }! Type '@IT Chat - Straive help' to see what I can do.`,
        };
        break;
      case "REMOVED_FROM_SPACE":
        // Bot removed from ${body.space.name}
        return new Response(null, { status: 200 });
      default:
        response = { text: "Unsupported event type" };
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
};

async function getRequests(env, email) {
  let accessToken = await env.tokens.get("access_token");
  if (!accessToken) accessToken = await refreshAccessToken(env);

  let inputData = {
    list_info: {
      row_count: "10",
      start_index: "1",
      sort_field: "created_time",
      sort_order: "desc",
      get_total_count: "true",
      fields_required: ["id", "display_id", "subject", "status", "technician", "created_time", "due_by_time"],
    },
  };

  if (email) {
    inputData.list_info.search_criteria = {
      field: "requester.email_id",
      condition: "is",
      value: email,
    };
  }

  const encodedInputData = encodeURIComponent(JSON.stringify(inputData));
  const sdpUrl = `https://sdpondemand.manageengine.com/app/itdesk/api/v3/requests?input_data=${encodedInputData}`;

  const sdpResponse = await fetch(sdpUrl, {
    method: "GET",
    headers: {
      Accept: "application/vnd.manageengine.sdp.v3+json",
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });

  if (sdpResponse.status === 401) {
    // Token expired, refresh and retry
    accessToken = await refreshAccessToken(env);
    return getRequests(env, email); // Retry with new token
  }

  return await sdpResponse.json();
}

async function refreshAccessToken(env) {
  const refreshToken = await env.tokens.get("refresh_token");
  if (!refreshToken) {
    throw new Error("No refresh token found");
  }

  const response = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      client_id: env.SDP_CLIENT_ID,
      client_secret: env.SDP_CLIENT_SECRET,
      redirect_uri: "https://itchat.straive.app/token",
    }),
  });

  const tokenData = await response.json();

  if (tokenData.access_token) {
    await env.tokens.put("access_token", tokenData.access_token);
    return tokenData.access_token;
  } else {
    throw new Error("Failed to refresh access token");
  }
}
