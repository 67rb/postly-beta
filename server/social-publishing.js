import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { isAbsolute, join, resolve } from "node:path";

const mediaMimeExtensions = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};
const videoMimeTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const tiktokPhotoMimeTypes = new Set(["image/jpeg", "image/webp"]);
const tiktokBase = "https://open.tiktokapis.com/v2";
const tiktokChunkBytes = 10_000_000;
const publishingAssetLifetimeMs = 24 * 60 * 60 * 1000;
const maxPublicMediaBytes = 250 * 1024 * 1024;
const instagramImageMimeTypes = new Set(["image/jpeg"]);
const instagramVideoMimeTypes = new Set(["video/mp4", "video/quicktime"]);
const instagramImageMaxBytes = 8_000_000;
const instagramVideoMaxBytes = 1_000_000_000;
const tiktokVideoMaxBytes = 4_000_000_000;
const tiktokPhotoMaxBytes = 20_000_000;
const youtubeVideoMaxBytes = 256_000_000_000;
const idempotencyLedgerName = "publishing-idempotency.json";
const defaultIdempotencyLifetimeMs = 24 * 60 * 60 * 1000;
const keyedIdempotencyLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const idempotentPublishes = new Map();
const idempotentPublishLocks = new Map();
let idempotencyJournalWrite = Promise.resolve();

function safeProviderId(value) {
  if (typeof value === "string") return value;
  return Number.isSafeInteger(value) ? String(value) : "";
}

export class PublishError extends Error {
  constructor(message, status = 502, code = "provider_error", { ambiguous = false } = {}) {
    super(message);
    this.name = "PublishError";
    this.status = status;
    this.code = code;
    this.ambiguous = ambiguous;
  }
}

async function responseData(response) {
  try { return await response.json(); } catch { return {}; }
}

function apiError(data, provider, response) {
  const providerError = data?.error;
  const providerCode = typeof providerError === "string" ? providerError : providerError?.code || data?.error_code;
  const message = providerError?.message || data?.error_description || data?.message;
  if (!response.ok || (providerCode && providerCode !== "ok")) {
    const detail = typeof message === "string" ? message.slice(0, 400) : "";
    throw new PublishError(`${provider} rejected the request${detail ? `: ${detail}` : "."}`, response.status === 401 ? 401 : 502, providerCode || "provider_error");
  }
  return data;
}

async function fetchJson(fetchImpl, url, options, provider) {
  let response;
  try { response = await fetchImpl(url, options); }
  catch { throw new PublishError(`Could not reach ${provider}. Check the server connection and try again.`, 502, "network_error"); }
  const data = await responseData(response);
  return { response, data: apiError(data, provider, response) };
}

function normalizedRefreshError(provider, error) {
  const name = provider === "youtube" ? "YouTube" : provider === "tiktok" ? "TikTok" : "Instagram";
  const code = String(error?.code || "").toLowerCase();
  if (error?.status === 401 || code === "190" || ["invalid_grant", "invalid_token", "reconnect_required", "unauthorized"].includes(code)) {
    return new PublishError(`${name}'s access grant expired or was revoked. Reconnect the account.`, 401, "reconnect_required");
  }
  if (code === "network_error") return error;
  return new PublishError(`${name} could not refresh its access token. Try again.`, 502, "token_refresh_failed");
}

export async function refreshAccountToken(provider, account, { env = process.env, fetchImpl = fetch } = {}) {
  const now = Date.now();
  const refreshWindow = provider === "instagram" ? 7 * 24 * 60 * 60 * 1000 : 5 * 60 * 1000;
  if (!account?.expiresAt) {
    if (provider === "instagram" && account?.accessToken) throw new PublishError("Instagram's token expiry is unknown. Reconnect the account.", 401, "reconnect_required");
    return account;
  }
  if (account.expiresAt > now + refreshWindow) return account;

  if (provider === "instagram") {
    if (account.expiresAt <= now) throw new PublishError("Instagram's access token has expired. Reconnect the account.", 401, "reconnect_required");
    const refreshUrl = new URL("https://graph.instagram.com/refresh_access_token");
    refreshUrl.search = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: account.accessToken }).toString();
    let data;
    try { ({ data } = await fetchJson(fetchImpl, refreshUrl, {}, "Instagram")); }
    catch (error) { throw normalizedRefreshError("instagram", error); }
    const expiresIn = Number(data.expires_in);
    if (!data.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new PublishError("Instagram could not refresh its access token. Reconnect the account.", 401, "reconnect_required");
    return { ...account, accessToken: data.access_token, expiresAt: now + expiresIn * 1000, tokenIssuedAt: now, reauthorizationRequired: false };
  }

  if (!account.refreshToken || (Number.isFinite(account.refreshExpiresAt) && account.refreshExpiresAt <= now)) {
    throw new PublishError(`${provider === "youtube" ? "YouTube" : "TikTok"} access expired. Reconnect the account.`, 401, "reconnect_required");
  }
  const config = provider === "youtube"
    ? { endpoint: "https://oauth2.googleapis.com/token", idKey: "YOUTUBE_CLIENT_ID", secretKey: "YOUTUBE_CLIENT_SECRET", idField: "client_id", secretField: "client_secret" }
    : { endpoint: "https://open.tiktokapis.com/v2/oauth/token/", idKey: "TIKTOK_CLIENT_KEY", secretKey: "TIKTOK_CLIENT_SECRET", idField: "client_key", secretField: "client_secret" };
  const form = new URLSearchParams({
    [config.idField]: env[config.idKey] || "",
    [config.secretField]: env[config.secretKey] || "",
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
  });
  let data;
  try { ({ data } = await fetchJson(fetchImpl, config.endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form }, provider === "youtube" ? "YouTube" : "TikTok")); }
  catch (error) { throw normalizedRefreshError(provider, error); }
  if (!data.access_token) throw new PublishError(`${provider === "youtube" ? "YouTube" : "TikTok"} could not refresh its access token. Reconnect the account.`, 401, "reconnect_required");
  const expiresIn = Number(data.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new PublishError(`${provider === "youtube" ? "YouTube" : "TikTok"} did not return a valid access token expiry. Reconnect the account.`, 401, "invalid_token_expiry");
  const refreshExpiresIn = Number(data.refresh_expires_in);
  return {
    ...account,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || account.refreshToken,
    expiresAt: now + expiresIn * 1000,
    refreshExpiresAt: Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0 ? now + refreshExpiresIn * 1000 : account.refreshExpiresAt || null,
    tokenIssuedAt: now,
    reauthorizationRequired: false,
  };
}

