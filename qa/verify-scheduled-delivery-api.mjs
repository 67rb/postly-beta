import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDir = await mkdtemp(join(tmpdir(), "postly-scheduled-api-"));
const probe = createServer();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const { port } = probe.address();
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const checks = [];
let server;

function startServer() {
  return spawn(process.execPath, ["server/index.js"], {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(port),
      API_ONLY: "1",
      POSTLY_DISABLE_ENV_FILE: "1",
      POSTLY_DISABLE_SCHEDULER: "1",
      POSTLY_DATA_DIR: dataDir,
      APP_BASE_URL: base,
    },
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Postly scheduled delivery API did not start.");
}

async function stopServer() {
  if (!server) return;
  server.kill("SIGTERM");
  await new Promise(resolve => server.once("exit", resolve));
  server = null;
}

async function schedule(provider, postId, scheduledAt) {
  const form = new FormData();
  form.append("post", JSON.stringify({ text: `Mock schedule for ${provider}`, postType: "Post" }));
  form.append("schedule", JSON.stringify({ postId, scheduledAt }));
  return fetch(`${base}/api/scheduled-posts/${provider}`, { method: "POST", headers: { origin: base }, body: form });
}

try {
  server = startServer();
  await waitForServer();
  const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const instagram = await schedule("instagram", "api-post-1", scheduledAt);
  assert.equal(instagram.status, 201);
  const instagramJob = (await instagram.json()).job;
  assert.equal(instagramJob.status, "queued");
  const duplicate = await schedule("instagram", "api-post-1", scheduledAt);
  assert.equal((await duplicate.json()).job.id, instagramJob.id);
  const youtube = await schedule("youtube", "api-post-1", scheduledAt);
  assert.equal(youtube.status, 201);
  const jobs = await fetch(`${base}/api/scheduled-posts?postId=api-post-1`).then(response => response.json());
  assert.deepEqual(jobs.jobs.map(job => [job.provider, job.status]), [["instagram", "queued"], ["youtube", "queued"]]);
  checks.push("scheduled API persists idempotent provider-specific jobs");

  const cancelled = await fetch(`${base}/api/scheduled-posts/instagram/api-post-1`, { method: "DELETE", headers: { origin: base } });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).job.status, "cancelled");
  checks.push("scheduled API cancels a queued channel independently");

  await stopServer();
  server = startServer();
  await waitForServer();
  const afterRestart = await fetch(`${base}/api/scheduled-posts?postId=api-post-1`).then(response => response.json());
  assert.deepEqual(afterRestart.jobs.map(job => [job.provider, job.status]), [["instagram", "cancelled"], ["youtube", "queued"]]);
  checks.push("server restart preserves channel statuses in the durable job store");
  console.log(`SUCCESS ${checks.length} scheduled delivery API checks`);
} finally {
  await stopServer();
  await rm(dataDir, { recursive: true, force: true });
}
