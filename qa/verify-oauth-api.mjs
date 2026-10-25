import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const appOrigin = "http://localhost:4174";
const testKey = "a1".repeat(32);
const tokenMarkers = ["mock-instagram-short-token", "mock-instagram-long-token", "mock-tiktok-access-token", "mock-tiktok-refresh-token", "mock-youtube-access-token", "mock-youtube-refresh-token"];
const checks = [];

async function freePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

function launchServer(port, dataDir, redirectBase, mockLog, extraEnv = {}) {
  const env = {
    ...process.env,
    PORT: String(port), API_ONLY: "1", POSTLY_DATA_DIR: dataDir,
    APP_BASE_URL: appOrigin, OAUTH_REDIRECT_BASE: redirectBase,
    TOKEN_ENCRYPTION_KEY: testKey, POSTLY_OAUTH_MOCK_LOG: mockLog, POSTLY_DISABLE_ENV_FILE: "1", POSTLY_DISABLE_SCHEDULER: "1",
    INSTAGRAM_CLIENT_ID: "synthetic-instagram-id", INSTAGRAM_CLIENT_SECRET: "synthetic-instagram-secret",
    TIKTOK_CLIENT_KEY: "synthetic-tiktok-key", TIKTOK_CLIENT_SECRET: "synthetic-tiktok-secret",
    YOUTUBE_CLIENT_ID: "synthetic-youtube-id", YOUTUBE_CLIENT_SECRET: "synthetic-youtube-secret",
    ...extraEnv,
  };
  return spawn(process.execPath, ["--import", join(root, "qa/mock-oauth-provider.mjs"), "server/index.js"], { cwd: root, stdio: "ignore", env });
}

async function untilReady(base) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("OAuth API did not start.");
}

async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}

function parseCookie(response) {
  const header = response.headers.get("set-cookie") || "";
  const pair = header.split(";")[0];
  assert.ok(pair.includes("="), "OAuth response must set a state cookie");
  return pair;
}

function stateFrom(response) {
  const auth = new URL(response.headers.get("location"));
  return { auth, cookie: parseCookie(response), state: auth.searchParams.get("state") };
}

function mockRows() {
  try { return readFileSync(mockLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
  catch { return []; }
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), "postly-oauth-test-"));
const mockLog = join(dataDir, "provider-mocks.jsonl");
const server = launchServer(port, dataDir, base, mockLog);
let invalidServer;
let invalidDataDir;
let missingCredentialServer;
let missingCredentialDataDir;