export async function queryTikTokCreatorInfo(account, options = {}) {
  const fresh = await refreshAccountToken("tiktok", account, options);
  const { data } = await fetchJson(options.fetchImpl || fetch, `${tiktokBase}/post/publish/creator_info/query/`, {
    method: "POST",
    headers: { authorization: `Bearer ${fresh.accessToken}`, "content-type": "application/json; charset=UTF-8" },
    body: "{}",
  }, "TikTok");
  const creator = data.data;
  if (!creator || !Array.isArray(creator.privacy_level_options)) throw new PublishError("TikTok did not return the current account's publishing options.");
  return { account: fresh, creator };
}

function publicMediaOrigin(env) {
  const configured = typeof env.PUBLIC_MEDIA_BASE_URL === "string" ? env.PUBLIC_MEDIA_BASE_URL.trim() : "";
  if (!configured) throw new PublishError("Public media hosting is not configured. Set PUBLIC_MEDIA_BASE_URL to Postly's public HTTPS address.", 503, "media_host_required");
  let url;
  try { url = new URL(configured); }
  catch { throw new PublishError("PUBLIC_MEDIA_BASE_URL must be a valid public HTTPS origin.", 503, "public_media_required"); }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const labels = hostname.split(".");
  const reservedSuffixes = new Set(["localhost", "local", "localdomain", "internal", "test", "example", "invalid", "onion", "lan", "home", "corp", "intranet"]);
  const reservedHost = labels.length < 2 || labels.some(label => !label || !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/.test(label)) || reservedSuffixes.has(labels.at(-1));
  const isPrivateAddress = isIP(hostname) !== 0;
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.pathname !== "/" || !hostname || isPrivateAddress || reservedHost || url.username || url.password || url.search || url.hash) {
    throw new PublishError("Public media hosting requires a public HTTPS domain on port 443. Use a DNS hostname with no path, query, or credentials; localhost and IP addresses cannot be fetched reliably by social platforms.", 503, "public_media_required");
  }
  return url.origin;
}

function publicMediaDirectory(dataDir, env = process.env) {
  const configured = typeof env.PUBLIC_MEDIA_STORAGE_DIR === "string" ? env.PUBLIC_MEDIA_STORAGE_DIR.trim() : "";
  if (configured && !isAbsolute(configured)) throw new PublishError("PUBLIC_MEDIA_STORAGE_DIR must be an absolute path to a private writable directory.", 503, "invalid_media_storage");
  if (!configured && !dataDir) throw new PublishError("Public media storage is not configured. Set PUBLIC_MEDIA_STORAGE_DIR or POSTLY_DATA_DIR.", 503, "media_storage_required");
  return configured ? resolve(configured) : join(dataDir, "media");
}

function mediaMetadataIsValid(metadata, now = Date.now()) {
  return Boolean(
    metadata &&
    mediaMimeExtensions[metadata.type] &&
    Number.isSafeInteger(metadata.size) && metadata.size > 0 && metadata.size <= maxPublicMediaBytes &&
    Number.isSafeInteger(metadata.expiresAt) && metadata.expiresAt > now && metadata.expiresAt <= now + publishingAssetLifetimeMs + 60_000
  );
}

