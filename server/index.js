import { createServer } from "node:http";
import { isIP } from "node:net";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { readPublicMediaAsset, queryTikTokCreatorInfo, publishToProvider, PublishError, queryTikTokPublishStatus } from "./social-publishing.js";
import { cleanupExpiredPublicMediaAssets } from "./social-publishing.js";
import { createPublicMediaResponse } from "./public-media-http.js";
import { fetchProviderCommunity, fetchProviderInsights, replyToProviderComment, addProviderSummary } from "./social-data.js";
import { createScheduledDelivery } from "./scheduled-delivery.js";
import { handleScheduledDeliveryApi } from "./scheduled-delivery-api.js";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const envFile = join(root, ".env.local");
if (process.env.POSTLY_DISABLE_ENV_FILE !== "1" && existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const entry = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (entry && process.env[entry[1]] === undefined) process.env[entry[1]] = entry[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
const dataDir = process.env.POSTLY_DATA_DIR || join(root, ".postly-data");
const accountFile = join(dataDir, "accounts.enc");
const stateFile = join(dataDir, "state");
const states = new Map();
const oauthStateLifetimeMs = 10 * 60 * 1000;
const oauthStateCookiePath = provider => `/api/social/${provider}/callback`;
const oauthStateCookieName = provider => `postly_oauth_state_${provider}`;
const providers = {
  instagram: { name: "Instagram", id: "INSTAGRAM_CLIENT_ID", secret: "INSTAGRAM_CLIENT_SECRET" },
  tiktok: { name: "TikTok", id: "TIKTOK_CLIENT_KEY", secret: "TIKTOK_CLIENT_SECRET" },
  youtube: { name: "YouTube", id: "YOUTUBE_CLIENT_ID", secret: "YOUTUBE_CLIENT_SECRET" },
};
const providerScopes = {
  instagram: ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments", "instagram_business_manage_insights"],
  tiktok: ["user.info.basic", "user.info.profile", "user.info.stats", "video.list", "video.publish"],
  youtube: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/yt-analytics.readonly"],
};
const providerPublishScopes = {
  instagram: ["instagram_business_basic", "instagram_business_content_publish"],
  tiktok: ["user.info.basic", "video.publish"],
  youtube: ["https://www.googleapis.com/auth/youtube.upload"],
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
  chmodSync(stateFile, 0o600);
  return readFileSync(stateFile);
}

function readAccounts() {
  if (!existsSync(accountFile)) return {};
  const envelope = JSON.parse(readFileSync(accountFile, "utf8"));
  if (!envelope || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") throw new Error("The encrypted account store is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const accounts = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8"));
  if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) throw new Error("The encrypted account store does not contain an account map.");
  return accounts;
}

function writeAccounts(accounts) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(accounts), "utf8"), cipher.final()]);
  const tempFile = `${accountFile}.${randomUUID()}.tmp`;
  writeFileSync(tempFile, JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600 });
  chmodSync(tempFile, 0o600);
  renameSync(tempFile, accountFile);
}

function isLoopbackHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
}

function parseBaseUrl(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new PublishError(`${label} must be an absolute HTTP or HTTPS origin.`, 500, "oauth_configuration_error"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new PublishError(`${label} must be an HTTP or HTTPS origin with no path, query, or credentials.`, 500, "oauth_configuration_error");
  }
  if (parsed.protocol !== "https:" && !isLoopbackHostname(parsed.hostname)) {
    throw new PublishError(`${label} must use HTTPS outside localhost.`, 500, "oauth_configuration_error");
  }
  return parsed.origin;
}

function appBaseUrl(request) {
  if (process.env.APP_BASE_URL?.trim()) return parseBaseUrl(process.env.APP_BASE_URL.trim(), "APP_BASE_URL");
  if (process.env.NODE_ENV === "production") throw new PublishError("APP_BASE_URL must be set for production OAuth callbacks.", 500, "oauth_configuration_error");
  const origin = new URL(request.url).origin;
  const parsed = new URL(origin);
  if (!isLoopbackHostname(parsed.hostname)) throw new PublishError("APP_BASE_URL must be set before accepting OAuth requests on a non-local host.", 500, "oauth_configuration_error");
  return origin;
}

function callbackBaseUrl(request) {
  const configured = process.env.OAUTH_REDIRECT_BASE?.trim();
  return configured ? parseBaseUrl(configured, "OAUTH_REDIRECT_BASE") : appBaseUrl(request);
}

