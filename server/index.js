import { createServer } from "node:http";
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const envFile = join(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const entry = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (entry && !process.env[entry[1]]) process.env[entry[1]] = entry[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
const dataDir = process.env.POSTLY_DATA_DIR || join(root, ".postly-data");
const accountFile = join(dataDir, "accounts.enc");
const stateFile = join(dataDir, "state");
const states = new Map();
const providers = {
  instagram: { name: "Instagram", id: "INSTAGRAM_CLIENT_ID", secret: "INSTAGRAM_CLIENT_SECRET" },
  tiktok: { name: "TikTok", id: "TIKTOK_CLIENT_KEY", secret: "TIKTOK_CLIENT_SECRET" },
  youtube: { name: "YouTube", id: "YOUTUBE_CLIENT_ID", secret: "YOUTUBE_CLIENT_SECRET" },
};
const mimeTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

function json(response, status = 200) {
  return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function getEncryptionKey() {
  if (process.env.TOKEN_ENCRYPTION_KEY) {
    const secret = process.env.TOKEN_ENCRYPTION_KEY;
    const key = /^[\da-f]{64}$/i.test(secret) ? Buffer.from(secret, "hex") : Buffer.from(secret, "base64");
    if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes (64 hex characters or base64).");
    return key;
  }
  if (process.env.NODE_ENV === "production") throw new Error("TOKEN_ENCRYPTION_KEY is required in production.");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (!existsSync(stateFile)) writeFileSync(stateFile, randomBytes(32), { mode: 0o600, flag: "wx" });
  return readFileSync(stateFile);
}

function readAccounts() {
  if (!existsSync(accountFile)) return {};
  const envelope = JSON.parse(readFileSync(accountFile, "utf8"));
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8"));
}

function writeAccounts(accounts) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(accounts), "utf8"), cipher.final()]);
  const tempFile = `${accountFile}.${randomUUID()}.tmp`;
  writeFileSync(tempFile, JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600 });
  chmodSync(tempFile, 0o600);
  renameSync(tempFile, accountFile);
}

function appBaseUrl(request) {
  return (process.env.APP_BASE_URL || `${new URL(request.url).protocol}//${new URL(request.url).host}`).replace(/\/$/, "");
}

function callbackUrl(request, provider) {
  const base = (process.env.OAUTH_REDIRECT_BASE || appBaseUrl(request)).replace(/\/$/, "");
  return `${base}/api/social/${provider}/callback`;
}

function isConfigured(provider) {
  const config = providers[provider];
  return Boolean(config && process.env[config.id] && process.env[config.secret]);
}

function publicStatus() {
  let accounts = {};
  try { accounts = readAccounts(); } catch { /* Keep status useful if the local token file is damaged. */ }
  return Object.fromEntries(Object.entries(providers).map(([key, value]) => [key, {
    name: value.name,
    configured: isConfigured(key),
    connected: Boolean(accounts[key]?.accessToken),
    profile: accounts[key]?.profile || "",
    connectedAt: accounts[key]?.connectedAt || null,
  }]));
}

function authorizationUrl(provider, request) {
  const redirectUri = callbackUrl(request, provider);
  const state = randomBytes(24).toString("base64url");
  states.set(state, { provider, createdAt: Date.now() });
  const config = providers[provider];
  const id = process.env[config.id];
  let url;
  if (provider === "instagram") {
    url = new URL("https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({ client_id: id, redirect_uri: redirectUri, response_type: "code", scope: "instagram_business_basic,instagram_business_content_publish", state }).toString();
  } else if (provider === "tiktok") {
    url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.search = new URLSearchParams({ client_key: id, redirect_uri: redirectUri, response_type: "code", scope: "user.info.basic,video.publish", state }).toString();
  } else {
    url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: id, redirect_uri: redirectUri, response_type: "code", scope: "https://www.googleapis.com/auth/youtube.upload", access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
  }
  return url.toString();
}

async function exchangeCode(provider, code, request) {
  const config = providers[provider];
  const redirectUri = callbackUrl(request, provider);
  let accessToken, refreshToken, expiresIn, profile;
  if (provider === "instagram") {
    const form = new URLSearchParams({ client_id: process.env[config.id], client_secret: process.env[config.secret], grant_type: "authorization_code", redirect_uri: redirectUri, code });
    const response = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok || !result.access_token) throw new Error(result.error_message || "Instagram token exchange failed.");
    accessToken = result.access_token;
    profile = result.user?.username || result.username || `Instagram account ${result.user_id || result.id || "connected"}`;
    try {
      const longLivedUrl = new URL("https://graph.instagram.com/access_token");
      longLivedUrl.search = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: process.env[config.secret], access_token: accessToken }).toString();
      const longLivedResponse = await fetch(longLivedUrl);
      const longLived = await longLivedResponse.json();
      if (longLivedResponse.ok && longLived.access_token) { accessToken = longLived.access_token; expiresIn = longLived.expires_in; }
    } catch { /* The short-lived token remains usable; the UI will show its shorter expiry. */ }
    try {
      const profileUrl = new URL("https://graph.instagram.com/me");
      profileUrl.search = new URLSearchParams({ fields: "id,username", access_token: accessToken }).toString();
      const profileResponse = await fetch(profileUrl);
      const profileData = await profileResponse.json();
      if (profileResponse.ok && profileData.username) profile = profileData.username;
    } catch { /* The connected account remains usable without a display name. */ }
  } else if (provider === "tiktok") {
    const form = new URLSearchParams({ client_key: process.env[config.id], client_secret: process.env[config.secret], code, grant_type: "authorization_code", redirect_uri: redirectUri });
    const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
    const result = await response.json();
    if (!response.ok || !result.access_token) throw new Error(result.error_description || "TikTok token exchange failed.");
    accessToken = result.access_token; refreshToken = result.refresh_token; expiresIn = result.expires_in;
    profile = result.open_id || "TikTok account connected";
    try {
      const info = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username", { headers: { authorization: `Bearer ${accessToken}` } });
      const body = await info.json();
      profile = body.data?.user?.display_name || body.data?.user?.username || profile;
    } catch { /* Keep the account identifier if optional profile lookup fails. */ }
  } else {
    const form = new URLSearchParams({ client_id: process.env[config.id], client_secret: process.env[config.secret], code, grant_type: "authorization_code", redirect_uri: redirectUri });
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
    const result = await response.json();
    if (!response.ok || !result.access_token) throw new Error(result.error_description || "Google token exchange failed.");
    accessToken = result.access_token; refreshToken = result.refresh_token; expiresIn = result.expires_in;
    const channelResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: `Bearer ${accessToken}` } });
    const channelData = await channelResponse.json();
    if (!channelResponse.ok) throw new Error("Google authorized successfully, but the YouTube channel could not be read.");
    profile = channelData.items?.[0]?.snippet?.title || "YouTube channel connected";
  }
  const accounts = readAccounts();
  accounts[provider] = { accessToken, refreshToken, profile, expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null, connectedAt: new Date().toISOString() };
  writeAccounts(accounts);
}