export async function cleanupExpiredPublicMediaAssets(dataDir, { env = process.env, now = Date.now() } = {}) {
  const mediaDir = publicMediaDirectory(dataDir, env);
  let files;
  try { files = await readdir(mediaDir); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }

  const fileSet = new Set(files);
  const liveIds = new Set();
  const remove = new Set();
  const idPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    if (!idPattern.test(id)) continue;
    let metadata;
    try { metadata = JSON.parse(await readFile(join(mediaDir, name), "utf8")); } catch { metadata = null; }
    const extension = mediaMimeExtensions[metadata?.type];
    let valid = mediaMetadataIsValid(metadata, now) && Boolean(extension);
    if (valid) {
      try { valid = (await stat(join(mediaDir, `${id}${extension}`))).size === metadata.size; }
      catch { valid = false; }
    }
    if (!valid) {
      remove.add(name);
      for (const knownExtension of Object.values(mediaMimeExtensions)) remove.add(`${id}${knownExtension}`);
    } else liveIds.add(id);
  }

  for (const name of files) {
    const match = name.match(/^([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(\.(?:jpg|png|webp|mp4|mov|webm))$/i);
    if (!match || liveIds.has(match[1]) || fileSet.has(`${match[1]}.json`)) continue;
    try {
      const details = await stat(join(mediaDir, name));
      if (details.mtimeMs <= now - publishingAssetLifetimeMs) remove.add(name);
    } catch { /* A concurrent upload may have removed the file. */ }
  }

  await Promise.all([...remove].map(name => rm(join(mediaDir, name), { force: true })));
}

export async function createPublicMediaAssets(media, { dataDir, env = process.env, maxBytes = maxPublicMediaBytes } = {}) {
  const origin = publicMediaOrigin(env);
  const mediaDir = publicMediaDirectory(dataDir, env);
  const byteLimit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? Math.min(maxBytes, maxPublicMediaBytes) : maxPublicMediaBytes;
  if (!Array.isArray(media)) throw new PublishError("The selected media upload could not be read.", 400, "invalid_upload");
  let totalBytes = 0;
  for (const item of media) {
    if (!mediaMimeExtensions[item?.type]) throw new PublishError(`The ${item?.name || "file"} format is not supported for public media upload.`, 400, "unsupported_media");
    if (!Buffer.isBuffer(item.data)) throw new PublishError("The selected media upload could not be read.", 400, "invalid_upload");
    if (!item.data.length) throw new PublishError(`The ${item.name || "file"} is empty. Select a different file.`, 400, "empty_media");
    if (item.data.length > byteLimit) throw new PublishError(`${item.name || "This file"} exceeds the media size limit.`, 413, "file_too_large");
    totalBytes += item.data.length;
    if (totalBytes > byteLimit) throw new PublishError("Uploads exceed the total media size limit.", 413, "request_too_large");
  }
  await mkdir(mediaDir, { recursive: true, mode: 0o700 });
  await cleanupExpiredPublicMediaAssets(dataDir, { env });
  const assets = [];
  for (const item of media) {
    const id = randomUUID();
    const extension = mediaMimeExtensions[item.type];
    const file = join(mediaDir, `${id}${extension}`);
    const metadata = join(mediaDir, `${id}.json`);
    try {
      await writeFile(file, item.data, { mode: 0o600, flag: "wx" });
      await writeFile(metadata, JSON.stringify({ type: item.type, size: item.data.length, expiresAt: Date.now() + publishingAssetLifetimeMs, extension }), { mode: 0o600, flag: "wx" });
    } catch (error) {
      await Promise.all([rm(file, { force: true }), rm(metadata, { force: true })]);
      await removePublicMediaAssets(assets);
      throw error;
    }
    assets.push({ id, url: `${origin}/api/social/media/${id}`, file, metadata, type: item.type, size: item.data.length });
  }
  return assets;
}

export async function removePublicMediaAssets(assets = []) {
  await Promise.all(assets.flatMap(asset => [rm(asset.file, { force: true }), rm(asset.metadata, { force: true })]));
}

export async function readPublicMediaAsset(id, dataDir, { env = process.env, now = Date.now() } = {}) {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return null;
  const mediaDir = publicMediaDirectory(dataDir, env);
  let metadata;
  try { metadata = JSON.parse(await readFile(join(mediaDir, `${id}.json`), "utf8")); }
  catch { return null; }
  const extension = mediaMimeExtensions[metadata?.type];
  if (!mediaMetadataIsValid(metadata, now) || !extension) {
    await Promise.all([...Object.values(mediaMimeExtensions).map(value => rm(join(mediaDir, `${id}${value}`), { force: true })), rm(join(mediaDir, `${id}.json`), { force: true })]);
    return null;
  }
  try {
    const data = await readFile(join(mediaDir, `${id}${extension}`));
    if (data.length !== metadata.size) {
      await Promise.all([rm(join(mediaDir, `${id}${extension}`), { force: true }), rm(join(mediaDir, `${id}.json`), { force: true })]);
      return null;
    }
    return { metadata, data };
  } catch {
    return null;
  }
}

function requireMedia(media, acceptedTypes, label, count = 1) {
  if (!Array.isArray(media)) throw new PublishError(`${label} publishing requires media. Add a supported file and try again.`, 400, "media_required");
  if (!media.length) throw new PublishError(`${label} publishing requires media. Add a supported file and try again.`, 400, "media_required");
  if (media.length > count) throw new PublishError(`${label} publishing supports up to ${count} file${count === 1 ? "" : "s"} in this post.`, 400, "too_many_files");
  for (const file of media) {
    if (!acceptedTypes.has(file.type)) throw new PublishError(`${label} does not support ${file.type || "this media format"} for this post type.`, 400, "unsupported_media");
    if (!file.data?.length) throw new PublishError(`${file.name || "The selected file"} is empty. Select a different file.`, 400, "empty_media");
  }
}

function requireYouTubeVideo(media) {
  if (!Array.isArray(media) || media.length !== 1) throw new PublishError("YouTube publishing requires one video file.", 400, media?.length ? "too_many_files" : "media_required");
  const type = media[0]?.type || "";
  if (!(type === "application/octet-stream" || /^video\/[a-z\d.+-]+$/i.test(type))) throw new PublishError(`YouTube does not accept ${type || "this media format"} as a video upload.`, 400, "unsupported_media");
  if (!media[0].data?.length) throw new PublishError(`${media[0].name || "The selected file"} is empty. Select a different file.`, 400, "empty_media");
}

function metaVersion(env) {
  const value = (env.META_GRAPH_API_VERSION || "v26.0").replace(/^v/i, "");
  if (!/^\d+\.\d+$/.test(value)) throw new PublishError("META_GRAPH_API_VERSION must look like 26.0.", 503, "invalid_configuration");
  return `v${value}`;
}

async function instagramRequest(fetchImpl, url, { token, method = "GET", params } = {}) {
  const target = new URL(url);
  const options = { method, headers: { authorization: `Bearer ${token}` } };
  if (method === "GET") {
    if (params) for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  } else {
    options.headers["content-type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(params || {});
  }
  return fetchJson(fetchImpl, target, options, "Instagram");
}

async function waitForInstagramContainer(fetchImpl, base, id, token, options = {}) {
  const maxWaitMs = options.instagramMaxWaitMs ?? 5 * 60 * 1000;
  const pollIntervalMs = options.instagramPollIntervalMs ?? 60 * 1000;
  const sleep = options.sleepImpl || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const until = Date.now() + maxWaitMs;
  while (true) {
    const { data } = await instagramRequest(fetchImpl, `${base}/${id}`, { token, params: { fields: "status_code,status" } });
    const status = data.status_code;
    if (status === "FINISHED") return { ready: true, published: false, providerStatus: status };
    if (status === "PUBLISHED") return { ready: false, published: true, providerStatus: status };
    if (status === "ERROR" || status === "EXPIRED") throw new PublishError(`Instagram media processing failed: ${data.status || status}.`, 502, "media_processing_failed");
    if (status !== "IN_PROGRESS") throw new PublishError(`Instagram returned an unrecognized media status${status ? ` (${status})` : ""}.`, 502, "invalid_provider_status");
    if (Date.now() >= until) return { ready: false, published: false, providerStatus: status };
    await sleep(Math.min(pollIntervalMs, Math.max(0, until - Date.now())));
  }
}

async function publishInstagram(account, post, media, options) {
  const { env, fetchImpl, dataDir } = options;
  const type = post.postType || "Post";
  if (type === "Story") throw new PublishError("Instagram Stories aren't supported by this publishing flow. Choose Post or Reel.", 400, "unsupported_post_type");
  requireMedia(media, new Set([...instagramImageMimeTypes, ...instagramVideoMimeTypes]), "Instagram", 10);
  if ((post.text || "").length > 2200) throw new PublishError("Instagram captions can contain at most 2,200 characters.", 400, "caption_too_long");
  for (const file of media) {
    const maxBytes = file.type.startsWith("image/") ? instagramImageMaxBytes : instagramVideoMaxBytes;
    if (file.data.length > maxBytes) throw new PublishError(`${file.name || "This file"} exceeds Instagram's ${file.type.startsWith("image/") ? "8 MB image" : "1 GB video"} limit.`, 400, "file_too_large");
  }
  const imageCount = media.filter(file => file.type.startsWith("image/")).length;
  const videoCount = media.length - imageCount;
  if (media.length > 1 && type !== "Post") throw new PublishError("Instagram carousels use the Post type. Select Post for this media set.", 400, "unsupported_post_type");
  if (media.length === 1 && videoCount && type !== "Reel") throw new PublishError("For Instagram video, select Reel in channel customization.", 400, "unsupported_post_type");
  if (media.length === 1 && imageCount && type !== "Post") throw new PublishError("For Instagram photos, select Post in channel customization.", 400, "unsupported_post_type");

  const fresh = await refreshAccountToken("instagram", account, options);
  let userId = fresh.userId;
  let profile = fresh.profile;
  const version = metaVersion(env);
  const base = `https://graph.instagram.com/${version}`;
  if (!userId) {
    const { data } = await instagramRequest(fetchImpl, `${base}/me`, { token: fresh.accessToken, params: { fields: "id,username" } });
    userId = data.id;
    profile = data.username || profile;
    if (!userId) throw new PublishError("Instagram did not return the connected professional account ID. Reconnect the account.", 401, "reconnect_required");
  }

  const assets = await createPublicMediaAssets(media, { dataDir, env });
  let containerId;
  try {
    if (media.length > 1) {
      const childIds = [];
      for (let index = 0; index < media.length; index++) {
        const file = media[index], asset = assets[index];
        const fields = { is_carousel_item: "true" };
        if (file.type.startsWith("image/")) fields.image_url = asset.url;
        else { fields.media_type = "VIDEO"; fields.video_url = asset.url; }
        const { data } = await instagramRequest(fetchImpl, `${base}/${userId}/media`, { token: fresh.accessToken, method: "POST", params: fields });
        if (!data.id) throw new PublishError("Instagram did not create a carousel item container.");
        if (file.type.startsWith("video/")) {
          const childStatus = await waitForInstagramContainer(fetchImpl, base, data.id, fresh.accessToken, options);
          if (childStatus.published) throw new PublishError("Instagram published a carousel item before its carousel was submitted.", 502, "unexpected_provider_status");
          if (!childStatus.ready) throw new PublishError("Instagram is still processing a carousel video. Wait before retrying.", 504, "media_processing_timeout");
        }
        childIds.push(data.id);
      }
      const { data } = await instagramRequest(fetchImpl, `${base}/${userId}/media`, { token: fresh.accessToken, method: "POST", params: { media_type: "CAROUSEL", children: childIds.join(","), caption: post.text || "" } });
      containerId = data.id;
    } else if (media[0].type.startsWith("image/")) {
      const { data } = await instagramRequest(fetchImpl, `${base}/${userId}/media`, { token: fresh.accessToken, method: "POST", params: { image_url: assets[0].url, caption: post.text || "" } });
      containerId = data.id;
    } else {
      const { data } = await instagramRequest(fetchImpl, `${base}/${userId}/media`, { token: fresh.accessToken, method: "POST", params: { media_type: "REELS", video_url: assets[0].url, caption: post.text || "", share_to_feed: "true" } });
      containerId = data.id;
    }
    if (!containerId) throw new PublishError("Instagram did not return a media container ID.");
    let containerStatus;
    try { containerStatus = await waitForInstagramContainer(fetchImpl, base, containerId, fresh.accessToken, options); }
    catch (error) {
      if (error.code === "media_processing_failed") throw error;
      return { account: { ...fresh, userId, profile }, result: { provider: "instagram", status: "publishing", remoteId: "", containerId, providerStatus: "STATUS_CHECK_UNAVAILABLE", publishAttempted: false, userId, profile } };
    }
    if (containerStatus.published) return { account: { ...fresh, userId, profile }, result: { provider: "instagram", status: "published", remoteId: "", containerId, providerStatus: "PUBLISHED", profile } };
    if (!containerStatus.ready) return { account: { ...fresh, userId, profile }, result: { provider: "instagram", status: "publishing", remoteId: "", containerId, providerStatus: containerStatus.providerStatus, publishAttempted: false, userId, profile } };
    let data;
    try {
      ({ data } = await instagramRequest(fetchImpl, `${base}/${userId}/media_publish`, { token: fresh.accessToken, method: "POST", params: { creation_id: containerId } }));
    } catch (error) {
      if (error.status < 500 && error.code !== "network_error") throw error;
      let status = "PUBLISH_OUTCOME_UNCONFIRMED";
      try {
        const response = await instagramRequest(fetchImpl, `${base}/${containerId}`, { token: fresh.accessToken, params: { fields: "status_code,status" } });
        status = response.data.status_code || status;
      } catch { /* Preserve the known container ID and prevent a blind duplicate retry. */ }
      if (status === "PUBLISHED") return { account: { ...fresh, userId, profile }, result: { provider: "instagram", status: "published", remoteId: "", containerId, providerStatus: status, profile } };
      if (["ERROR", "EXPIRED"].includes(status)) throw new PublishError(`Instagram media processing failed: ${status}.`, 502, "media_processing_failed");
      return { account: { ...fresh, userId, profile }, result: { provider: "instagram", status: "publishing", remoteId: "", containerId, providerStatus: status, publishAttempted: true, userId, profile } };
    }
    if (!data.id) throw new PublishError("Instagram did not confirm the published media ID.", 502, "missing_remote_id", { ambiguous: true });
    return { account: { ...fresh, userId, profile }, result: { provider: "instagram", status: "published", remoteId: data.id, containerId, providerStatus: "PUBLISHED", profile } };
  } finally {
    // Meta fetches the media asynchronously. Keep the signed, random asset URLs available for one day.
  }
}

async function pollTikTokPublish(fetchImpl, token, publishId, options = {}) {
  const maxWaitMs = options.tiktokMaxWaitMs ?? 90_000;
  const pollIntervalMs = options.tiktokPollIntervalMs ?? 5_000;
  const sleep = options.sleepImpl || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const until = Date.now() + maxWaitMs;
  while (true) {
    let data;
    try {
      ({ data } = await fetchJson(fetchImpl, `${tiktokBase}/post/publish/status/fetch/`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ publish_id: publishId }),
      }, "TikTok"));
    } catch (error) {
      return { status: "publishing", remoteId: "", providerStatus: "STATUS_CHECK_UNAVAILABLE", statusError: error.message };
    }
    const status = data.data?.status;
    if (status === "PUBLISH_COMPLETE") return { status: "published", remoteId: safeProviderId(data.data?.publicaly_available_post_id?.[0]), providerStatus: status };
    if (["FAILED", "PUBLISH_CANCELLED", "publish_cancelled"].includes(status)) throw new PublishError(`TikTok could not publish this post${data.data?.fail_reason ? `: ${data.data.fail_reason}` : "."}`, 502, "publish_failed");
    if (Date.now() >= until) return { status: "publishing", remoteId: "", providerStatus: status || "UNKNOWN_STATUS" };
    await sleep(Math.min(pollIntervalMs, Math.max(0, until - Date.now())));
  }
}