function callbackUrl(request, provider) {
  const base = callbackBaseUrl(request);
  return `${base}/api/social/${provider}/callback`;
}

function requiredEnvironmentKeys(provider) {
  const config = providers[provider];
  return config ? [config.id, config.secret] : [];
}

function missingEnvironmentKeys(provider) {
  return requiredEnvironmentKeys(provider).filter(key => !process.env[key]?.trim());
}

function isConfigured(provider) {
  return Boolean(providers[provider] && missingEnvironmentKeys(provider).length === 0);
}

function publicStatus(request) {
  let accounts = {};
  let accountStoreAvailable = true;
  try { accounts = readAccounts(); } catch { accountStoreAvailable = false; }
  return Object.fromEntries(Object.entries(providers).map(([key, value]) => {
    const requiredKeys = requiredEnvironmentKeys(key);
    const missingKeys = missingEnvironmentKeys(key);
    const account = accounts[key] || {};
    const hasToken = Boolean(account.accessToken);
    const now = Date.now();
    const expiresAt = Number.isFinite(account.expiresAt) ? account.expiresAt : null;
    const refreshExpiresAt = Number.isFinite(account.refreshExpiresAt) ? account.refreshExpiresAt : null;
    const accessTokenExpired = expiresAt !== null && expiresAt <= now;
    const accessTokenExpiryUnknown = hasToken && expiresAt === null;
    const refreshCredentialAvailable = key === "instagram"
      ? expiresAt !== null && !accessTokenExpired
      : Boolean(account.refreshToken) && (key !== "tiktok" || refreshExpiresAt === null || refreshExpiresAt > now);
    const needsReauthorization = Boolean(account.reauthorizationRequired) || (key === "instagram" && accessTokenExpiryUnknown) || (hasToken && accessTokenExpired && !refreshCredentialAvailable);
    const connected = accountStoreAvailable ? hasToken && !needsReauthorization : null;
    let redirectUri = null;
    let configurationError = null;
    try { redirectUri = callbackUrl(request, key); }
    catch (error) { configurationError = error.code || "oauth_configuration_error"; }
    const grantedScopes = Array.isArray(account.scopes) ? account.scopes : [];
    return [key, {
      name: value.name,
      configured: missingKeys.length === 0,
      connected,
      readyToConnect: accountStoreAvailable && (!hasToken || needsReauthorization) && missingKeys.length === 0 && !configurationError,
      error: accountStoreAvailable ? configurationError : "account_store_unavailable",
      connectionState: !accountStoreAvailable ? "unknown" : !hasToken ? "disconnected" : needsReauthorization ? "reauthorization_required" : accessTokenExpiryUnknown ? "expiry_unknown" : accessTokenExpired ? "refresh_required" : "connected",
      accessTokenExpired,
      accessTokenExpiryUnknown,
      expiresAt,
      refreshExpiresAt,
      refreshCredentialAvailable,
      needsReauthorization,
      publishReady: hasToken && !needsReauthorization ? (account.scopesKnown ? providerPublishScopes[key].every(scope => grantedScopes.includes(scope)) : null) : false,
      requiredEnvironmentKeys: requiredKeys,
      missingEnvironmentKeys: missingKeys,
      profile: account.profile || "",
      connectedAt: account.connectedAt || null,
      scopes: grantedScopes,
      scopesKnown: Boolean(account.scopesKnown),
      missingPublishScopes: account.scopesKnown ? providerPublishScopes[key].filter(scope => !grantedScopes.includes(scope)) : [],
      redirectUri,
    }];
  }));
}

function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new PublishError("This request did not come from Postly.", 403, "origin_rejected");
  let requestedOrigin;
  try { requestedOrigin = new URL(origin).origin; } catch { throw new PublishError("This request did not come from Postly.", 403, "origin_rejected"); }
  const expectedOrigin = appBaseUrl(request);
  if (requestedOrigin !== expectedOrigin) throw new PublishError("This request did not come from Postly.", 403, "origin_rejected");
}

function providerNeedsReauthorization(error) {
  return error?.status === 401 || String(error?.code) === "190" || ["invalid_grant", "invalid_token", "reconnect_required", "unauthorized"].includes(String(error?.code).toLowerCase());
}

