import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createProbe } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDir = await mkdtemp(join(tmpdir(), "postly-deployment-auth-"));
const probe = createProbe();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const { port } = probe.address();
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const credentials = Buffer.from("postly-test:private-test-password").toString("base64");
let server;

try {
  server = spawn(process.execPath, ["server/index.js"], {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      APP_BASE_URL: base,
      OAUTH_REDIRECT_BASE: base,
      POSTLY_DISABLE_ENV_FILE: "1",
      POSTLY_DISABLE_SCHEDULER: "1",
      POSTLY_DATA_DIR: dataDir,
      TOKEN_ENCRYPTION_KEY: "a".repeat(64),
      POSTLY_BASIC_AUTH_USER: "postly-test",
      POSTLY_BASIC_AUTH_PASSWORD: "private-test-password",
    },
  });

  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, "production server starts with app-level authentication enabled");

  const unauthenticated = await fetch(`${base}/`);
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get("www-authenticate") || "", /^Basic realm="Postly"/);

  const wrongCredentials = await fetch(`${base}/`, { headers: { authorization: `Basic ${Buffer.from("postly-test:wrong").toString("base64")}` } });
  assert.equal(wrongCredentials.status, 401);

  const authenticated = await fetch(`${base}/`, { headers: { authorization: `Basic ${credentials}` } });
  assert.equal(authenticated.status, 200);
  assert.match(await authenticated.text(), /Postly/);

  const privateApi = await fetch(`${base}/api/social/status`);
  assert.equal(privateApi.status, 401);
  const authenticatedApi = await fetch(`${base}/api/social/status`, { headers: { authorization: `Basic ${credentials}` } });
  assert.equal(authenticatedApi.status, 200);

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);

  const media = await fetch(`${base}/api/social/media/not-a-real-asset`);
  assert.equal(media.status, 404);
  assert.notEqual(media.status, 401);

  console.log("PASS production app and API require Basic Auth; health and provider media remain reachable");
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise(resolve => server.once("exit", resolve));
  }
  await rm(dataDir, { recursive: true, force: true });
}