async function checkTikTokPublishOutcome(fetchImpl, token, publishId, options = {}) {
  try { return await pollTikTokPublish(fetchImpl, token, publishId, { ...options, tiktokMaxWaitMs: 0 }); }
  catch (error) {
    if (error.code !== "publish_failed") error.ambiguous = true;
    throw error;
  }
}

async function publishTikTok(account, post, media, options) {
  const { fetchImpl } = options;
  const { account: fresh, creator } = await queryTikTokCreatorInfo(account, options);
  const privacy = post.tiktokPrivacyLevel;
  if (!privacy || !creator.privacy_level_options.includes(privacy)) throw new PublishError("Choose one of the current TikTok audience options before publishing.", 400, "privacy_required");
  const caption = post.text || "";
  const type = post.postType || "Video";
  let publishId;
  if (type === "Video") {
    requireMedia(media, videoMimeTypes, "TikTok video", 1);
    const video = media[0];
    if (video.data.length > tiktokVideoMaxBytes) throw new PublishError("TikTok videos must be 4 GB or smaller.", 400, "file_too_large");
    if (caption.length > 2200) throw new PublishError("TikTok video captions can contain at most 2,200 UTF-16 code units.", 400, "caption_too_long");
    if (Number.isFinite(video.durationSeconds) && creator.max_video_post_duration_sec && video.durationSeconds > creator.max_video_post_duration_sec) {
      throw new PublishError(`TikTok allows videos up to ${creator.max_video_post_duration_sec} seconds for this account.`, 400, "duration_too_long");
    }
    const chunkSize = video.data.length < 10_000_000 ? video.data.length : tiktokChunkBytes;
    const chunkCount = Math.max(1, Math.floor(video.data.length / chunkSize));
    if (chunkCount > 1000) throw new PublishError("TikTok video uploads cannot exceed 1,000 chunks.", 400, "too_many_chunks");
    const { data } = await fetchJson(fetchImpl, `${tiktokBase}/post/publish/video/init/`, {
      method: "POST",
      headers: { authorization: `Bearer ${fresh.accessToken}`, "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: { title: caption, privacy_level: privacy, disable_comment: Boolean(post.disableComments), disable_duet: Boolean(post.disableDuet), disable_stitch: Boolean(post.disableStitch), is_aigc: Boolean(post.disclosure) },
        source_info: { source: "FILE_UPLOAD", video_size: video.data.length, chunk_size: chunkSize, total_chunk_count: chunkCount },
      }),
    }, "TikTok");
    publishId = data.data?.publish_id;
    const uploadUrl = data.data?.upload_url;
    if (!publishId || !uploadUrl) throw new PublishError("TikTok did not provide a video upload session.");
    let parsedUploadUrl;
    try { parsedUploadUrl = new URL(uploadUrl); } catch { throw new PublishError("TikTok returned an invalid video upload URL."); }
    if (parsedUploadUrl.protocol !== "https:" || !parsedUploadUrl.hostname.endsWith(".tiktokapis.com")) throw new PublishError("TikTok returned an unexpected video upload host.");
    let start = 0;
    for (let index = 0; index < chunkCount; index++) {
      const endExclusive = index === chunkCount - 1 ? video.data.length : start + chunkSize;
      const chunk = video.data.subarray(start, endExclusive);
      let uploadResponse;
      let uploadError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          uploadResponse = await fetchImpl(uploadUrl, { method: "PUT", headers: { "content-type": video.type, "content-length": String(chunk.length), "content-range": `bytes ${start}-${endExclusive - 1}/${video.data.length}` }, body: chunk });
          if (uploadResponse.status < 500 || attempt === 2) break;
        } catch {
          if (attempt === 2) uploadError = true;
        }
      }
      if (!uploadResponse || uploadResponse.status >= 500) {
        if (index === chunkCount - 1) {
          const uncertain = await checkTikTokPublishOutcome(fetchImpl, fresh.accessToken, publishId, options);
          if (uncertain.status === "published" || uncertain.status === "publishing") return { account: fresh, result: { provider: "tiktok", ...uncertain, publishId, profile: fresh.profile, privacyLevel: privacy } };
        }
        throw new PublishError(uploadError ? "TikTok's media upload did not finish. Check the publishing status before retrying." : `TikTok's media upload failed with HTTP ${uploadResponse?.status || "unknown"}. Check the publishing status before retrying.`, 502, "upload_failed", { ambiguous: index === chunkCount - 1 });
      }
      const expectedStatus = index === chunkCount - 1 ? 201 : 206;
      if (uploadResponse.status !== expectedStatus) {
        if (index === chunkCount - 1) {
          const uncertain = await checkTikTokPublishOutcome(fetchImpl, fresh.accessToken, publishId, options);
          if (uncertain.status === "published" || uncertain.status === "publishing") return { account: fresh, result: { provider: "tiktok", ...uncertain, publishId, profile: fresh.profile, privacyLevel: privacy } };
        }
        throw new PublishError(`TikTok's media upload returned HTTP ${uploadResponse.status}; expected ${expectedStatus} for this chunk.`, 502, "upload_failed", { ambiguous: index === chunkCount - 1 });
      }
      start = endExclusive;
    }
  } else if (type === "Photo") {
    requireMedia(media, tiktokPhotoMimeTypes, "TikTok photo", 35);
    if (media.some(file => file.data.length > tiktokPhotoMaxBytes)) throw new PublishError("TikTok photos must be 20 MB or smaller each.", 400, "file_too_large");
    if (caption.length > 4000 + 90) throw new PublishError("TikTok photo text can contain at most 4,090 UTF-16 code units across title and description.", 400, "caption_too_long");
    const [firstLine = "", ...descriptionLines] = caption.split(/\r?\n/);
    const title = firstLine.trim();
    const description = descriptionLines.join("\n").trim();
    if (title.length > 90) throw new PublishError("TikTok photo titles can contain at most 90 UTF-16 code units.", 400, "title_too_long");
    if (description.length > 4000) throw new PublishError("TikTok photo descriptions can contain at most 4,000 UTF-16 code units.", 400, "description_too_long");
    const assets = await createPublicMediaAssets(media, options);
    let data;
    try {
      ({ data } = await fetchJson(fetchImpl, `${tiktokBase}/post/publish/content/init/`, {
        method: "POST",
        headers: { authorization: `Bearer ${fresh.accessToken}`, "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
          post_info: { title, description, privacy_level: privacy, disable_comment: Boolean(post.disableComments), auto_add_music: Boolean(post.autoAddMusic) },
          source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: assets.map(asset => asset.url) },
          post_mode: "DIRECT_POST",
          media_type: "PHOTO",
          is_aigc: Boolean(post.disclosure),
        }),
      }, "TikTok"));
    } catch (error) {
      if (error.code === "network_error" || error.status >= 500) error.ambiguous = true;
      throw error;
    }
    publishId = data.data?.publish_id;
    if (!publishId) throw new PublishError("TikTok did not return a photo publishing ID. Check the account before retrying.", 502, "missing_publish_id", { ambiguous: true });
  } else throw new PublishError("Choose Video or Photo for TikTok.", 400, "unsupported_post_type");

  let result;
  try { result = await pollTikTokPublish(fetchImpl, fresh.accessToken, publishId, options); }
  catch (error) {
    if (error.code !== "publish_failed") error.ambiguous = true;
    throw error;
  }
  return { account: fresh, result: { provider: "tiktok", ...result, publishId, profile: fresh.profile, privacyLevel: privacy } };
}