function accountChanged(previous = {}, next = {}) {
  return ["accessToken", "refreshToken", "expiresAt", "refreshExpiresAt", "tokenIssuedAt", "reauthorizationRequired", "userId", "profile", "scopesKnown"]
    .some(key => previous[key] !== next[key]) || JSON.stringify(previous.scopes || []) !== JSON.stringify(next.scopes || []);
}

async function withProviderAccount(accounts, provider, operation) {
  try { return await operation(); }
  catch (error) {
    if (providerNeedsReauthorization(error) && accounts[provider]?.accessToken) {
      accounts[provider] = { ...accounts[provider], reauthorizationRequired: true };
      writeAccounts(accounts);
    }
    throw error;
  }
}

async function publishedMediaResponse(request, url) {
  return createPublicMediaResponse(request, url, id => readPublicMediaAsset(id, dataDir));
}

function appAuthenticationEnabled() {
  return process.env.POSTLY_TRUST_PROXY_BASIC_AUTH !== "1"
    && Boolean(process.env.POSTLY_BASIC_AUTH_USER || process.env.POSTLY_BASIC_AUTH_PASSWORD);
}

function hasValidBasicAuthentication(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return false;
  let supplied;
  try { supplied = Buffer.from(match[1], "base64"); }
  catch { return false; }
  const separator = supplied.indexOf(58);
  if (separator < 0) return false;
  const expectedUser = Buffer.from(process.env.POSTLY_BASIC_AUTH_USER || "", "utf8");
  const expectedPassword = Buffer.from(process.env.POSTLY_BASIC_AUTH_PASSWORD || "", "utf8");
  const candidate = createHash("sha256").update(supplied.subarray(0, separator)).update(Buffer.from([0])).update(supplied.subarray(separator + 1)).digest();
  const expected = createHash("sha256").update(expectedUser).update(Buffer.from([0])).update(expectedPassword).digest();
  return timingSafeEqual(candidate, expected);
}

function needsAppAuthentication(request, url) {
  if (!appAuthenticationEnabled()) return false;
  if (url.pathname === "/api/health" && request.method === "GET") return false;
  if (url.pathname.startsWith("/api/social/media/")) return false;
  return true;
}

async function readPublishForm(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 256 * 1024 * 1024) throw new PublishError("Uploads must be smaller than 256 MB in total.", 413, "request_too_large");
  let form;
  try { form = await request.formData(); }
  catch { throw new PublishError("The post upload was not a valid multipart request.", 400, "invalid_upload"); }
  let post;
  try { post = JSON.parse(form.get("post") || "{}"); }
  catch { throw new PublishError("Post details could not be read.", 400, "invalid_post"); }
  if (!post || typeof post !== "object" || Array.isArray(post) || typeof post.text !== "string" || post.text.length > 2200) throw new PublishError("Enter a post with up to 2,200 characters.", 400, "invalid_post");
  let schedule = null;
  if (form.has("schedule")) {
    try { schedule = JSON.parse(form.get("schedule") || "null"); }
    catch { throw new PublishError("Scheduled post details could not be read.", 400, "invalid_schedule"); }
  }
  const files = form.getAll("media");
  if (files.some(file => typeof file.arrayBuffer !== "function" || typeof file.size !== "number")) throw new PublishError("The selected media upload could not be read.", 400, "invalid_upload");
  if (files.length > 35) throw new PublishError("A post can include at most 35 media files.", 400, "too_many_files");
  let total = 0;
  const media = [];
  for (const file of files) {
    total += file.size;
    if (total > 250 * 1024 * 1024) throw new PublishError("Uploads must be smaller than 250 MB in total.", 413, "request_too_large");
    media.push({ name: file.name || "media", type: file.type || "application/octet-stream", data: Buffer.from(await file.arrayBuffer()) });
  }
  return {
    post: {
      text: post.text,
      postType: String(post.postType || ""),
      tiktokPrivacyLevel: String(post.tiktokPrivacyLevel || ""),
      youtubePrivacyStatus: String(post.youtubePrivacyStatus || "private"),
      disclosure: Boolean(post.disclosure),
      disableComments: Boolean(post.disableComments),
      disableDuet: Boolean(post.disableDuet),
      disableStitch: Boolean(post.disableStitch),
      autoAddMusic: Boolean(post.autoAddMusic),
    },
    media,
    schedule,
  };
}