function redirectToApp(request, key, message) {
  const target = new URL(appBaseUrl(request));
  target.searchParams.set(key, message);
  return Response.redirect(target.toString(), 303);
}

async function api(request, url) {
  if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, app: "Postly" });
  if (url.pathname === "/api/social/status" && request.method === "GET") return json({ providers: publicStatus() });
  const match = url.pathname.match(/^\/api\/social\/(instagram|tiktok|youtube)\/(connect|callback|disconnect)$/);
  if (!match) return json({ error: "API route not found." }, 404);
  const [, provider, action] = match;
  if (action === "connect" && request.method === "GET") {
    if (!isConfigured(provider)) return json({ error: `${providers[provider].name} OAuth credentials are not configured on this server.` }, 503);
    return Response.redirect(authorizationUrl(provider, request), 302);
  }
  if (action === "callback" && request.method === "GET") {
    const state = url.searchParams.get("state");
    const stateInfo = state && states.get(state);
    if (state) states.delete(state);
    if (!stateInfo || stateInfo.provider !== provider || Date.now() - stateInfo.createdAt > 10 * 60 * 1000) return redirectToApp(request, "social_error", "invalid_state");
    if (url.searchParams.has("error")) return redirectToApp(request, "social_error", "authorization_denied");
    const code = url.searchParams.get("code");
    if (!code) return redirectToApp(request, "social_error", "missing_code");
    try { await exchangeCode(provider, code, request); return redirectToApp(request, "connected", provider); }
    catch (error) { console.error(`${providers[provider].name} OAuth callback failed:`, error.message); return redirectToApp(request, "social_error", `${provider}_exchange_failed`); }
  }
  if (action === "disconnect" && request.method === "POST") {
    const accounts = readAccounts();
    const account = accounts[provider];
    if (!account) return json({ ok: true });
    if (provider === "youtube" || provider === "tiktok") {
      const endpoint = provider === "youtube" ? "https://oauth2.googleapis.com/revoke" : "https://open.tiktokapis.com/v2/oauth/revoke/";
      const params = provider === "youtube" ? { token: account.refreshToken || account.accessToken } : { client_key: process.env[providers[provider].id], client_secret: process.env[providers[provider].secret], token: account.accessToken };
      try { await fetch(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) }); } catch { /* Local disconnection still removes the stored credential. */ }
    }
    delete accounts[provider]; writeAccounts(accounts); return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, 405);
}

async function handle(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    try { return await api(request, url); }
    catch (error) { console.error("Postly API error:", error.message); return json({ error: "The account connection could not be completed." }, 500); }
  }
  if (process.env.API_ONLY === "1") return new Response("Not found", { status: 404 });
  const clientRoot = join(root, "dist", "client");
  let relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\]|\.\.(?:[/\\]|$))+/, "");
  if (!relative || relative === ".") relative = "index.html";
  let filePath = join(clientRoot, relative);
  if (!filePath.startsWith(clientRoot)) return new Response("Not found", { status: 404 });
  if (!existsSync(filePath) || !readFileSync(filePath).length) {
    if (request.headers.get("accept")?.includes("text/html")) filePath = join(clientRoot, "index.html");
    else return new Response("Not found", { status: 404 });
  }
  const body = readFileSync(filePath);
  return new Response(body, { headers: { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" } });
}

const port = Number(process.env.PORT || 4174);
const server = createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://${incoming.headers.host || `localhost:${port}`}${incoming.url}`, { method: incoming.method, headers: incoming.headers, body: ["GET", "HEAD"].includes(incoming.method) ? undefined : body, duplex: "half" });
  const response = await handle(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(port, process.env.API_ONLY === "1" ? "127.0.0.1" : "0.0.0.0", () => console.log(`Postly ${process.env.API_ONLY === "1" ? "OAuth API" : "app"} listening on http://localhost:${port}`));