function youtubeTitleAndDescription(text) {
  const lines = (text || "").split(/\r?\n/);
  const first = lines.findIndex(line => line.trim());
  if (first < 0) return { title: "Postly video", description: "" };
  const title = lines[first].trim().slice(0, 100);
  const description = [lines.slice(0, first).join("\n"), lines.slice(first + 1).join("\n")].filter(Boolean).join("\n").trim();
  return { title, description };
}

async function pollYouTubeProcessing(fetchImpl, token, videoId, options = {}) {
  const maxWaitMs = options.youtubeMaxWaitMs ?? 120_000;
  const pollIntervalMs = options.youtubePollIntervalMs ?? 10_000;
  const sleep = options.sleepImpl || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const until = Date.now() + maxWaitMs;
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.search = new URLSearchParams({ part: "status,processingDetails", id: videoId }).toString();
  while (true) {
    let data;
    try {
      ({ data } = await fetchJson(fetchImpl, url, { headers: { authorization: `Bearer ${token}` } }, "YouTube"));
    } catch (error) {
      return { status: "publishing", providerStatus: "STATUS_CHECK_UNAVAILABLE", processingStatus: "unknown", statusError: error.message };
    }
    const video = data.items?.[0];
    if (video) {
      const uploadStatus = video.status?.uploadStatus || "unknown";
      const processingStatus = video.processingDetails?.processingStatus || "unknown";
      if (["failed", "deleted", "rejected"].includes(uploadStatus)) {
        const reason = video.status?.failureReason || video.status?.rejectionReason || uploadStatus;
        throw new PublishError(`YouTube could not finish this upload: ${reason}.`, 502, "upload_failed");
      }
      if (processingStatus === "failed") {
        const reason = video.processingDetails?.processingFailureReason || "processing_failed";
        throw new PublishError(`YouTube could not process this video: ${reason}.`, 502, "processing_failed");
      }
      if (uploadStatus === "processed" && ["succeeded", "terminated", "unknown"].includes(processingStatus)) {
        return { status: "published", providerStatus: uploadStatus, processingStatus };
      }
      if (processingStatus === "terminated" && uploadStatus !== "processed") {
        return { status: "publishing", providerStatus: uploadStatus, processingStatus };
      }
    }
    if (Date.now() >= until) {
      const video = data.items?.[0];
      return {
        status: "publishing",
        providerStatus: video?.status?.uploadStatus || "unknown",
        processingStatus: video?.processingDetails?.processingStatus || "unknown",
      };
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, until - Date.now())));
  }
}