const scheduledDelivery = createScheduledDelivery({
  directory: join(dataDir, "scheduled"),
  publish: async job => {
    let accounts;
    try { accounts = readAccounts(); }
    catch { throw new PublishError("Postly could not read its encrypted account store. Check the channel connection before retrying.", 503, "account_store_unavailable"); }
    if (!accounts[job.provider]?.accessToken) throw new PublishError(`${providers[job.provider].name} is not connected. Connect the account, then retry this delivery.`, 401, "account_not_connected");
    const account = accounts[job.provider];
    const outcome = await withProviderAccount(accounts, job.provider, () => publishToProvider(job.provider, account, job.post, job.media, {
      env: process.env,
      dataDir,
      idempotencyKey: job.idempotencyKey,
    }));
    if (accountChanged(account, outcome.account)) {
      accounts[job.provider] = outcome.account;
      writeAccounts(accounts);
    }
    return outcome.result;
  },
});

function authorizationUrl(provider, request) {
  const redirectUri = callbackUrl(request, provider);
  const state = randomBytes(32).toString("base64url");
  const now = Date.now();
  for (const [existingState, entry] of states) if (now - entry.createdAt > oauthStateLifetimeMs) states.delete(existingState);
  while (states.size >= 256) states.delete(states.keys().next().value);
  states.set(state, { provider, createdAt: now });
  const config = providers[provider];
  const id = process.env[config.id];
  let url;
  if (provider === "instagram") {
    url = new URL("https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({ client_id: id, redirect_uri: redirectUri, response_type: "code", scope: providerScopes.instagram.join(","), state }).toString();
  } else if (provider === "tiktok") {
    url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.search = new URLSearchParams({ client_key: id, redirect_uri: redirectUri, response_type: "code", scope: providerScopes.tiktok.join(","), state }).toString();
  } else {
    url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: id, redirect_uri: redirectUri, response_type: "code", scope: providerScopes.youtube.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
  }
  return { url: url.toString(), state, redirectUri };
}

function oauthFetch(url, options = {}) {
  return fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(15_000) });
}

async function responseJson(response) {
  try { return await response.json(); } catch { return {}; }
}

function oauthFailure(provider, result) {
  const rawCode = result?.error?.code || result?.error || result?.error_type;
  const knownCodes = new Set(["access_denied", "invalid_client", "invalid_grant", "invalid_request", "invalid_scope", "server_error", "temporarily_unavailable", "unauthorized_client", "unsupported_grant_type"]);
  const safeCode = typeof rawCode === "string" && knownCodes.has(rawCode) ? rawCode : "exchange_failed";
  return new PublishError(`${providers[provider].name} authorization could not be completed.`, 502, safeCode);
}

function expiryTimestamp(seconds, provider, label) {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 10 * 365 * 24 * 60 * 60) {
    throw new PublishError(`${providers[provider].name} did not return a valid ${label} expiry.`, 502, "invalid_token_expiry");
  }
  return Date.now() + duration * 1000;
}

