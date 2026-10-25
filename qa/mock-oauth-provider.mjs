import { appendFileSync } from "node:fs";

const logPath = process.env.POSTLY_OAUTH_MOCK_LOG;
let lastInstagramCode = "";

function bodyParams(body) {
  if (body instanceof URLSearchParams) return body;
  if (typeof body === "string") return new URLSearchParams(body);
  return new URLSearchParams();
}

function record(url, options, params) {
  if (!logPath) return;
  const row = {
    host: url.hostname,
    path: url.pathname,
    method: options.method || "GET",
    redirectUri: params.get("redirect_uri") || "",
    grantType: params.get("grant_type") || "",
    clientIdPresent: params.has("client_id") || params.has("client_key"),
    clientSecretPresent: params.has("client_secret"),
    codePresent: params.has("code"),
    tokenPresent: params.has("token"),
    accessTokenQueryPresent: url.searchParams.has("access_token"),
    bearerHeaderPresent: Boolean(options.headers?.authorization),
  };
  appendFileSync(logPath, `${JSON.stringify(row)}\n`, { mode: 0o600 });
}

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  const params = bodyParams(options.body);
  record(url, options, params);
  const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

  if (url.hostname === "api.instagram.com" && url.pathname === "/oauth/access_token") {
    lastInstagramCode = params.get("code") || "";
    if (lastInstagramCode === "synthetic-exchange-error") return response({ error_type: "OAuthException", error_message: "synthetic-private-provider-detail", access_token: "synthetic-private-token" }, 400);
    return response({ access_token: "mock-instagram-short-token", user_id: "mock-ig-id", username: "mock.ig", permissions: ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments", "instagram_business_manage_insights"] });
  }
  if (url.hostname === "graph.instagram.com" && url.pathname === "/access_token") {
    if (lastInstagramCode === "synthetic-long-lived-failure") return response({ error: { code: "temporarily_unavailable", message: "synthetic-private-provider-detail" } }, 503);
    return response({ access_token: "mock-instagram-long-token", token_type: "bearer", expires_in: lastInstagramCode === "synthetic-expiring-code" ? 1 : 5_184_000 });
  }
  if (url.hostname === "graph.instagram.com" && url.pathname === "/me") {
    return response({ id: "mock-ig-id", username: "mock.ig" });
  }
  if (url.hostname === "open.tiktokapis.com" && url.pathname === "/v2/oauth/token/") {
    const grantType = params.get("grant_type");
    if (grantType === "refresh_token" && params.get("refresh_token") === "mock-tiktok-revoked-refresh") return response({ error: "invalid_grant", error_description: "synthetic-private-provider-detail" }, 400);
    const revoked = grantType === "authorization_code" && params.get("code") === "synthetic-revoked-tiktok";
    return response({ access_token: "mock-tiktok-access-token", refresh_token: revoked ? "mock-tiktok-revoked-refresh" : "mock-tiktok-refresh-token", expires_in: grantType === "authorization_code" && ["synthetic-expiring-tiktok", "synthetic-revoked-tiktok"].includes(params.get("code")) ? 1 : 86_400, refresh_expires_in: 31_536_000, scope: "user.info.basic,user.info.profile,user.info.stats,video.list,video.publish", open_id: "mock-tt-id" });
  }
  if (url.hostname === "open.tiktokapis.com" && url.pathname === "/v2/user/info/") {
    return response({ data: { user: { open_id: "mock-tt-id", display_name: "Mock TikTok" } }, error: { code: "ok" } });
  }
  if (url.hostname === "open.tiktokapis.com" && url.pathname === "/v2/post/publish/creator_info/query/") {
    return response({ data: { creator_username: "mock.tiktok", creator_nickname: "Mock TikTok", privacy_level_options: ["SELF_ONLY"], comment_disabled: false, duet_disabled: false, stitch_disabled: false, max_video_post_duration_sec: 300 }, error: { code: "ok" } });
  }
  if (url.hostname === "open.tiktokapis.com" && url.pathname === "/v2/oauth/revoke/") {
    return response({ error: { code: "ok", message: "" } });
  }
  if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
    return response({ access_token: "mock-youtube-access-token", refresh_token: "mock-youtube-refresh-token", expires_in: 3599, scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/yt-analytics.readonly" });
  }
  if (url.hostname === "www.googleapis.com" && url.pathname === "/youtube/v3/channels") {
    return response({ items: [{ id: "mock-youtube-channel-id", snippet: { title: "Mock YouTube Channel" } }] });
  }
  if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/revoke") return new Response(null, { status: 200 });

  throw new Error(`Unexpected external request in OAuth mock: ${url.hostname}${url.pathname}`);
};
