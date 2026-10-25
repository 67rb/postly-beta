import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  cleanupExpiredPublicMediaAssets,
  createPublicMediaAssets,
  publishToProvider,
  readPublicMediaAsset,
} from "../server/social-publishing.js";
import { createPublicMediaResponse } from "../server/public-media-http.js";

const tempRoot = await mkdtemp(join(tmpdir(), "postly-public-media-test-"));
const dataDir = join(tempRoot, "data");
const storageDir = join(tempRoot, "private-media");
const env = {
  PUBLIC_MEDIA_BASE_URL: "https://media.postly.com",
  PUBLIC_MEDIA_STORAGE_DIR: storageDir,
};
const checks = [];
const account = { accessToken: "mock-access-token", userId: "mock-instagram-user", profile: "mock.profile", expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000 };

async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}

async function fetchAsset(asset, init = {}) {
  const url = new URL(asset.url);
  return createPublicMediaResponse(new Request(url, init), url, id => readPublicMediaAsset(id, dataDir, { env }));
}

try {
  await check("Missing public URL fails with a configuration error before writing media", async () => {
    await assert.rejects(
      () => createPublicMediaAssets([{ name: "photo.jpg", type: "image/jpeg", data: Buffer.from("jpeg") }], { dataDir, env: {} }),
      error => error.code === "media_host_required" && /PUBLIC_MEDIA_BASE_URL/.test(error.message),
    );
    await assert.rejects(() => access(join(dataDir, "media")));
  });

  await check("Instagram publishing fails clearly without public media hosting and never calls the provider", async () => {
    let providerCalls = 0;
    await assert.rejects(
      () => publishToProvider("instagram", account, { text: "Mock post", postType: "Post" }, [{ name: "photo.jpg", type: "image/jpeg", data: Buffer.from("jpeg") }], {
        dataDir,
        env: {},
        fetchImpl: async () => { providerCalls++; throw new Error("Unexpected provider request"); },
      }),
      error => error.code === "media_host_required" && /PUBLIC_MEDIA_BASE_URL/.test(error.message),
    );
    assert.equal(providerCalls, 0);
  });

  await check("Public URL validation rejects insecure, local, reserved, credentialed, and routed bases", async () => {
    const invalid = [
      "http://media.postly.com",
      "https://localhost",
      "https://media.localhost",
      "https://127.0.0.1",
      "https://10.0.0.8",
      "https://[::1]",
      "https://media.example",
      "https://media.postly.com:8443",
      "https://media.postly.com/path",
      "https://user:pass@media.postly.com",
      "https://media.postly.com?token=value",
      "https://%",
    ];
    for (const PUBLIC_MEDIA_BASE_URL of invalid) {
      await assert.rejects(
        () => createPublicMediaAssets([{ name: "photo.jpg", type: "image/jpeg", data: Buffer.from("jpeg") }], { dataDir, env: { ...env, PUBLIC_MEDIA_BASE_URL } }),
        error => error.code === "public_media_required",
        PUBLIC_MEDIA_BASE_URL,
      );
    }
    await assert.rejects(
      () => createPublicMediaAssets([{ name: "photo.jpg", type: "image/jpeg", data: Buffer.from("jpeg") }], { dataDir, env: { ...env, PUBLIC_MEDIA_STORAGE_DIR: "relative-media" } }),
      error => error.code === "invalid_media_storage",
    );
  });

  let imageAssets;
  await check("Configured storage writes supported media under random UUIDs with private file permissions", async () => {
    imageAssets = await createPublicMediaAssets([
      { name: "photo.jpg", type: "image/jpeg", data: Buffer.from("jpeg-image") },
      { name: "photo.webp", type: "image/webp", data: Buffer.from("webp-image") },
    ], { dataDir, env });
    assert.equal(imageAssets.length, 2);
    assert.notEqual(imageAssets[0].id, imageAssets[1].id);
    for (const asset of imageAssets) {
      assert.match(asset.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
      assert.equal(asset.url, `https://media.postly.com/api/social/media/${asset.id}`);
      assert.ok(asset.file.startsWith(storageDir));
      assert.equal((await stat(asset.file)).mode & 0o777, 0o600);
      assert.equal((await stat(asset.metadata)).mode & 0o777, 0o600);
    }
  });

  await check("Unsupported and empty media are rejected before an asset URL is returned", async () => {
    await assert.rejects(
      () => createPublicMediaAssets([{ name: "active.svg", type: "image/svg+xml", data: Buffer.from("<svg />") }], { dataDir, env }),
      error => error.code === "unsupported_media",
    );
    await assert.rejects(
      () => createPublicMediaAssets([{ name: "empty.jpg", type: "image/jpeg", data: Buffer.alloc(0) }], { dataDir, env }),
      error => error.code === "empty_media",
    );
  });

  await check("Per-file and aggregate size limits are checked before any media is written", async () => {
    const perFileDir = join(tempRoot, "too-large-file");
    await assert.rejects(
      () => createPublicMediaAssets([{ name: "large.jpg", type: "image/jpeg", data: Buffer.from("123456") }], { dataDir, env: { ...env, PUBLIC_MEDIA_STORAGE_DIR: perFileDir }, maxBytes: 5 }),
      error => error.code === "file_too_large",
    );
    await assert.rejects(() => access(perFileDir));

    const aggregateDir = join(tempRoot, "too-large-total");
    await assert.rejects(
      () => createPublicMediaAssets([
        { name: "one.jpg", type: "image/jpeg", data: Buffer.from("123") },
        { name: "two.jpg", type: "image/jpeg", data: Buffer.from("456") },
      ], { dataDir, env: { ...env, PUBLIC_MEDIA_STORAGE_DIR: aggregateDir }, maxBytes: 5 }),
      error => error.code === "request_too_large",
    );
    await assert.rejects(() => access(aggregateDir));
  });

  await check("Public GET returns provider-fetchable bytes, MIME, length, and byte ranges", async () => {
    const asset = imageAssets[0];
    const response = await fetchAsset(asset);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(response.headers.get("content-length"), "10");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await response.text(), "jpeg-image");

    const ranged = await fetchAsset(asset, { headers: { range: "bytes=1-3" } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range"), "bytes 1-3/10");
    assert.equal(await ranged.text(), "peg");
  });

  await check("Public HEAD returns headers without a body; unsupported methods and paths fail closed", async () => {
    const asset = imageAssets[0];
    const head = await fetchAsset(asset, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "10");
    assert.equal(await head.text(), "");

    const url = new URL(asset.url);
    const post = await createPublicMediaResponse(new Request(url, { method: "POST" }), url, id => readPublicMediaAsset(id, dataDir, { env }));
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
    const badPath = new URL("https://media.postly.com/api/social/media/../../package.json");
    const missing = await createPublicMediaResponse(new Request(badPath), badPath, id => readPublicMediaAsset(id, dataDir, { env }));
    assert.equal(missing.status, 404);
  });

  await check("Expired media stops serving and cleanup removes expired and abandoned files", async () => {
    const expiring = imageAssets[1];
    const metadata = JSON.parse(await readFile(expiring.metadata, "utf8"));
    metadata.expiresAt = Date.now() - 1;
    await writeFile(expiring.metadata, JSON.stringify(metadata));
    const expiredResponse = await fetchAsset(expiring);
    assert.equal(expiredResponse.status, 404);
    await assert.rejects(() => access(expiring.file));

    const abandonedId = randomUUID();
    const abandoned = join(storageDir, `${abandonedId}.jpg`);
    await writeFile(abandoned, Buffer.from("orphan"));
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(abandoned, oldTime, oldTime);
    await cleanupExpiredPublicMediaAssets(dataDir, { env });
    await assert.rejects(() => access(abandoned));
    await assert.rejects(() => access(expiring.metadata));
  });

  console.log(`SUCCESS ${checks.length} public media checks`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
