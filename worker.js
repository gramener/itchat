export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (routes[url.pathname]) return await routes[url.pathname](request, env, ctx);
    return new Response(null, { status: 404 });
  },
};

const routes = {
  "/token": async (request, env) => {
    const url = new URL(request.url);
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
      return new Response("Tokens stored successfully", { status: 200 });
    } else {
      return new Response("Failed to obtain tokens", { status: 400 });
    }
  },

  "/requests": async (request, env) => {
    let accessToken = await env.tokens.get("access_token");
    if (!accessToken) accessToken = await refreshAccessToken(env);

    const inputData = {
      list_info: {
        row_count: "100",
        start_index: "1",
        sort_field: "created_time",
        sort_order: "desc",
      },
    };

    const encodedInputData = encodeURIComponent(JSON.stringify(inputData));
    const url = `https://sdpondemand.manageengine.com/app/itdesk/api/v3/requests?input_data=${encodedInputData}`;

    const sdpResponse = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.manageengine.sdp.v3+json",
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    });

    if (sdpResponse.status === 401) {
      // Token expired, refresh and retry
      accessToken = await refreshAccessToken(env);
      return routes["/requests"](request, env); // Retry with new token
    }

    const sdpData = await sdpResponse.json();
    return new Response(JSON.stringify(sdpData), {
      status: sdpResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  },
};

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