async function publishYouTube(account, post, media, options) {
  const { env, fetchImpl } = options;
  requireYouTubeVideo(media);
  if (media[0].data.length > youtubeVideoMaxBytes) throw new PublishError("YouTube uploads cannot exceed 256 GB.", 400, "file_too_large");
  const fresh = await refreshAccountToken("youtube", account, options);
  const privacyStatus = ["private", "unlisted", "public"].includes(post.youtubePrivacyStatus) ? post.youtubePrivacyStatus : "private";
  const { title, description } = youtubeTitleAndDescription(post.text);
  const metadata = { snippet: { title, description }, status: { privacyStatus } };
  const initUrl = new URL("https://www.googleapis.com/upload/youtube/v3/videos");
  initUrl.search = new URLSearchParams({ uploadType: "resumable", part: "snippet,status" }).toString();
  let initResponse;
  try {
    initResponse = await fetchImpl(initUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${fresh.accessToken}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(media[0].data.length), "x-upload-content-type": media[0].type },
      body: JSON.stringify(metadata),
    });
  } catch { throw new PublishError("Could not start the YouTube upload. Check the server connection and try again.", 502, "network_error"); }
  const location = initResponse.headers.get("location");
  if (!initResponse.ok || !location) {
    const data = await responseData(initResponse);
    const detail = data?.error?.message;
    throw new PublishError(`YouTube rejected the upload${detail ? `: ${String(detail).slice(0, 400)}` : ` (HTTP ${initResponse.status})`}.`, initResponse.status === 401 ? 401 : 502, "provider_error");
  }
  let uploadUrl;
  try { uploadUrl = new URL(location); } catch { throw new PublishError("YouTube returned an invalid upload URL."); }
  if (uploadUrl.protocol !== "https:" || !["www.googleapis.com", "youtube.googleapis.com"].includes(uploadUrl.hostname)) throw new PublishError("YouTube returned an unexpected upload host.");
  let uploadResponse;
  try { uploadResponse = await fetchImpl(uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${fresh.accessToken}`, "content-type": media[0].type, "content-length": String(media[0].data.length) }, body: media[0].data }); }
  catch { throw new PublishError("The YouTube video upload did not finish. Check the account before retrying.", 502, "upload_failed", { ambiguous: true }); }
  let data;
  try { data = apiError(await responseData(uploadResponse), "YouTube", uploadResponse); }
  catch (error) {
    if (uploadResponse.status >= 500) error.ambiguous = true;
    throw error;
  }
  if (!data.id) throw new PublishError("YouTube did not confirm the uploaded video ID. Check the account before retrying.", 502, "missing_remote_id", { ambiguous: true });
  const profile = data.snippet?.channelTitle || fresh.profile;
  const userId = data.snippet?.channelId || fresh.userId;
  const processing = await pollYouTubeProcessing(fetchImpl, fresh.accessToken, data.id, options);
  return {
    account: { ...fresh, profile, userId },
    result: { provider: "youtube", ...processing, remoteId: data.id, profile, privacyStatus },
  };
}

async function readPublishingLedger(ledgerPath) {
  try {
    const saved = JSON.parse(await readFile(ledgerPath, "utf8"));
    return new Map(Object.entries(saved.entries || {}));
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw new PublishError("Postly could not read the publishing retry journal. Check its local data directory.", 503, "idempotency_store_unavailable");
  }
}

async function writePublishingLedgerEntry(ledgerPath, cacheKey, entry) {
  if (!ledgerPath) return;
  const write = idempotencyJournalWrite.catch(() => {}).then(async () => {
    const entries = await readPublishingLedger(ledgerPath);
    if (entry) entries.set(cacheKey, entry);
    else entries.delete(cacheKey);
    const now = Date.now();
    for (const [key, value] of entries) if (!Number.isFinite(value.expiresAt) || value.expiresAt <= now) entries.delete(key);
    const temporaryPath = `${ledgerPath}.${randomUUID()}.tmp`;
    await mkdir(resolve(ledgerPath, ".."), { recursive: true, mode: 0o700 });
    await writeFile(temporaryPath, JSON.stringify({ entries: Object.fromEntries(entries) }), { mode: 0o600 });
    await rename(temporaryPath, ledgerPath);
  });
  idempotencyJournalWrite = write.then(() => undefined, () => undefined);
  try { await write; }
  catch { throw new PublishError("Postly could not save the publishing retry journal. Check its local data directory.", 503, "idempotency_store_unavailable"); }
}

async function refreshCachedProviderOutcome(provider, account, result, options) {
  if (provider === "tiktok" && result.publishId) {
    const checked = await queryTikTokPublishStatus(account, result.publishId, options);
    if (checked.status === "failed") return { failed: new PublishError(`TikTok could not publish this post${checked.reason ? `: ${checked.reason}` : "."}`, 502, "publish_failed") };
    return { account: checked.account, result: { ...result, status: checked.status, providerStatus: checked.providerStatus, remoteId: checked.remoteId || result.remoteId || "" } };
  }

  if (provider === "instagram" && result.containerId) {
    const fresh = await refreshAccountToken("instagram", account, options);
    const userId = result.userId || fresh.userId;
    if (!userId) throw new PublishError("Instagram could not identify the connected account while checking this post.", 401, "reconnect_required");
    const version = metaVersion(options.env || process.env);
    const base = `https://graph.instagram.com/${version}`;
    const { data } = await instagramRequest(options.fetchImpl || fetch, `${base}/${result.containerId}`, { token: fresh.accessToken, params: { fields: "status_code,status" } });
    const status = data.status_code;
    if (status === "PUBLISHED") return { account: fresh, result: { ...result, status: "published", remoteId: result.remoteId || "", providerStatus: status } };
    if (["ERROR", "EXPIRED"].includes(status)) return { failed: new PublishError(`Instagram media processing failed: ${data.status || status}.`, 502, "media_processing_failed") };
    if (status === "FINISHED") {
      try {
        const published = await instagramRequest(options.fetchImpl || fetch, `${base}/${userId}/media_publish`, { token: fresh.accessToken, method: "POST", params: { creation_id: result.containerId } });
        if (published.data.id) return { account: fresh, result: { ...result, status: "published", remoteId: published.data.id, providerStatus: "PUBLISHED", publishAttempted: true } };
      } catch { /* Check the same container below; do not create a second one. */ }
      try {
        const checked = await instagramRequest(options.fetchImpl || fetch, `${base}/${result.containerId}`, { token: fresh.accessToken, params: { fields: "status_code,status" } });
        if (checked.data.status_code === "PUBLISHED") return { account: fresh, result: { ...result, status: "published", remoteId: result.remoteId || "", providerStatus: "PUBLISHED", publishAttempted: true } };
        return { account: fresh, result: { ...result, status: "publishing", providerStatus: checked.data.status_code || "PUBLISH_OUTCOME_UNCONFIRMED", publishAttempted: true } };
      } catch {
        return { account: fresh, result: { ...result, status: "publishing", providerStatus: "PUBLISH_OUTCOME_UNCONFIRMED", publishAttempted: true } };
      }
    }
    if (status === "IN_PROGRESS") return { account: fresh, result: { ...result, status: "publishing", providerStatus: status } };
    throw new PublishError(`Instagram returned an unrecognized media status${status ? ` (${status})` : ""}.`, 502, "invalid_provider_status", { ambiguous: true });
  }

  if (provider === "youtube" && result.remoteId) {
    const fresh = await refreshAccountToken("youtube", account, options);
    const processing = await pollYouTubeProcessing(options.fetchImpl || fetch, fresh.accessToken, result.remoteId, { ...options, youtubeMaxWaitMs: 0 });
    return { account: fresh, result: { ...result, ...processing } };
  }

  return { account, result };
}

