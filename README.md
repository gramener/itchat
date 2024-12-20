# IT Chat

A Google Chat bot for IT Tickets on Zoho ServiceDesk Platform at Straive.

It answers questions based on the user's IT tickets.

To use it:

1. Add "IT Chat - Straive" to your chat or space. Contact <s.anand@gramener.com> if this is not visible to you.
2. DM it saying something, e.g. "@IT Chat - Straive Help". It'll share the status of your tickets.

## Setup

- In the [Zoho API Console](https://api-console.zoho.com/add) log in as sdpaitest@straive.com (via email OTP forwarded to s.anand@gramener.com) and add a client for "Server Based Applications" with:
  - Client name: IT Chat LLM App
  - Homepage URL: https://itchat.straive.app/
  - Redirect URIs: https://itchat.straive.app/token
- Configure the [Chat API in Straive-Internal Apps project on Google Cloud Console](https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat?authuser=2&project=it-chatbot-443909) <!-- It was earlier set up at project=straive-internal-apps but moved because it was not under the Straive organization -->
  - App Name: IT Chat - Straive
  - Avatar URL: `https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSCPpb1Hpdia-kMDmeGQOCgxplz2m_EUPbWsw&s`
  - Description: Check your Service Desk ticket status
  - Interactive features: Enable everything
  - Connection Settings: HTTP endpoint URL
  - HTTP endpoint URL: `https://itchat.straive.app/googlechat`
  - App home URL: `https://itchat.straive.app/`
  - Authentication audience: HTTP endpoint URL
  - Visibility: Make chat available to specific people and groups in Straive.com (add users)
  - Logs: Log errors to Logging
- Add members via [Straive IT Chat mailing group](https://groups.google.com/u/2/a/gramener.com/g/straive-it-chat/members)
- Log into <https://dash.cloudflare.com/> as <root.node@gmail.com>
  - Create a worker called `itchat` with a custom domain `itchat.straive.app`
  - Clone [this repository](https://github.com/gramener/itchat)
  - Run `npm install`
  - Run `npx wrangler kv namespace create "tokens"` to create a namespace and add the binding to `wrangler.toml`
  - Run `npx wrangler secret put <key>` also add them to `.dev.vars` as `KEY=value`:
    - `SDP_CLIENT_ID`: Via [Zoho API Console](https://api-console.zoho.com/add)
    - `SDP_CLIENT_SECRET`: Via [Zoho API Console](https://api-console.zoho.com/add)
    - `LLMFOUNDRY_TOKEN`: Via [LLM Foundry](https://llmfoundry.straive.com/code)
- Run `npm run deploy` to deploy on Cloudflare
- Visit <https://itchat.straive.app/token> as admin to save the `refresh_token` and initialize the app

## Authentication flow

When the admin visits /token, they

https://accounts.zoho.com/oauth/v2/auth?response_type=code&client_id=$SDP_CLIENT_ID&scope=SDPOnDemand.requests.ALL&redirect_uri=https://itchat.straive.app/token&access_type=offline

When they log in, it will redirect them to /token with a `?code=$grant_token`. Store the grant_token.

Using the code, send a request to:

```bash
curl -i https://accounts.zoho.com/oauth/v2/token \
  -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "code=$grant_token" \
  -d "grant_type=authorization_code" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "redirect_uri=https://itchat.straive.app/token"
```

This returns a JSON object with keys `access_token`, `refresh_token`.

Store the `access_token` and `refresh_token` in Cloudflare KV "tokens" namespace.

When the token expires, use the refresh token to get a new access token:

```bash
curl https://accounts.zoho.com/oauth/v2/token \
  -X POST   \
  -H "Content-Type: application/x-www-form-urlencoded"  \
  -d "refresh_token=$refresh_token"  \
  -d "grant_type=refresh_token" \
  -d "client_id=$SDP_CLIENT_ID" \
  -d "client_secret=$SDP_CLIENT_SECRET" \
  -d "redirect_uri=https://itchat.straive.app/token"
```

Links:

- [Zoho Accounts - Connected Apps](https://accounts.zoho.com/home#sessions/userapplogins) to check connected apps.
  - Disconnect existing app to generate a new refresh token.
- [Zoho API Console](https://api-console.zoho.com/add) to create a client.