async function exchangeCode(provider, code, request) {
  const config = providers[provider];
  const redirectUri = callbackUrl(request, provider);
  let accessToken, refreshToken, expiresAt, refreshExpiresAt, profile, userId, grantedScopes = [], scopesKnown = false;
  if (provider === "instagram") {
    const form = new URLSearchParams({ client_id: process.env[config.id], client_secret: process.env[config.secret], grant_type: "authorization_code", redirect_uri: redirectUri, code });
    const response = await oauthFetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
    const result = await responseJson(response);
    if (!response.ok || !result.access_token) throw oauthFailure(provider, result);
    grantedScopes = Array.isArray(result.permissions) ? result.permissions : typeof result.scope === "string" ? result.scope.split(/[ ,]+/).filter(Boolean) : [];
    scopesKnown = Array.isArray(result.permissions) || typeof result.scope === "string";
    userId = result.user_id || result.id || result.user?.id;
    profile = result.user?.username || result.username || `Instagram account ${userId || "connected"}`;
    const longLivedUrl = new URL("https://graph.instagram.com/access_token");
    longLivedUrl.search = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: process.env[config.secret], access_token: result.access_token }).toString();
    const longLivedResponse = await oauthFetch(longLivedUrl);
    const longLived = await responseJson(longLivedResponse);
    if (!longLivedResponse.ok || !longLived.access_token) throw oauthFailure(provider, longLived);
    accessToken = longLived.access_token;
    expiresAt = expiryTimestamp(longLived.expires_in, provider, "access token");
    try {
      const profileUrl = new URL("https://graph.instagram.com/me");
      profileUrl.searchParams.set("fields", "id,username");
      const profileResponse = await oauthFetch(profileUrl, { headers: { authorization: `Bearer ${accessToken}` } });
      const profileData = await responseJson(profileResponse);
      if (profileResponse.ok) {
        if (profileData.username) profile = profileData.username;
        if (profileData.id) userId = profileData.id;
      }
    } catch { /* Profile display is optional; token exchange and expiry are required. */ }
  } else if (provider === "tiktok") {
    const form = new URLSearchParams({ client_key: process.env[config.id], client_secret: process.env[config.secret], code, grant_type: "authorization_code", redirect_uri: redirectUri });
    const response = await oauthFetch("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
    const result = await responseJson(response);
    if (!response.ok || !result.access_token) throw oauthFailure(provider, result);
    grantedScopes = typeof result.scope === "string" ? result.scope.split(/[ ,]+/).filter(Boolean) : [];
    scopesKnown = typeof result.scope === "string";
    accessToken = result.access_token;
    refreshToken = typeof result.refresh_token === "string" ? result.refresh_token : "";
    expiresAt = expiryTimestamp(result.expires_in, provider, "access token");
    refreshExpiresAt = Number.isFinite(Number(result.refresh_expires_in)) && Number(result.refresh_expires_in) > 0 ? expiryTimestamp(result.refresh_expires_in, provider, "refresh token") : null;
    userId = result.open_id || "";
    profile = userId ? `TikTok account ${userId}` : "TikTok account connected";
    try {
      const info = await oauthFetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username", { headers: { authorization: `Bearer ${accessToken}` } });
      const body = await responseJson(info);
      if (body.data?.user?.open_id) userId = body.data.user.open_id;
      profile = body.data?.user?.display_name || body.data?.user?.username || profile;
    } catch { /* Keep the provider account identifier if optional profile lookup fails. */ }
  } else {
    const form = new URLSearchParams({ client_id: process.env[config.id], client_secret: process.env[config.secret], code, grant_type: "authorization_code", redirect_uri: redirectUri });
    const response = await oauthFetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
    const result = await responseJson(response);
    if (!response.ok || !result.access_token) throw oauthFailure(provider, result);
    grantedScopes = typeof result.scope === "string" ? result.scope.split(/[ ,]+/).filter(Boolean) : [];
    scopesKnown = typeof result.scope === "string";
    accessToken = result.access_token;
    refreshToken = typeof result.refresh_token === "string" ? result.refresh_token : "";
    expiresAt = expiryTimestamp(result.expires_in, provider, "access token");
    refreshExpiresAt = Number.isFinite(Number(result.refresh_token_expires_in)) && Number(result.refresh_token_expires_in) > 0 ? expiryTimestamp(result.refresh_token_expires_in, provider, "refresh token") : null;
    profile = "YouTube channel connected";
    try {
      const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
      channelUrl.search = new URLSearchParams({ part: "snippet", mine: "true" }).toString();
      const channelResponse = await oauthFetch(channelUrl, { headers: { authorization: `Bearer ${accessToken}` } });
      const channelData = await responseJson(channelResponse);
      const channel = channelData.items?.[0];
      if (channelResponse.ok && channel) {
        userId = channel.id || "";
        profile = channel.snippet?.title || profile;
      }
    } catch { /* Channel lookup is optional; the granted token remains connected. */ }
  }
  const accounts = readAccounts();
  const previous = accounts[provider];
  if (!refreshToken && previous?.refreshToken && previous.userId && userId && previous.userId === userId) {
    refreshToken = previous.refreshToken;
    refreshExpiresAt ||= previous.refreshExpiresAt || null;
  }
  const connectedAt = new Date().toISOString();
  accounts[provider] = {
    accessToken,
    refreshToken: refreshToken || "",
    userId: userId || "",
    profile,
    scopes: grantedScopes,
    scopesKnown,
    expiresAt,
    refreshExpiresAt: refreshExpiresAt || null,
    tokenIssuedAt: Date.now(),
    reauthorizationRequired: false,
    connectedAt,
  };
  writeAccounts(accounts);
}