try {
  await untilReady(base);
  await check("Provider status reports readiness, exact redirects, expiry fields, and no credentials", async () => {
    const response = await fetch(`${base}/api/social/status`);
    const { providers } = await response.json();
    for (const provider of ["instagram", "tiktok", "youtube"]) {
      assert.equal(providers[provider].configured, true);
      assert.equal(providers[provider].connected, false);
      assert.equal(providers[provider].readyToConnect, true);
      assert.equal(providers[provider].connectionState, "disconnected");
      assert.equal(providers[provider].expiresAt, null);
    }
    assert.deepEqual(providers.instagram.requiredEnvironmentKeys, ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"]);
    assert.deepEqual(providers.instagram.missingEnvironmentKeys, []);
    assert.deepEqual(providers.tiktok.requiredEnvironmentKeys, ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]);
    assert.deepEqual(providers.tiktok.missingEnvironmentKeys, []);
    assert.deepEqual(providers.youtube.requiredEnvironmentKeys, ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"]);
    assert.deepEqual(providers.youtube.missingEnvironmentKeys, []);
    assert.equal(providers.instagram.redirectUri, `${base}/api/social/instagram/callback`);
    assert.equal(providers.tiktok.redirectUri, `${base}/api/social/tiktok/callback`);
    assert.equal(providers.youtube.redirectUri, `${base}/api/social/youtube/callback`);
    const serialized = JSON.stringify(providers);
    for (const secret of ["synthetic-instagram-secret", "synthetic-instagram-id", "synthetic-tiktok-secret", "synthetic-youtube-secret"]) assert.equal(serialized.includes(secret), false);
  });

  const authorization = {};
  for (const [provider, authHost, clientParam, expectedScopes] of [
    ["instagram", "www.instagram.com", "client_id", ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments", "instagram_business_manage_insights"]],
    ["tiktok", "www.tiktok.com", "client_key", ["user.info.basic", "user.info.profile", "user.info.stats", "video.list", "video.publish"]],
    ["youtube", "accounts.google.com", "client_id", ["youtube.upload", "youtube.readonly", "youtube.force-ssl", "yt-analytics.readonly"]],
  ]) await check(`${provider} authorization uses documented scopes and a browser-bound state cookie`, async () => {
    const response = await fetch(`${base}/api/social/${provider}/connect`, { redirect: "manual" });
    assert.equal(response.status, 302);
    const { auth, cookie, state } = stateFrom(response);
    assert.equal(auth.hostname, authHost);
    assert.ok(auth.searchParams.has(clientParam));
    const requestedScopes = decodeURIComponent(auth.searchParams.get("scope")).split(/[ ,]+/);
    for (const scope of expectedScopes) assert.ok(requestedScopes.some(requested => requested === scope || requested.endsWith(`/${scope}`)), `Missing ${scope}`);
    assert.equal(auth.searchParams.get("redirect_uri"), `${base}/api/social/${provider}/callback`);
    assert.equal(state.length, 43);
    assert.equal(cookie, `postly_oauth_state_${provider}=${state}`);
    assert.ok(response.headers.get("set-cookie").includes("HttpOnly"));
    assert.ok(response.headers.get("set-cookie").includes("SameSite=Lax"));
    assert.ok(response.headers.get("set-cookie").includes(`Path=/api/social/${provider}/callback`));
    assert.equal(auth.searchParams.has("client_secret"), false);
    if (provider === "youtube") {
      assert.equal(auth.searchParams.get("access_type"), "offline");
      assert.equal(auth.searchParams.get("include_granted_scopes"), "true");
    }
    authorization[provider] = { auth, cookie, state };
  });

  await check("Configured callback URLs ignore an untrusted Host header", async () => {
    const response = await fetch(`${base}/api/social/instagram/connect`, { headers: { host: "attacker.example" }, redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location")).searchParams.get("redirect_uri"), `${base}/api/social/instagram/callback`);
  });

  await check("OAuth callback rejects an unbound or untrusted state", async () => {
    const response = await fetch(`${base}/api/social/instagram/callback?code=synthetic-code&state=wrong`, { redirect: "manual" });
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get("location")).searchParams.get("social_error"), "invalid_state");
    assert.ok(response.headers.get("set-cookie").includes("Max-Age=0"));
  });

  await check("Provider denial is state-checked, sanitized, and does not exchange a code", async () => {
    const before = mockRows().length;
    const { state, cookie } = stateFrom(await fetch(`${base}/api/social/youtube/connect`, { redirect: "manual" }));
    const response = await fetch(`${base}/api/social/youtube/callback?state=${state}&error=access_denied&error_description=synthetic-private-detail`, { headers: { cookie }, redirect: "manual" });
    const location = new URL(response.headers.get("location"));
    assert.equal(location.searchParams.get("social_error"), "authorization_denied");
    assert.equal(location.searchParams.has("error_description"), false);
    assert.ok(response.headers.get("set-cookie").includes("Max-Age=0"));
    assert.equal(mockRows().length, before);
  });

  await check("Cross-provider, replayed, and code-less callbacks fail closed", async () => {
    const instagram = stateFrom(await fetch(`${base}/api/social/instagram/connect`, { redirect: "manual" }));
    const wrongProvider = await fetch(`${base}/api/social/tiktok/callback?state=${instagram.state}&code=synthetic-code`, { headers: { cookie: instagram.cookie }, redirect: "manual" });
    assert.equal(new URL(wrongProvider.headers.get("location")).searchParams.get("social_error"), "invalid_state");
    const tiktok = stateFrom(await fetch(`${base}/api/social/tiktok/connect`, { redirect: "manual" }));
    const noCode = await fetch(`${base}/api/social/tiktok/callback?state=${tiktok.state}`, { headers: { cookie: tiktok.cookie }, redirect: "manual" });
    assert.equal(new URL(noCode.headers.get("location")).searchParams.get("social_error"), "missing_code");
  });

  await check("Exchange failures stay generic and Instagram never stores a short-lived fallback", async () => {
    for (const code of ["synthetic-exchange-error", "synthetic-long-lived-failure"]) {
      const { state, cookie } = stateFrom(await fetch(`${base}/api/social/instagram/connect`, { redirect: "manual" }));
      const callback = await fetch(`${base}/api/social/instagram/callback?state=${state}&code=${code}`, { headers: { cookie }, redirect: "manual" });
      assert.equal(callback.status, 303);
      const location = new URL(callback.headers.get("location"));
      assert.equal(location.searchParams.get("social_error"), "instagram_exchange_failed");
      assert.equal(location.toString().includes("synthetic-private"), false);
      assert.ok(callback.headers.get("set-cookie").includes("Max-Age=0"));
      const status = (await (await fetch(`${base}/api/social/status`)).json()).providers.instagram;
      assert.equal(status.connected, false);
      assert.equal(status.connectionState, "disconnected");
    }
    const stored = (() => { try { return readFileSync(join(dataDir, "accounts.enc"), "utf8"); } catch { return ""; } })();
    assert.equal(stored.includes("mock-instagram-short-token"), false);
    assert.equal(stored.includes("synthetic-private-token"), false);
  });

  await check("Provider callback exchanges use the registered redirect and store only encrypted tokens", async () => {
    for (const provider of ["instagram", "tiktok", "youtube"]) {
      const { state, cookie } = stateFrom(await fetch(`${base}/api/social/${provider}/connect`, { redirect: "manual" }));
      const response = await fetch(`${base}/api/social/${provider}/callback?state=${state}&code=synthetic-code-${provider}`, { headers: { cookie }, redirect: "manual" });
      assert.equal(response.status, 303);
      assert.equal(new URL(response.headers.get("location")).searchParams.get("connected"), provider);
      assert.ok(response.headers.get("set-cookie").includes("Max-Age=0"));
      const replay = await fetch(`${base}/api/social/${provider}/callback?state=${state}&code=synthetic-code-${provider}`, { headers: { cookie }, redirect: "manual" });
      assert.equal(new URL(replay.headers.get("location")).searchParams.get("social_error"), "invalid_state");
    }
    const { providers } = await (await fetch(`${base}/api/social/status`)).json();
    for (const provider of ["instagram", "tiktok", "youtube"]) {
      assert.equal(providers[provider].connected, true);
      assert.equal(providers[provider].connectionState, "connected");
      assert.ok(providers[provider].expiresAt > Date.now());
      assert.equal(providers[provider].publishReady, true);
      assert.equal(providers[provider].needsReauthorization, false);
    }
    assert.equal(providers.instagram.profile, "mock.ig");
    assert.equal(providers.tiktok.profile, "Mock TikTok");
    assert.equal(providers.youtube.profile, "Mock YouTube Channel");
    assert.ok(providers.tiktok.refreshExpiresAt > Date.now());
    const encrypted = readFileSync(join(dataDir, "accounts.enc"), "utf8");
    for (const token of tokenMarkers) assert.equal(encrypted.includes(token), false);
    assert.deepEqual(Object.keys(JSON.parse(encrypted)).sort(), ["data", "iv", "tag"]);
    assert.equal(statSync(join(dataDir, "accounts.enc")).mode & 0o777, 0o600);
    assert.equal(statSync(dataDir).mode & 0o777, 0o700);
    const rows = mockRows();
    for (const provider of ["instagram", "tiktok", "youtube"]) {
      const tokenRequest = rows.find(row => row.grantType === "authorization_code" && row.redirectUri === `${base}/api/social/${provider}/callback`);
      assert.ok(tokenRequest, `${provider} exchange must use the same registered redirect URI`);
      assert.equal(tokenRequest.clientSecretPresent, true);
      assert.equal(tokenRequest.codePresent, true);
    }
    assert.ok(rows.some(row => row.path === "/access_token" && row.accessTokenQueryPresent));
    assert.ok(rows.some(row => row.path === "/me" && row.bearerHeaderPresent && !row.accessTokenQueryPresent));
  });

  await check("Expired Instagram tokens are reported as requiring reauthorization", async () => {
    const { state, cookie } = stateFrom(await fetch(`${base}/api/social/instagram/connect`, { redirect: "manual" }));
    const callback = await fetch(`${base}/api/social/instagram/callback?state=${state}&code=synthetic-expiring-code`, { headers: { cookie }, redirect: "manual" });
    assert.equal(callback.status, 303);
    await new Promise(resolve => setTimeout(resolve, 1_100));
    const { providers } = await (await fetch(`${base}/api/social/status`)).json();
    assert.equal(providers.instagram.configured, true);
    assert.equal(providers.instagram.connected, false);
    assert.equal(providers.instagram.readyToConnect, true);
    assert.equal(providers.instagram.connectionState, "reauthorization_required");
    assert.equal(providers.instagram.accessTokenExpired, true);
    assert.equal(providers.instagram.needsReauthorization, true);
    assert.equal(providers.instagram.refreshCredentialAvailable, false);
  });

  await check("Expired TikTok access uses its unexpired refresh grant and persists the new expiry", async () => {
    const { state, cookie } = stateFrom(await fetch(`${base}/api/social/tiktok/connect`, { redirect: "manual" }));
    const callback = await fetch(`${base}/api/social/tiktok/callback?state=${state}&code=synthetic-expiring-tiktok`, { headers: { cookie }, redirect: "manual" });
    assert.equal(callback.status, 303);
    await new Promise(resolve => setTimeout(resolve, 1_100));
    const expired = (await (await fetch(`${base}/api/social/status`)).json()).providers.tiktok;
    assert.equal(expired.connected, true);
    assert.equal(expired.connectionState, "refresh_required");
    assert.equal(expired.accessTokenExpired, true);
    assert.equal(expired.refreshCredentialAvailable, true);
    const creator = await fetch(`${base}/api/social/tiktok/creator-info`);
    assert.equal(creator.status, 200);
    const refreshed = (await (await fetch(`${base}/api/social/status`)).json()).providers.tiktok;
    assert.equal(refreshed.connected, true);
    assert.equal(refreshed.connectionState, "connected");
    assert.equal(refreshed.accessTokenExpired, false);
    assert.ok(refreshed.expiresAt > Date.now());
    assert.ok(mockRows().some(row => row.host === "open.tiktokapis.com" && row.grantType === "refresh_token"));
  });

  await check("A rejected TikTok refresh grant changes status to reauthorization required", async () => {
    const { state, cookie } = stateFrom(await fetch(`${base}/api/social/tiktok/connect`, { redirect: "manual" }));
    const callback = await fetch(`${base}/api/social/tiktok/callback?state=${state}&code=synthetic-revoked-tiktok`, { headers: { cookie }, redirect: "manual" });
    assert.equal(callback.status, 303);
    await new Promise(resolve => setTimeout(resolve, 1_100));
    const failedRefresh = await fetch(`${base}/api/social/tiktok/creator-info`);
    assert.equal(failedRefresh.status, 401);
    const failure = await failedRefresh.json();
    assert.equal(failure.code, "reconnect_required");
    assert.equal(failure.error.includes("synthetic-private"), false);
    const status = (await (await fetch(`${base}/api/social/status`)).json()).providers.tiktok;
    assert.equal(status.connected, false);
    assert.equal(status.readyToConnect, true);
    assert.equal(status.connectionState, "reauthorization_required");
    assert.equal(status.needsReauthorization, true);
  });

  await check("Insights rejects impossible and reversed date ranges", async () => {
    for (const query of ["since=2026-02-30&until=2026-03-01", "since=2026-10-24&until=2026-10-23"]) {
      const response = await fetch(`${base}/api/social/insights?${query}`);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "invalid_date_range");
    }
  });

  await check("Publishing, replies, and disconnect reject missing or foreign Origin headers", async () => {
    const form = new FormData();
    form.append("post", JSON.stringify({ text: "synthetic post" }));
    const missingOrigin = await fetch(`${base}/api/social/instagram/publish`, { method: "POST", body: form });
    assert.equal(missingOrigin.status, 403);
    assert.equal((await missingOrigin.json()).code, "origin_rejected");
    const crossOrigin = await fetch(`${base}/api/social/instagram/publish`, { method: "POST", headers: { origin: "https://untrusted.example" }, body: form });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await crossOrigin.json()).code, "origin_rejected");
    const reply = await fetch(`${base}/api/social/youtube/comments/comment-id/reply`, { method: "POST", headers: { origin: "https://untrusted.example", "content-type": "application/json" }, body: JSON.stringify({ text: "synthetic reply" }) });
    assert.equal(reply.status, 403);
    const disconnect = await fetch(`${base}/api/social/youtube/disconnect`, { method: "POST" });
    assert.equal(disconnect.status, 403);
  });

  await check("Disconnect deletes encrypted local tokens and reports provider revocation", async () => {
    for (const [provider, revocation] of [["instagram", "local_only"], ["tiktok", "revoked"], ["youtube", "revoked"]]) {
      const response = await fetch(`${base}/api/social/${provider}/disconnect`, { method: "POST", headers: { origin: appOrigin } });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, disconnected: true, revocation });
      const status = await (await fetch(`${base}/api/social/status`)).json();
      assert.equal(status.providers[provider].connected, false);
      assert.equal(status.providers[provider].connectionState, "disconnected");
      assert.equal(status.providers[provider].readyToConnect, true);
    }
    const encrypted = readFileSync(join(dataDir, "accounts.enc"), "utf8");
    for (const token of tokenMarkers) assert.equal(encrypted.includes(token), false);
  });

  await check("Disconnected publishing, Insights, and Community remain truthful", async () => {
    const form = new FormData();
    form.append("post", JSON.stringify({ text: "synthetic post" }));
    const publish = await fetch(`${base}/api/social/instagram/publish`, { method: "POST", headers: { origin: appOrigin }, body: form });
    assert.equal(publish.status, 401);
    assert.equal((await publish.json()).code, "account_not_connected");
    const insightsResponse = await fetch(`${base}/api/social/insights?since=2026-10-01&until=2026-10-23`);
    assert.equal(insightsResponse.status, 200);
    const insights = await insightsResponse.json();
    assert.deepEqual(insights.accounts, []);
    assert.equal(insights.summary.followers, null);
    assert.equal(insights.summary.reactions, 0);
    const communityResponse = await fetch(`${base}/api/social/community?kind=comments`);
    assert.equal(communityResponse.status, 200);
    assert.deepEqual((await communityResponse.json()).items, []);
  });

  await check("An unreadable account store is reported as an error rather than disconnected", async () => {
    writeFileSync(join(dataDir, "accounts.enc"), "not-an-encrypted-account-store");
    const response = await fetch(`${base}/api/social/status`);
    const { providers } = await response.json();
    assert.equal(response.status, 200);
    assert.equal(providers.instagram.connected, null);
    assert.equal(providers.instagram.readyToConnect, false);
    assert.equal(providers.instagram.error, "account_store_unavailable");
    assert.equal(providers.instagram.configured, true);
    assert.equal(JSON.stringify(providers).includes("not-an-encrypted-account-store"), false);
  });

  await check("Invalid redirect configuration stays distinct from missing credentials", async () => {
    const invalidPort = await freePort();
    const invalidBase = `http://127.0.0.1:${invalidPort}`;
    invalidDataDir = mkdtempSync(join(tmpdir(), "postly-oauth-config-test-"));
    invalidServer = launchServer(invalidPort, invalidDataDir, "https://redirect.example/path", join(invalidDataDir, "provider-mocks.jsonl"));
    await untilReady(invalidBase);
    const { providers } = await (await fetch(`${invalidBase}/api/social/status`)).json();
    assert.equal(providers.instagram.configured, true);
    assert.equal(providers.instagram.connected, false);
    assert.equal(providers.instagram.error, "oauth_configuration_error");
    assert.equal(providers.instagram.readyToConnect, false);
    assert.equal(providers.instagram.redirectUri, null);
    const response = await fetch(`${invalidBase}/api/social/instagram/connect`, { redirect: "manual" });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, "oauth_configuration_error");
  });

  await check("Missing provider credentials are named and block only that provider's connection", async () => {
    const missingPort = await freePort();
    const missingBase = `http://127.0.0.1:${missingPort}`;
    missingCredentialDataDir = mkdtempSync(join(tmpdir(), "postly-oauth-missing-test-"));
    missingCredentialServer = launchServer(missingPort, missingCredentialDataDir, missingBase, join(missingCredentialDataDir, "provider-mocks.jsonl"), { TIKTOK_CLIENT_KEY: "", TIKTOK_CLIENT_SECRET: "" });
    await untilReady(missingBase);
    const { providers } = await (await fetch(`${missingBase}/api/social/status`)).json();
    assert.equal(providers.tiktok.configured, false);
    assert.equal(providers.tiktok.connected, false);
    assert.equal(providers.tiktok.readyToConnect, false);
    assert.equal(providers.tiktok.error, null);
    assert.deepEqual(providers.tiktok.missingEnvironmentKeys, ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]);
    assert.equal(providers.instagram.configured, true);
    const response = await fetch(`${missingBase}/api/social/tiktok/connect`, { redirect: "manual" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.includes("not configured"), true);
  });

  console.log(`SUCCESS ${checks.length} OAuth API checks`);
} finally {
  server.kill("SIGTERM");
  await new Promise(resolve => server.once("exit", resolve));
  if (invalidServer) {
    invalidServer.kill("SIGTERM");
    await new Promise(resolve => invalidServer.once("exit", resolve));
  }
  if (missingCredentialServer) {
    missingCredentialServer.kill("SIGTERM");
    await new Promise(resolve => missingCredentialServer.once("exit", resolve));
  }
  rmSync(dataDir, { recursive: true, force: true });
  if (invalidDataDir) rmSync(invalidDataDir, { recursive: true, force: true });
  if (missingCredentialDataDir) rmSync(missingCredentialDataDir, { recursive: true, force: true });
}