export async function publishToProvider(provider, account, post, media, options = {}) {
  const fullOptions = { ...options, env: options.env || process.env, fetchImpl: options.fetchImpl || fetch, dataDir: options.dataDir };
  const postData = post && typeof post === "object" ? post : {};
  const mediaFiles = Array.isArray(media) ? media : [];
  if (!account?.accessToken) throw new PublishError(`${provider} is not connected. Connect the account first.`, 401, "account_not_connected");
  if (!["instagram", "tiktok", "youtube"].includes(provider)) throw new PublishError("This channel does not have a live publishing integration yet.", 501, "provider_not_supported");

  const explicitKey = postData.idempotencyKey ?? options.idempotencyKey;
  if (explicitKey !== undefined && (typeof explicitKey !== "string" || !explicitKey.trim() || explicitKey.length > 256)) {
    throw new PublishError("A valid publishing idempotency key is required.", 400, "invalid_idempotency_key");
  }
  const accountKey = account.userId || account.profile || "connected-account";
  const payloadHash = createHash("sha256");
  payloadHash.update(JSON.stringify({
    provider,
    accountId: accountKey,
    post: {
      text: postData.text || "",
      postType: postData.postType || "",
      tiktokPrivacyLevel: postData.tiktokPrivacyLevel || "",
      youtubePrivacyStatus: postData.youtubePrivacyStatus || "",
      disableComments: Boolean(postData.disableComments),
      disableDuet: Boolean(postData.disableDuet),
      disableStitch: Boolean(postData.disableStitch),
      autoAddMusic: Boolean(postData.autoAddMusic),
      disclosure: Boolean(postData.disclosure),
    },
    media: mediaFiles.map(item => ({ type: item.type, length: item.data?.length || 0 })),
  }));
  for (const item of mediaFiles) if (item.data) payloadHash.update(Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data));
  const fingerprint = payloadHash.digest("hex");
  const operationKey = explicitKey ? explicitKey.trim() : fingerprint;
  const cacheKey = createHash("sha256").update(`${provider}\0${accountKey}\0${operationKey}`).digest("hex");
  const lifetimeMs = explicitKey ? keyedIdempotencyLifetimeMs : defaultIdempotencyLifetimeMs;
  const ledgerPath = fullOptions.dataDir ? join(fullOptions.dataDir, idempotencyLedgerName) : "";

  const currentLock = idempotentPublishLocks.get(cacheKey);
  if (currentLock) return currentLock;

  const operation = (async () => {
    const now = Date.now();
    const entries = ledgerPath ? await readPublishingLedger(ledgerPath) : idempotentPublishes;
    for (const [key, value] of entries) if (!Number.isFinite(value.expiresAt) || value.expiresAt <= now) entries.delete(key);
    const cached = entries.get(cacheKey);
    if (cached && cached.fingerprint !== fingerprint && explicitKey) throw new PublishError("This publishing idempotency key was already used with different post content.", 409, "idempotency_conflict");
    if (cached && cached.fingerprint === fingerprint && cached.expiresAt > now) {
      if (["ambiguous", "in_flight"].includes(cached.state)) throw new PublishError(cached.message || "A previous publish request did not record its provider result. Check the account before retrying.", cached.status || 502, cached.code || "publish_outcome_unknown", { ambiguous: true });
      if (cached.state === "confirmed" && cached.result) {
        if (cached.result.status !== "publishing") return { account: { ...account, userId: cached.userId || account.userId, profile: cached.profile || account.profile }, result: cached.result };
        const refreshed = await refreshCachedProviderOutcome(provider, { ...account, userId: cached.userId || account.userId, profile: cached.profile || account.profile }, cached.result, fullOptions);
        if (refreshed.failed) {
          entries.delete(cacheKey);
          idempotentPublishes.delete(cacheKey);
          await writePublishingLedgerEntry(ledgerPath, cacheKey, null);
          throw refreshed.failed;
        }
        const updated = { ...cached, state: "confirmed", result: refreshed.result, userId: refreshed.account.userId || cached.userId || "", profile: refreshed.account.profile || cached.profile || "", expiresAt: Date.now() + lifetimeMs };
        entries.set(cacheKey, updated);
        idempotentPublishes.set(cacheKey, updated);
        try { await writePublishingLedgerEntry(ledgerPath, cacheKey, updated); } catch { /* The prior durable entry still contains the provider ID needed for another status check. */ }
        return { account: refreshed.account, result: refreshed.result };
      }
    }

    const persist = async entry => {
      if (entry) {
        entries.set(cacheKey, entry);
        idempotentPublishes.set(cacheKey, entry);
      } else {
        entries.delete(cacheKey);
        idempotentPublishes.delete(cacheKey);
      }
      await writePublishingLedgerEntry(ledgerPath, cacheKey, entry);
    };

    await persist({ fingerprint, state: "in_flight", message: "A previous publish request did not record its provider result. Check the account before retrying.", expiresAt: now + lifetimeMs });
    let providerCompleted = false;
    try {
      const outcome = provider === "instagram"
        ? await publishInstagram(account, postData, mediaFiles, fullOptions)
        : provider === "tiktok"
          ? await publishTikTok(account, postData, mediaFiles, fullOptions)
          : await publishYouTube(account, postData, mediaFiles, fullOptions);
      providerCompleted = true;
      const entry = {
        fingerprint,
        state: "confirmed",
        result: outcome.result,
        userId: outcome.account.userId || account.userId || "",
        profile: outcome.account.profile || account.profile || "",
        expiresAt: Date.now() + lifetimeMs,
      };
      try { await persist(entry); }
      catch {
        const uncertain = new PublishError("The provider returned a result but Postly could not save its retry record. Check the account before retrying.", 503, "idempotency_store_unavailable", { ambiguous: true });
        try { await persist({ ...entry, state: "ambiguous", message: uncertain.message, status: uncertain.status, code: uncertain.code }); } catch { /* The durable in-flight record still blocks a duplicate after restart. */ }
        throw uncertain;
      }
      return outcome;
    } catch (error) {
      if (error?.ambiguous || providerCompleted) {
        try { await persist({ fingerprint, state: "ambiguous", message: error.message, status: error.status, code: error.code, expiresAt: now + lifetimeMs }); }
        catch { /* The durable in-flight record still blocks a duplicate after restart. */ }
      } else {
        await persist(null);
      }
      throw error;
    }
  })();
  idempotentPublishLocks.set(cacheKey, operation);
  try { return await operation; }
  finally { if (idempotentPublishLocks.get(cacheKey) === operation) idempotentPublishLocks.delete(cacheKey); }
}

export async function queryTikTokPublishStatus(account, publishId, options = {}) {
  if (typeof publishId !== "string" || publishId.length < 4 || publishId.length > 64) throw new PublishError("A valid TikTok publishing ID is required.", 400, "invalid_publish_id");
  const fresh = await refreshAccountToken("tiktok", account, options);
  const { data } = await fetchJson(options.fetchImpl || fetch, `${tiktokBase}/post/publish/status/fetch/`, {
    method: "POST",
    headers: { authorization: `Bearer ${fresh.accessToken}`, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ publish_id: publishId }),
  }, "TikTok");
  const providerStatus = data.data?.status;
  if (!providerStatus) throw new PublishError("TikTok did not return a publishing status. Check again before retrying.", 502, "invalid_provider_status");
  const status = providerStatus === "PUBLISH_COMPLETE" ? "published" : ["FAILED", "PUBLISH_CANCELLED", "publish_cancelled"].includes(providerStatus) ? "failed" : "publishing";
  return { account: fresh, status, providerStatus, remoteId: safeProviderId(data.data?.publicaly_available_post_id?.[0]), reason: data.data?.fail_reason || "" };
}