function oauthStateCookie(provider, state, request, maxAge = 600) {
  const secure = callbackBaseUrl(request).startsWith("https:") ? "; Secure" : "";
  return `${oauthStateCookieName(provider)}=${state}; Path=${oauthStateCookiePath(provider)}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function requestCookie(request, name) {
  const cookies = request.headers.get("cookie") || "";
  for (const segment of cookies.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    if (segment.slice(0, separator).trim() === name) return segment.slice(separator + 1).trim();
  }
  return "";
}

function redirectToApp(request, key, message, clearProvider = "") {
  const target = new URL(appBaseUrl(request));
  target.searchParams.set(key, message);
  const headers = new Headers({ location: target.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" });
  if (clearProvider) headers.set("set-cookie", oauthStateCookie(clearProvider, "", request, 0));
  return new Response(null, { status: 303, headers });
}

async function api(request, url) {
  if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, app: "Postly" });
  if (url.pathname === "/api/social/status" && request.method === "GET") return json({ providers: publicStatus(request) });
  const scheduledResponse = await handleScheduledDeliveryApi(request, url, {
    scheduler: scheduledDelivery,
    json,
    assertSameOrigin,
    readPostForm: readPublishForm,
  });
  if (scheduledResponse) return scheduledResponse;

  if (url.pathname === "/api/social/insights" && request.method === "GET") {
    const accounts = readAccounts();
    const since = url.searchParams.get("since") || "";
    const until = url.searchParams.get("until") || "";
    const validDate = value => {
      if (!value) return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    if (!validDate(since) || !validDate(until) || (since && until && since > until)) return json({ error: "Choose a valid Insights date range.", code: "invalid_date_range" }, 400);
    const summary = { followers: null, views: 0, likes: 0, comments: 0, shares: 0, reactions: 0, engagement: null, posts: 0 };
    const connectedAccounts = [];
    const posts = [];
    const errors = [];
    for (const provider of Object.keys(providers)) {
      if (!accounts[provider]?.accessToken) continue;
      try {
        const result = await withProviderAccount(accounts, provider, () => fetchProviderInsights(provider, accounts[provider], { env: process.env, since, until }));
        connectedAccounts.push({ ...result.profile, summary: result.summary });
        addProviderSummary(summary, result.summary);
        posts.push(...result.posts);
        errors.push(...result.errors);
        accounts[provider] = result.account;
      } catch (error) { errors.push({ provider, code: error.code || "provider_error", message: error.message }); }
    }
    const followerTotal = connectedAccounts.reduce((total, profile) => total + (Number(profile.followers) || 0), 0);
    if (followerTotal) summary.engagement = Number((100 * summary.reactions / followerTotal).toFixed(2));
    posts.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    if (connectedAccounts.length) writeAccounts(accounts);
    return json({ accounts: connectedAccounts, summary, posts: posts.slice(0, 50), errors, source: "live" });
  }

  if (url.pathname === "/api/social/community" && request.method === "GET") {
    const kind = url.searchParams.get("kind") === "mentions" ? "mentions" : "comments";
    const accounts = readAccounts();
    const items = [];
    const unavailable = [];
    const errors = [];
    let accountUpdated = false;
    for (const provider of Object.keys(providers)) {
      if (!accounts[provider]?.accessToken) continue;
      try {
        const result = await withProviderAccount(accounts, provider, () => fetchProviderCommunity(provider, accounts[provider], { env: process.env, kind }));
        if (result.source === "unsupported") unavailable.push({ provider, message: result.message });
        items.push(...result.items);
        errors.push(...(result.errors || []));
        if (accountChanged(accounts[provider], result.account)) accountUpdated = true;
        accounts[provider] = result.account;
      } catch (error) { errors.push({ provider, code: error.code || "provider_error", message: error.message }); }
    }
    items.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    if (accountUpdated || items.length || unavailable.length || errors.length) writeAccounts(accounts);
    return json({ kind, items: items.slice(0, 100), unavailable, errors, source: "live" });
  }

  const replyMatch = url.pathname.match(/^\/api\/social\/(instagram|youtube)\/comments\/([\w.-]+)\/reply$/);
  if (replyMatch && request.method === "POST") {
    assertSameOrigin(request);
    const [, provider, commentId] = replyMatch;
    let body;
    try { body = await request.json(); } catch { return json({ error: "Reply details could not be read.", code: "invalid_json" }, 400); }
    const accounts = readAccounts();
    if (!accounts[provider]?.accessToken) return json({ error: `${providers[provider].name} is not connected.`, code: "account_not_connected" }, 401);
    const result = await withProviderAccount(accounts, provider, () => replyToProviderComment(provider, accounts[provider], commentId, body.text, { env: process.env }));
    accounts[provider] = result.account;
    writeAccounts(accounts);
    return json({ ok: true, reply: result.reply }, 201);
  }

  if (url.pathname === "/api/social/tiktok/creator-info" && request.method === "GET") {
    const accounts = readAccounts();
    if (!accounts.tiktok?.accessToken) return json({ error: "TikTok is not connected." }, 401);
    const { account, creator } = await withProviderAccount(accounts, "tiktok", () => queryTikTokCreatorInfo(accounts.tiktok, { env: process.env }));
    if (accountChanged(accounts.tiktok, account)) { accounts.tiktok = account; writeAccounts(accounts); }
    return json({ creator: {
      username: creator.creator_username || "",
      nickname: creator.creator_nickname || "",
      privacyLevelOptions: creator.privacy_level_options,
      commentDisabled: Boolean(creator.comment_disabled),
      duetDisabled: Boolean(creator.duet_disabled),
      stitchDisabled: Boolean(creator.stitch_disabled),
      maxVideoPostDurationSec: creator.max_video_post_duration_sec || null,
    } });
  }

  const publishMatch = url.pathname.match(/^\/api\/social\/(instagram|tiktok|youtube)\/publish$/);
  if (publishMatch && request.method === "POST") {
    assertSameOrigin(request);
    const [, provider] = publishMatch;
    const accounts = readAccounts();
    if (!accounts[provider]?.accessToken) return json({ error: `${providers[provider].name} is not connected. Connect the account first.`, code: "account_not_connected" }, 401);
    const { post, media } = await readPublishForm(request);
    const outcome = await withProviderAccount(accounts, provider, () => publishToProvider(provider, accounts[provider], post, media, { env: process.env, dataDir }));
    if (accountChanged(accounts[provider], outcome.account)) {
      accounts[provider] = outcome.account;
      writeAccounts(accounts);
    }
    return json({ ok: true, ...outcome.result });
  }

  const tikTokStatus = url.pathname.match(/^\/api\/social\/tiktok\/publish-status$/);
  if (tikTokStatus && request.method === "GET") {
    const accounts = readAccounts();
    if (!accounts.tiktok?.accessToken) return json({ error: "TikTok is not connected." }, 401);
    const status = await withProviderAccount(accounts, "tiktok", () => queryTikTokPublishStatus(accounts.tiktok, url.searchParams.get("publishId"), { env: process.env }));
    if (accountChanged(accounts.tiktok, status.account)) { accounts.tiktok = status.account; writeAccounts(accounts); }
    return json({ status: status.status, providerStatus: status.providerStatus, reason: status.reason });
  }

  const match = url.pathname.match(/^\/api\/social\/(instagram|tiktok|youtube)\/(connect|callback|disconnect)$/);
  if (!match) return json({ error: "API route not found." }, 404);
  const [, provider, action] = match;
  if (action === "connect" && request.method === "GET") {
    if (!isConfigured(provider)) return json({ error: `${providers[provider].name} OAuth credentials are not configured on this server.` }, 503);
    const auth = authorizationUrl(provider, request);
    const headers = new Headers({ location: auth.url, "cache-control": "no-store", "referrer-policy": "no-referrer" });
    headers.set("set-cookie", oauthStateCookie(provider, auth.state, request));
    return new Response(null, { status: 302, headers });
  }
  if (action === "callback" && request.method === "GET") {
    const stateValues = url.searchParams.getAll("state");
    const state = stateValues[0] || "";
    const stateInfo = stateValues.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(state) ? states.get(state) : null;
    if (state) states.delete(state);
    const browserState = requestCookie(request, oauthStateCookieName(provider));
    if (!stateInfo || stateInfo.provider !== provider || Date.now() - stateInfo.createdAt > oauthStateLifetimeMs || !browserState || browserState !== state) return redirectToApp(request, "social_error", "invalid_state", provider);
    if (url.searchParams.has("error")) return redirectToApp(request, "social_error", "authorization_denied", provider);
    const code = url.searchParams.get("code");
    if (!code || code.length > 4096 || url.searchParams.getAll("code").length !== 1) return redirectToApp(request, "social_error", "missing_code", provider);
    try { await exchangeCode(provider, code, request); return redirectToApp(request, "connected", provider, provider); }
    catch (error) { console.error(`${providers[provider].name} OAuth callback failed (${error.code || "exchange_failed"}).`); return redirectToApp(request, "social_error", `${provider}_exchange_failed`, provider); }
  }
  if (action === "disconnect" && request.method === "POST") {
    assertSameOrigin(request);
    const accounts = readAccounts();
    const account = accounts[provider];
    if (!account) return json({ ok: true, disconnected: true, revocation: "not_needed" });
    let revocation = provider === "instagram" ? "local_only" : "failed";
    if (provider === "youtube" || provider === "tiktok") {
      const endpoint = provider === "youtube" ? "https://oauth2.googleapis.com/revoke" : "https://open.tiktokapis.com/v2/oauth/revoke/";
      const params = provider === "youtube"
        ? { token: account.refreshToken || account.accessToken }
        : { client_key: process.env[providers[provider].id] || "", client_secret: process.env[providers[provider].secret] || "", token: account.accessToken };
      try {
        const response = await oauthFetch(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
        const result = provider === "tiktok" ? await responseJson(response) : {};
        revocation = response.ok && (provider !== "tiktok" || !result.error || result.error.code === "ok") ? "revoked" : "failed";
      } catch { revocation = "failed"; /* Local disconnection still removes the stored credential. */ }
    }
    delete accounts[provider];
    writeAccounts(accounts);
    return json({ ok: true, disconnected: true, revocation });
  }
  return json({ error: "Method not allowed." }, 405);
}

async function handle(request) {
  const url = new URL(request.url);
  if (needsAppAuthentication(request, url) && !hasValidBasicAuthentication(request)) {
    return new Response("Authentication required.", {
      status: 401,
      headers: {
        "www-authenticate": 'Basic realm="Postly", charset="UTF-8"',
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname.startsWith("/api/social/media/")) return publishedMediaResponse(request, url);
    try { return await api(request, url); }
    catch (error) {
      if (error instanceof PublishError) return json({ error: error.message, code: error.code }, error.status);
      console.error("Postly API error:", error.message);
      return json({ error: "The account connection could not be completed." }, 500);
    }
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
const host = process.env.HOST || "127.0.0.1";
if (process.env.NODE_ENV === "production") {
  if (!process.env.APP_BASE_URL?.trim()) throw new Error("APP_BASE_URL is required in production.");
  parseBaseUrl(process.env.APP_BASE_URL.trim(), "APP_BASE_URL");
  if (process.env.OAUTH_REDIRECT_BASE?.trim()) parseBaseUrl(process.env.OAUTH_REDIRECT_BASE.trim(), "OAUTH_REDIRECT_BASE");
  if (!process.env.POSTLY_DATA_DIR?.trim()) throw new Error("POSTLY_DATA_DIR must point to persistent storage in production.");
  if (process.env.POSTLY_TRUST_PROXY_BASIC_AUTH !== "1" && (!process.env.POSTLY_BASIC_AUTH_USER || !process.env.POSTLY_BASIC_AUTH_PASSWORD)) {
    throw new Error("Production requires POSTLY_BASIC_AUTH_USER and POSTLY_BASIC_AUTH_PASSWORD, or a trusted proxy that enforces authentication.");
  }
  getEncryptionKey();
}
const cleanupPublicMedia = () => cleanupExpiredPublicMediaAssets(dataDir, { env: process.env }).catch(error => {
  console.error("Postly temporary media cleanup failed:", error.message);
});
void cleanupPublicMedia();
const publicMediaCleanupTimer = setInterval(cleanupPublicMedia, 60 * 60 * 1000);
publicMediaCleanupTimer.unref();
const server = createServer(async (incoming, outgoing) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of incoming) {
    size += chunk.length;
    if (size > 256 * 1024 * 1024) {
      incoming.resume();
      outgoing.writeHead(413, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      outgoing.end(JSON.stringify({ error: "Uploads must be smaller than 256 MB in total.", code: "request_too_large" }));
      return;
    }
    chunks.push(chunk);
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://${incoming.headers.host || `localhost:${port}`}${incoming.url}`, { method: incoming.method, headers: incoming.headers, body: ["GET", "HEAD"].includes(incoming.method) ? undefined : body, duplex: "half" });
  const response = await handle(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(port, host, () => {
  if (process.env.POSTLY_DISABLE_SCHEDULER !== "1") {
    scheduledDelivery.start({ onError: error => console.error("Postly scheduled worker error:", error?.code || "scheduler_error") });
  }
  console.log(`Postly ${process.env.API_ONLY === "1" ? "OAuth API" : "app"} listening on ${host}:${port}`);
});
