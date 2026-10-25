import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPublicMediaAssets,
  publishToProvider,
  queryTikTokCreatorInfo,
  readPublicMediaAsset,
  refreshAccountToken,
} from "../server/social-publishing.js";

const dataDir = await mkdtemp(join(tmpdir(), "postly-publish-test-"));
const checks = [];
const apiResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const account = { accessToken: "test-access-token", refreshToken: "test-refresh-token", userId: "creator-123", profile: "test.creator", expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000 };
const tiktokCreatorInfo = { data: { creator_username: "test.creator", creator_nickname: "Test Creator", privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], comment_disabled: false, duet_disabled: false, stitch_disabled: false, max_video_post_duration_sec: 300 }, error: { code: "ok", message: "" } };
const options = { dataDir, env: { PUBLIC_MEDIA_BASE_URL: "https://media.postly.com" } };

async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}

try {
  await check("TikTok refresh rotates expired access and refresh tokens", async () => {
    const refreshed = await refreshAccountToken("tiktok", { ...account, expiresAt: Date.now() - 1 }, {
      env: { TIKTOK_CLIENT_KEY: "test-key", TIKTOK_CLIENT_SECRET: "test-secret" },
      fetchImpl: async (url, init) => {
        assert.equal(String(url), "https://open.tiktokapis.com/v2/oauth/token/");
        assert.equal(new URLSearchParams(init.body).get("grant_type"), "refresh_token");
        assert.equal(new URLSearchParams(init.body).get("refresh_token"), "test-refresh-token");
        return apiResponse({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600, refresh_expires_in: 31_536_000 });
      },
    });
    assert.equal(refreshed.accessToken, "rotated-access");
    assert.equal(refreshed.refreshToken, "rotated-refresh");
    assert.ok(refreshed.expiresAt > Date.now());
    assert.ok(refreshed.refreshExpiresAt > Date.now());
    assert.equal(refreshed.reauthorizationRequired, false);
  });

  await check("Instagram refreshes its long-lived token before expiry and records the new expiry", async () => {
    const refreshed = await refreshAccountToken("instagram", { ...account, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }, {
      fetchImpl: async url => {
        const target = new URL(url);
        assert.equal(target.origin, "https://graph.instagram.com");
        assert.equal(target.pathname, "/refresh_access_token");
        assert.equal(target.searchParams.get("grant_type"), "ig_refresh_token");
        assert.equal(target.searchParams.get("access_token"), "test-access-token");
        return apiResponse({ access_token: "refreshed-instagram-access", expires_in: 5_184_000 });
      },
    });
    assert.equal(refreshed.accessToken, "refreshed-instagram-access");
    assert.ok(refreshed.expiresAt > Date.now() + 50 * 24 * 60 * 60 * 1000);
    assert.ok(refreshed.tokenIssuedAt > 0);
  });

  await check("YouTube refresh preserves the existing refresh token when the provider omits a replacement", async () => {
    const refreshed = await refreshAccountToken("youtube", { ...account, expiresAt: Date.now() - 1, refreshExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 }, {
      env: { YOUTUBE_CLIENT_ID: "test-youtube-id", YOUTUBE_CLIENT_SECRET: "test-youtube-secret" },
      fetchImpl: async (url, init) => {
        assert.equal(String(url), "https://oauth2.googleapis.com/token");
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("grant_type"), "refresh_token");
        assert.equal(body.get("refresh_token"), "test-refresh-token");
        return apiResponse({ access_token: "refreshed-youtube-access", expires_in: 3600 });
      },
    });
    assert.equal(refreshed.accessToken, "refreshed-youtube-access");
    assert.equal(refreshed.refreshToken, "test-refresh-token");
    assert.ok(refreshed.expiresAt > Date.now());
    assert.ok(refreshed.refreshExpiresAt > Date.now());
  });

  await check("Expired Instagram access and refresh grants require reauthorization", async () => {
    let called = false;
    await assert.rejects(refreshAccountToken("instagram", { ...account, expiresAt: Date.now() - 1 }, { fetchImpl: async () => { called = true; return apiResponse({}); } }), error => error.code === "reconnect_required");
    assert.equal(called, false);
  });

  await check("Rejected provider refresh grants return a sanitized reconnect error", async () => {
    await assert.rejects(refreshAccountToken("tiktok", { ...account, expiresAt: Date.now() - 1 }, {
      env: { TIKTOK_CLIENT_KEY: "test-key", TIKTOK_CLIENT_SECRET: "test-secret" },
      fetchImpl: async () => apiResponse({ error: "invalid_grant", error_description: "synthetic-private-provider-detail" }, 400),
    }), error => error.code === "reconnect_required" && !error.message.includes("synthetic-private"));
  });

  await check("TikTok creator options are queried before rendering publish settings", async () => {
    let called = false;
    const result = await queryTikTokCreatorInfo(account, { fetchImpl: async url => {
      called = true;
      assert.match(String(url), /creator_info\/query/);
      return apiResponse(tiktokCreatorInfo);
    } });
    assert.equal(called, true);
    assert.deepEqual(result.creator.privacy_level_options, ["PUBLIC_TO_EVERYONE", "SELF_ONLY"]);
  });

  await check("TikTok video posts upload sequential chunks and wait for provider completion", async () => {
    const size = 20_000_123;
    const video = Buffer.alloc(size, 7);
    const chunks = [];
    let initialized = false;
    let statusChecks = 0;
    let firstChunkAttempts = 0;
    const result = await publishToProvider("tiktok", account, { text: "A caption", postType: "Video", tiktokPrivacyLevel: "SELF_ONLY", disableComments: true, disclosure: true }, [{ name: "video.mp4", type: "video/mp4", data: video }], {
      ...options,
      fetchImpl: async (url, init = {}) => {
        const target = String(url);
        if (target.endsWith("creator_info/query/")) return apiResponse(tiktokCreatorInfo);
        if (target.endsWith("video/init/")) {
          const body = JSON.parse(init.body);
          assert.equal(body.post_info.privacy_level, "SELF_ONLY");
          assert.equal(body.post_info.disable_comment, true);
          assert.equal(body.post_info.is_aigc, true);
          assert.deepEqual(body.source_info, { source: "FILE_UPLOAD", video_size: size, chunk_size: 10_000_000, total_chunk_count: 2 });
          initialized = true;
          return apiResponse({ data: { publish_id: "video-publish-123", upload_url: "https://upload.tiktokapis.com/video/upload" }, error: { code: "ok" } });
        }
        if (init.method === "PUT") {
          assert.equal(initialized, true);
          if (init.headers["content-range"] === "bytes 0-9999999/20000123") {
            firstChunkAttempts++;
            if (firstChunkAttempts === 1) return new Response("temporary", { status: 503 });
          }
          chunks.push({ range: init.headers["content-range"], size: init.body.length });
          return new Response("", { status: chunks.length === 2 ? 201 : 206 });
        }
        if (target.endsWith("status/fetch/")) {
          statusChecks++;
          return apiResponse({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["tiktok-post-789"] }, error: { code: "ok" } });
        }
        throw new Error(`Unexpected endpoint ${target}`);
      },
    });
    assert.deepEqual(chunks, [
      { range: "bytes 0-9999999/20000123", size: 10_000_000 },
      { range: "bytes 10000000-20000122/20000123", size: 10_000_123 },
    ]);
    assert.equal(statusChecks, 1);
    assert.equal(firstChunkAttempts, 2);
    assert.equal(result.result.status, "published");
    assert.equal(result.result.remoteId, "tiktok-post-789");
  });

  await check("TikTok photo posts use the verified HTTPS media URL flow", async () => {
    let uploadedUrl = "";
    let initCalls = 0;
    let statusCalls = 0;
    const post = { text: "A photo caption\nMore detail", postType: "Photo", tiktokPrivacyLevel: "SELF_ONLY" };
    const media = [{ name: "image.webp", type: "image/webp", data: Buffer.from("webp-image") }];
    const result = await publishToProvider("tiktok", account, { text: "A photo caption\nMore detail", postType: "Photo", tiktokPrivacyLevel: "SELF_ONLY" }, [{ name: "image.webp", type: "image/webp", data: Buffer.from("webp-image") }], {
      ...options,
      fetchImpl: async (url, init = {}) => {
        const target = String(url);
        if (target.endsWith("creator_info/query/")) return apiResponse(tiktokCreatorInfo);
        if (target.endsWith("content/init/")) {
          initCalls++;
          const body = JSON.parse(init.body);
          assert.equal(body.post_mode, "DIRECT_POST");
          assert.equal(body.media_type, "PHOTO");
          assert.equal(body.post_info.title, "A photo caption");
          assert.equal(body.post_info.description, "More detail");
          uploadedUrl = body.source_info.photo_images[0];
          assert.match(uploadedUrl, /^https:\/\/media\.postly\.com\/api\/social\/media\//);
          return apiResponse({ data: { publish_id: "photo-publish-123" }, error: { code: "ok" } });
        }
        if (target.endsWith("status/fetch/")) { statusCalls++; return apiResponse({ data: { status: "PUBLISH_COMPLETE" }, error: { code: "ok" } }); }
        throw new Error(`Unexpected endpoint ${target}`);
      },
    });
    const retry = await publishToProvider("tiktok", account, post, media, {
      ...options,
      fetchImpl: async () => { throw new Error("A confirmed photo retry must not contact TikTok again."); },
    });
    const assetId = uploadedUrl.split("/").at(-1);
    const asset = await readPublicMediaAsset(assetId, dataDir);
    assert.equal(asset.metadata.type, "image/webp");
    assert.equal(asset.data.toString(), "webp-image");
    assert.equal(result.result.status, "published");
    assert.equal(retry.result.status, "published");
    assert.equal(initCalls, 1);
    assert.equal(statusCalls, 1);
  });

  await check("TikTok refreshes pending status without starting another post and does not invent a public ID", async () => {
    let initCalls = 0;
    let statusCalls = 0;
    const post = { text: "Pending TikTok status", postType: "Photo", tiktokPrivacyLevel: "SELF_ONLY" };
    const media = [{ name: "pending.jpg", type: "image/jpeg", data: Buffer.from("photo") }];
    const fetchImpl = async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith("creator_info/query/")) return apiResponse(tiktokCreatorInfo);
      if (target.endsWith("content/init/")) { initCalls++; return apiResponse({ data: { publish_id: "pending-publish-456" }, error: { code: "ok" } }); }
      if (target.endsWith("status/fetch/")) {
        statusCalls++;
        return apiResponse({ data: { status: statusCalls === 1 ? "PROCESSING_DOWNLOAD" : "PUBLISH_COMPLETE", publicaly_available_post_id: [] }, error: { code: "ok" } });
      }
      throw new Error(`Unexpected endpoint ${target}`);
    };
    const first = await publishToProvider("tiktok", account, post, media, { ...options, fetchImpl, tiktokMaxWaitMs: 0 });
    assert.equal(first.result.status, "publishing");
    assert.equal(first.result.providerStatus, "PROCESSING_DOWNLOAD");
    const checked = await publishToProvider("tiktok", account, post, media, { ...options, fetchImpl, tiktokMaxWaitMs: 0 });
    assert.equal(checked.result.status, "published");
    assert.equal(checked.result.remoteId, "");
    assert.equal(checked.result.providerStatus, "PUBLISH_COMPLETE");
    assert.equal(initCalls, 1);
    assert.equal(statusCalls, 2);
  });

  await check("Instagram image publishing creates then publishes a media container", async () => {
    let mediaUrl = "";
    let createCalls = 0;
    let publishCalls = 0;
    const post = { text: "Hello Instagram", postType: "Post" };
    const media = [{ name: "post.jpg", type: "image/jpeg", data: Buffer.from("jpeg-content") }];
    const result = await publishToProvider("instagram", account, { text: "Hello Instagram", postType: "Post" }, [{ name: "post.jpg", type: "image/jpeg", data: Buffer.from("jpeg-content") }], {
      ...options,
      fetchImpl: async (url, init = {}) => {
        const target = new URL(String(url));
        if (init.method === "POST" && target.pathname === "/v26.0/creator-123/media") {
          createCalls++;
          const params = new URLSearchParams(init.body);
          assert.equal(params.get("caption"), "Hello Instagram");
          mediaUrl = params.get("image_url");
          assert.ok(mediaUrl);
          return apiResponse({ id: "ig-container-1" });
        }
        if (init.method === "GET" && target.pathname === "/v26.0/ig-container-1") return apiResponse({ status_code: "FINISHED", status: "Ready" });
        if (init.method === "POST" && target.pathname === "/v26.0/creator-123/media_publish") {
          publishCalls++;
          assert.equal(new URLSearchParams(init.body).get("creation_id"), "ig-container-1");
          return apiResponse({ id: "ig-media-1" });
        }
        throw new Error(`Unexpected endpoint ${target}`);
      },
    });
    const retry = await publishToProvider("instagram", account, post, media, { ...options, fetchImpl: async () => { throw new Error("A confirmed Instagram retry must not contact Instagram again."); } });
    assert.equal(result.result.status, "published");
    assert.equal(retry.result.status, "published");
    assert.equal(result.result.remoteId, "ig-media-1");
    assert.equal(createCalls, 1);
    assert.equal(publishCalls, 1);
    assert.equal((await readPublicMediaAsset(mediaUrl.split("/").at(-1), dataDir)).data.toString(), "jpeg-content");
  });

  await check("Instagram only reports a published container after provider confirmation", async () => {
    let mediaPublishCalls = 0;
    let statusCalls = 0;
    const result = await publishToProvider("instagram", account, { text: "Lost response Instagram", postType: "Post" }, [{ name: "post.jpg", type: "image/jpeg", data: Buffer.from("lost-response-image") }], {
      ...options,
      fetchImpl: async (url, init = {}) => {
        const target = new URL(String(url));
        if (init.method === "POST" && target.pathname === "/v26.0/creator-123/media") return apiResponse({ id: "ig-lost-container" });
        if (init.method === "GET" && target.pathname === "/v26.0/ig-lost-container") { statusCalls++; return apiResponse({ status_code: statusCalls === 1 ? "FINISHED" : "PUBLISHED" }); }
        if (init.method === "POST" && target.pathname.endsWith("/media_publish")) { mediaPublishCalls++; throw new Error("Lost response after provider accepted publish"); }
        throw new Error(`Unexpected endpoint ${target}`);
      },
    });
    assert.equal(mediaPublishCalls, 1);
    assert.equal(statusCalls, 2);
    assert.equal(result.result.status, "published");
    assert.equal(result.result.providerStatus, "PUBLISHED");
    assert.equal(result.result.remoteId, "");
  });

  await check("Instagram retries the same pending container after media processing completes", async () => {
    let containerCreates = 0;
    let statusChecks = 0;
    let mediaPublishes = 0;
    const post = { text: "Instagram container pending", postType: "Post" };
    const media = [{ name: "pending.jpg", type: "image/jpeg", data: Buffer.from("pending-image") }];
    const fetchImpl = async (url, init = {}) => {
      const target = new URL(String(url));
      if (init.method === "POST" && target.pathname === "/v26.0/creator-123/media") { containerCreates++; return apiResponse({ id: "ig-pending-container" }); }
      if (init.method === "GET" && target.pathname === "/v26.0/ig-pending-container") {
        statusChecks++;
        return apiResponse({ status_code: statusChecks === 1 ? "IN_PROGRESS" : "FINISHED" });
      }
      if (init.method === "POST" && target.pathname.endsWith("/media_publish")) { mediaPublishes++; return apiResponse({ id: "ig-pending-media" }); }
      throw new Error(`Unexpected endpoint ${target}`);
    };
    const pending = await publishToProvider("instagram", account, post, media, { ...options, fetchImpl, instagramMaxWaitMs: 0 });
    assert.equal(pending.result.status, "publishing");
    assert.equal(pending.result.providerStatus, "IN_PROGRESS");
    const complete = await publishToProvider("instagram", account, post, media, { ...options, fetchImpl, instagramMaxWaitMs: 0 });
    assert.equal(complete.result.status, "published");
    assert.equal(complete.result.remoteId, "ig-pending-media");
    assert.equal(containerCreates, 1);
    assert.equal(statusChecks, 2);
    assert.equal(mediaPublishes, 1);
  });

  await check("Instagram carousels create child media containers before the album", async () => {
    const children = [];
    let parentChildren = "";
    const result = await publishToProvider("instagram", account, { text: "A small carousel", postType: "Post" }, [
      { name: "one.jpg", type: "image/jpeg", data: Buffer.from("one") },
      { name: "two.jpg", type: "image/jpeg", data: Buffer.from("two") },
    ], {
      ...options,
      fetchImpl: async (url, init = {}) => {
        const target = new URL(String(url));
        if (init.method === "POST" && target.pathname === "/v26.0/creator-123/media") {
          const params = new URLSearchParams(init.body);
          if (params.get("media_type") === "CAROUSEL") {
            parentChildren = params.get("children");
            return apiResponse({ id: "ig-album-container" });
          }
          assert.equal(params.get("is_carousel_item"), "true");
          const id = `ig-child-${children.length + 1}`;
          children.push(id);
          return apiResponse({ id });
        }
        if (init.method === "GET" && target.pathname === "/v26.0/ig-album-container") return apiResponse({ status_code: "FINISHED" });
        if (init.method === "POST" && target.pathname.endsWith("/media_publish")) return apiResponse({ id: "ig-album-media" });
        throw new Error(`Unexpected endpoint ${target}`);
      },
    });
    assert.deepEqual(children, ["ig-child-1", "ig-child-2"]);
    assert.equal(parentChildren, children.join(","));
    assert.equal(result.result.remoteId, "ig-album-media");
  });

  await check("Instagram rejects Stories with a clear supported-format message", async () => {
    await assert.rejects(() => publishToProvider("instagram", account, { text: "Story", postType: "Story" }, [{ name: "photo.jpg", type: "image/jpeg", data: Buffer.from("jpg") }], options), /Stories aren't supported/);
  });

  await check("Instagram rejects unsupported PNG and WebM media before provider calls", async () => {
    let requests = 0;
    const fetchImpl = async () => { requests++; throw new Error("Unsupported media must be rejected locally."); };
    await assert.rejects(() => publishToProvider("instagram", account, { text: "PNG", postType: "Post" }, [{ name: "post.png", type: "image/png", data: Buffer.from("png") }], { ...options, fetchImpl }), /does not support image\/png/);
    await assert.rejects(() => publishToProvider("instagram", account, { text: "WebM", postType: "Reel" }, [{ name: "clip.webm", type: "video/webm", data: Buffer.from("webm") }], { ...options, fetchImpl }), /does not support video\/webm/);
    assert.equal(requests, 0);
  });

  await check("public media hosting refuses localhost and plain HTTP", async () => {
    await assert.rejects(() => createPublicMediaAssets([{ name: "photo.jpg", type: "image/jpeg", data: Buffer.from("jpg") }], { dataDir, env: { PUBLIC_MEDIA_BASE_URL: "http://localhost:4174" } }), /public HTTPS/);
    await assert.rejects(() => createPublicMediaAssets([{ name: "photo.jpg", type: "image/jpeg", data: Buffer.from("jpg") }], { dataDir, env: { PUBLIC_MEDIA_BASE_URL: "https://127.0.0.1" } }), /public HTTPS/);
  });

  await check("YouTube uses a resumable upload and confirms processing before reporting Published", async () => {
    const videoBytes = Buffer.from("youtube-video-data");
    let uploadStarted = false;
    let statusChecks = 0;
    const result = await publishToProvider("youtube", account, { text: "Title line\nLonger description", postType: "Short" }, [{ name: "clip.mp4", type: "video/mp4", data: videoBytes }], {
      fetchImpl: async (url, init = {}) => {
        const target = new URL(String(url));
        if (init.method === "POST" && target.hostname === "www.googleapis.com") {
          const metadata = JSON.parse(init.body);
          assert.equal(target.searchParams.get("uploadType"), "resumable");
          assert.equal(metadata.snippet.title, "Title line");
          assert.equal(metadata.snippet.description, "Longer description");
          assert.equal(metadata.status.privacyStatus, "private");
          uploadStarted = true;
          return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test" } });
        }
        if (init.method === "PUT") {
          assert.equal(uploadStarted, true);
          assert.deepEqual(init.body, videoBytes);
          assert.equal(init.headers["content-type"], "video/mp4");
          return apiResponse({ id: "youtube-video-123", snippet: { channelId: "youtube-channel-1", channelTitle: "Test Channel" } });
        }
        if ((!init.method || init.method === "GET") && target.pathname === "/youtube/v3/videos") {
          statusChecks++;
          assert.equal(target.searchParams.get("part"), "status,processingDetails");
          return apiResponse({ items: [{ status: { uploadStatus: "processed" }, processingDetails: { processingStatus: "succeeded" } }] });
        }
        throw new Error(`Unexpected endpoint ${target}`);
      },
    });
    assert.equal(result.result.status, "published");
    assert.equal(result.result.remoteId, "youtube-video-123");
    assert.equal(result.result.privacyStatus, "private");
    assert.equal(result.result.providerStatus, "processed");
    assert.equal(result.result.processingStatus, "succeeded");
    assert.equal(statusChecks, 1);
    assert.equal(result.account.profile, "Test Channel");
    assert.equal(result.account.userId, "youtube-channel-1");
  });

  await check("YouTube pending uploads are rechecked by ID without starting a second upload", async () => {
    let uploadStarts = 0;
    let statusChecks = 0;
    const post = { text: "Processing title", postType: "Video" };
    const media = [{ name: "processing.mp4", type: "video/mp4", data: Buffer.from("processing-video") }];
    const fetchImpl = async (url, init = {}) => {
      const target = new URL(String(url));
      if (init.method === "POST" && target.hostname === "www.googleapis.com") {
        uploadStarts++;
        return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=processing" } });
      }
      if (init.method === "PUT") return apiResponse({ id: "youtube-processing-789" });
      if ((!init.method || init.method === "GET") && target.pathname === "/youtube/v3/videos") {
        statusChecks++;
        return apiResponse({ items: [{ status: { uploadStatus: statusChecks === 1 ? "uploaded" : "processed" }, processingDetails: { processingStatus: statusChecks === 1 ? "processing" : "succeeded" } }] });
      }
      throw new Error(`Unexpected endpoint ${target}`);
    };
    const pending = await publishToProvider("youtube", account, post, media, { ...options, fetchImpl, youtubeMaxWaitMs: 0 });
    assert.equal(pending.result.status, "publishing");
    const complete = await publishToProvider("youtube", account, post, media, { ...options, fetchImpl, youtubeMaxWaitMs: 0 });
    assert.equal(complete.result.status, "published");
    assert.equal(complete.result.remoteId, "youtube-processing-789");
    assert.equal(uploadStarts, 1);
    assert.equal(statusChecks, 2);
  });

  await check("YouTube provider processing failures include the provider reason and allow a later retry", async () => {
    let uploadStarts = 0;
    let statusChecks = 0;
    const post = { text: "Retry after processing failure", postType: "Video" };
    const media = [{ name: "retry.mp4", type: "video/mp4", data: Buffer.from("retry-video") }];
    const fetchImpl = async (url, init = {}) => {
      const target = new URL(String(url));
      if (init.method === "POST" && target.hostname === "www.googleapis.com") {
        uploadStarts++;
        return new Response(null, { status: 200, headers: { location: `https://www.googleapis.com/upload/youtube/v3/videos?upload_id=retry-${uploadStarts}` } });
      }
      if (init.method === "PUT") return apiResponse({ id: `youtube-retry-${uploadStarts}` });
      if ((!init.method || init.method === "GET") && target.pathname === "/youtube/v3/videos") {
        statusChecks++;
        return apiResponse({ items: [{ status: { uploadStatus: "processed" }, processingDetails: statusChecks === 1 ? { processingStatus: "failed", processingFailureReason: "transcodeFailed" } : { processingStatus: "succeeded" } }] });
      }
      throw new Error(`Unexpected endpoint ${target}`);
    };
    await assert.rejects(() => publishToProvider("youtube", account, post, media, { ...options, fetchImpl, youtubeMaxWaitMs: 0 }), /transcodeFailed/);
    const retried = await publishToProvider("youtube", account, post, media, { ...options, fetchImpl, youtubeMaxWaitMs: 0 });
    assert.equal(retried.result.status, "published");
    assert.equal(uploadStarts, 2);
    assert.equal(statusChecks, 2);
  });

  await check("explicit idempotency keys reject different content and empty keys", async () => {
    let publishCalls = 0;
    const media = [{ name: "keyed.jpg", type: "image/jpeg", data: Buffer.from("keyed-image") }];
    const fetchImpl = async (url, init = {}) => {
      const target = new URL(String(url));
      if (init.method === "POST" && target.pathname === "/v26.0/creator-123/media") return apiResponse({ id: "ig-keyed-container" });
      if (init.method === "GET" && target.pathname === "/v26.0/ig-keyed-container") return apiResponse({ status_code: "FINISHED" });
      if (init.method === "POST" && target.pathname.endsWith("/media_publish")) { publishCalls++; return apiResponse({ id: "ig-keyed-media" }); }
      throw new Error(`Unexpected endpoint ${target}`);
    };
    const basePost = { text: "Keyed first copy", postType: "Post", idempotencyKey: "same-post-key" };
    await publishToProvider("instagram", account, basePost, media, { ...options, fetchImpl });
    await assert.rejects(() => publishToProvider("instagram", account, { ...basePost, text: "Different copy" }, media, { ...options, fetchImpl }), error => error.code === "idempotency_conflict");
    await assert.rejects(() => publishToProvider("instagram", account, { ...basePost, idempotencyKey: "   " }, media, { ...options, fetchImpl }), error => error.code === "invalid_idempotency_key");
    assert.equal(publishCalls, 1);
  });

  await check("ambiguous YouTube upload outcomes are not sent a second time", async () => {
    let requests = 0;
    const post = { text: "Ambiguous YouTube", postType: "Video" };
    const media = [{ name: "ambiguous.mp4", type: "video/mp4", data: Buffer.from("ambiguous-video") }];
    const fetchImpl = async (url, init = {}) => {
      requests++;
      if (init.method === "POST") return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=ambiguous" } });
      throw new Error("Upload response was lost");
    };
    await assert.rejects(() => publishToProvider("youtube", account, post, media, { ...options, fetchImpl }), error => error.ambiguous === true);
    await assert.rejects(() => publishToProvider("youtube", account, post, media, { ...options, fetchImpl: async () => { requests++; throw new Error("Ambiguous retries must not contact YouTube."); } }), error => error.ambiguous === true);
    assert.equal(requests, 2);
  });

  console.log(`SUCCESS ${checks.length} social publishing checks`);
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
