import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScheduledDelivery } from "../server/scheduled-delivery.js";
import { handleScheduledDeliveryApi } from "../server/scheduled-delivery-api.js";
import { cancelScheduledDelivery, fetchScheduledDeliveryStatuses, registerScheduledDelivery, retryScheduledDelivery } from "../src/scheduled-delivery-client.js";

const directory = await mkdtemp(join(tmpdir(), "postly-scheduler-test-"));
let clock = Date.parse("2026-10-24T08:00:00.000Z");
const fixedNow = () => clock;
const future = new Date(clock + 60_000).toISOString();
const post = { text: "A deterministic scheduled post", postType: "Post" };
const media = [{ name: "sample.jpg", type: "image/jpeg", data: Buffer.from("mock-image-bytes") }];
const checks = [];
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function reset() { await rm(directory, { recursive: true, force: true }); }

try {
  await check("future jobs persist durably and repeated enqueue is idempotent", async () => {
    const sent = [];
    const scheduler = createScheduledDelivery({ directory, now: fixedNow, publish: async job => { sent.push(job); return { status: "published", remoteId: "mock-remote-1" }; } });
    const first = await scheduler.schedule({ postId: "future-post", provider: "instagram", scheduledAt: future, post, media });
    const duplicate = await scheduler.schedule({ postId: "future-post", provider: "instagram", scheduledAt: future, post, media });
    assert.equal(duplicate.id, first.id);
    assert.equal(duplicate.idempotencyKey, "future-post:instagram");
    assert.equal((await scheduler.dispatchDue()).processed, 0);
    assert.equal(sent.length, 0);
    const restarted = createScheduledDelivery({ directory, now: fixedNow, publish: async job => { sent.push(job); return { status: "published", remoteId: "mock-remote-1" }; } });
    assert.equal((await restarted.list({ postId: "future-post" }))[0].status, "queued");
    clock += 60_000;
    assert.equal((await restarted.dispatchDue()).processed, 1);
    assert.equal(sent[0].media[0].data.toString(), "mock-image-bytes");
    assert.equal((await restarted.list({ postId: "future-post" }))[0].remoteId, "mock-remote-1");
    assert.equal((await restarted.dispatchDue()).processed, 0);
    assert.equal(sent.length, 1);
    restarted.stop();
  });

  await check("concurrent server instances serialize writes to one durable idempotency key", async () => {
    await reset();
    const publisher = async () => ({ status: "published", remoteId: "unused" });
    const first = createScheduledDelivery({ directory, now: fixedNow, publish: publisher });
    const second = createScheduledDelivery({ directory, now: fixedNow, publish: publisher });
    const [left, right] = await Promise.all([
      first.schedule({ postId: "concurrent-post", provider: "youtube", scheduledAt: future, post, media }),
      second.schedule({ postId: "concurrent-post", provider: "youtube", scheduledAt: future, post, media }),
    ]);
    assert.equal(left.id, right.id);
    assert.equal((await first.list({ postId: "concurrent-post" })).length, 1);
  });

  await check("per-channel states stay independent", async () => {
    await reset();
    const scheduler = createScheduledDelivery({ directory, now: fixedNow, publish: async job => {
      if (job.provider === "youtube") throw Object.assign(new Error("YouTube is not connected."), { status: 401, code: "account_not_connected" });
      return { status: "published", remoteId: "ig-mock-id" };
    } });
    const due = new Date(clock).toISOString();
    await scheduler.schedule({ postId: "multi-channel", provider: "instagram", scheduledAt: due, post, media });
    await scheduler.schedule({ postId: "multi-channel", provider: "youtube", scheduledAt: due, post, media });
    assert.equal((await scheduler.dispatchDue()).processed, 2);
    const channels = Object.fromEntries((await scheduler.list({ postId: "multi-channel" })).map(item => [item.provider, item.status]));
    assert.deepEqual(channels, { instagram: "published", youtube: "failed" });
  });

  await check("queued jobs can be cancelled without dispatching", async () => {
    await reset();
    let calls = 0;
    const scheduler = createScheduledDelivery({ directory, now: fixedNow, publish: async () => { calls++; return { status: "published", remoteId: "must-not-send" }; } });
    await scheduler.schedule({ postId: "cancel-post", provider: "instagram", scheduledAt: future, post, media });
    const cancelled = await scheduler.cancel({ postId: "cancel-post", provider: "instagram" });
    assert.equal(cancelled.status, "cancelled");
    assert.equal((await scheduler.dispatchDue()).processed, 0);
    assert.equal(calls, 0);
    assert.equal((await scheduler.list({ postId: "cancel-post" }))[0].status, "cancelled");
  });

  await check("safe provider rate limits retry with bounded fake-time backoff", async () => {
    await reset();
    let calls = 0;
    const scheduler = createScheduledDelivery({ directory, now: fixedNow, retryBaseMs: 100, retryMaxAttempts: 2, publish: async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error("Provider rate limited the request."), { status: 429, code: "rate_limited" });
      return { status: "published", remoteId: "retry-mock-id" };
    } });
    await scheduler.schedule({ postId: "retry-post", provider: "instagram", scheduledAt: new Date(clock).toISOString(), post, media });
    await scheduler.dispatchDue();
    assert.equal((await scheduler.list({ postId: "retry-post" }))[0].status, "retry_wait");
    assert.equal(calls, 1);
    clock += 99;
    await scheduler.dispatchDue();
    assert.equal(calls, 1);
    clock += 1;
    await scheduler.dispatchDue();
    assert.equal(calls, 2);
    assert.equal((await scheduler.list({ postId: "retry-post" }))[0].status, "published");
  });

  await check("known preflight failures are recoverable without duplicate-risk confirmation", async () => {
    await reset();
    let calls = 0;
    const scheduler = createScheduledDelivery({ directory, now: fixedNow, publish: async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error("Set a public media host before publishing."), { status: 503, code: "media_host_required" });
      return { status: "published", remoteId: "after-config-mock-id" };
    } });
    await scheduler.schedule({ postId: "config-post", provider: "instagram", scheduledAt: new Date(clock).toISOString(), post, media });
    await scheduler.dispatchDue();
    assert.equal((await scheduler.list({ postId: "config-post" }))[0].status, "failed");
    assert.equal((await scheduler.list({ postId: "config-post" }))[0].mayHavePublished, false);
    await scheduler.retry({ postId: "config-post", provider: "instagram" });
    await scheduler.dispatchDue();
    assert.equal(calls, 2);
    assert.equal((await scheduler.list({ postId: "config-post" }))[0].status, "published");
  });

  await check("ambiguous provider failures require explicit duplicate-risk confirmation", async () => {
    await reset();
    let calls = 0;
    const scheduler = createScheduledDelivery({ directory, now: fixedNow, publish: async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error("The provider connection ended before the result was confirmed."), { status: 502, code: "network_error" });
      return { status: "published", remoteId: "recovered-mock-id" };
    } });
    await scheduler.schedule({ postId: "ambiguous-post", provider: "tiktok", scheduledAt: new Date(clock).toISOString(), post, media });
    await scheduler.dispatchDue();
    assert.equal((await scheduler.list({ postId: "ambiguous-post" }))[0].status, "recovery_required");
    assert.equal((await scheduler.list({ postId: "ambiguous-post" }))[0].mayHavePublished, true);
    await assert.rejects(() => scheduler.retry({ postId: "ambiguous-post", provider: "tiktok" }), /Check the channel first/);
    await scheduler.retry({ postId: "ambiguous-post", provider: "tiktok", confirmDuplicateRisk: true });
    await scheduler.dispatchDue();
    assert.equal(calls, 2);
    assert.equal((await scheduler.list({ postId: "ambiguous-post" }))[0].status, "published");
  });

  await check("expired publishing leases recover without an automatic duplicate send", async () => {
    await reset();
    const scheduler = createScheduledDelivery({ directory, now: fixedNow, leaseMs: 500, publish: async () => new Promise(() => {}) });
    await scheduler.schedule({ postId: "interrupted-post", provider: "youtube", scheduledAt: new Date(clock).toISOString(), post, media });
    void scheduler.dispatchDue();
    for (let attempt = 0; attempt < 50 && (await scheduler.list({ postId: "interrupted-post" }))[0]?.status !== "processing"; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await scheduler.list({ postId: "interrupted-post" }))[0].status, "processing");
    clock += 501;
    const restarted = createScheduledDelivery({ directory, now: fixedNow, publish: async () => ({ status: "published", remoteId: "should-not-send" }) });
    const recovered = await restarted.recoverExpiredLeases();
    assert.equal(recovered[0].status, "recovery_required");
    assert.equal(recovered[0].mayHavePublished, true);
    assert.equal((await restarted.dispatchDue()).processed, 0);
    restarted.stop();
    scheduler.stop();
  });

  await check("TikTok processing status is polled without repeating the publish call", async () => {
    await reset();
    const actions = [];
    const scheduler = createScheduledDelivery({ directory, now: fixedNow, pollIntervalMs: 100, publish: async job => {
      actions.push(job.action);
      return job.action === "publish" ? { status: "publishing", publishId: "mock-publish-id", providerStatus: "PROCESSING_UPLOAD" } : { status: "published", remoteId: "tiktok-mock-id" };
    } });
    await scheduler.schedule({ postId: "processing-post", provider: "tiktok", scheduledAt: new Date(clock).toISOString(), post, media });
    await scheduler.dispatchDue();
    assert.equal((await scheduler.list({ postId: "processing-post" }))[0].status, "provider_processing");
    clock += 100;
    await scheduler.dispatchDue();
    assert.deepEqual(actions, ["publish", "poll"]);
    assert.equal((await scheduler.list({ postId: "processing-post" }))[0].status, "published");
  });

  await check("confirmed TikTok rejection can be safely retried as a new publish attempt", async () => {
    await reset();
    const actions = [];
    const scheduler = createScheduledDelivery({ directory, now: fixedNow, pollIntervalMs: 100, publish: async job => {
      actions.push(job.action);
      if (job.action === "publish" && actions.length === 1) return { status: "publishing", publishId: "rejected-publish-id" };
      if (job.action === "poll") return { status: "failed", providerStatus: "FAILED", error: "Provider rejected the post." };
      return { status: "published", remoteId: "retry-after-rejection" };
    } });
    await scheduler.schedule({ postId: "provider-rejected", provider: "tiktok", scheduledAt: new Date(clock).toISOString(), post, media });
    await scheduler.dispatchDue();
    clock += 100;
    await scheduler.dispatchDue();
    const failed = (await scheduler.list({ postId: "provider-rejected" }))[0];
    assert.equal(failed.status, "failed");
    assert.equal(failed.mayHavePublished, false);
    await scheduler.retry({ postId: "provider-rejected", provider: "tiktok" });
    await scheduler.dispatchDue();
    assert.deepEqual(actions, ["publish", "poll", "publish"]);
    assert.equal((await scheduler.list({ postId: "provider-rejected" }))[0].status, "published");
  });

  await check("composer registration sends independent channel jobs and cancellation failures", async () => {
    const record = { id: "client-post", text: "Three channel schedule", channels: [0, 1, 2], scheduleAt: future, attachments: [{ id: "media-1", name: "client.jpg" }], postTypes: { Instagram: "Post", TikTok: "Photo", YouTube: "Video" }, tiktokAllowComments: false };
    const submitted = [];
    const outcomes = await registerScheduledDelivery(record, {
      channelNames: ["Instagram", "TikTok", "YouTube"],
      readMedia: async () => new Blob(["browser-media"], { type: "image/jpeg" }),
      fetchImpl: async (url, options) => {
        submitted.push({ url, post: JSON.parse(options.body.get("post")), schedule: JSON.parse(options.body.get("schedule")), media: options.body.getAll("media") });
        return url.includes("tiktok") ? new Response(JSON.stringify({ error: "TikTok setup is unavailable." }), { status: 503 }) : new Response(JSON.stringify({ job: { id: `job-${url.split("/").at(-1)}`, status: "queued" } }), { status: 201 });
      },
    });
    assert.deepEqual(outcomes.map(item => item.status), ["queued", "failed", "queued"]);
    assert.equal(submitted.length, 3);
    assert.deepEqual(submitted.map(item => item.url), ["/api/scheduled-posts/instagram", "/api/scheduled-posts/tiktok", "/api/scheduled-posts/youtube"]);
    assert.equal(submitted[1].post.postType, "Photo");
    assert.equal(submitted[1].post.disableComments, true);
    assert.equal(submitted[0].schedule.postId, "client-post");
    assert.equal(submitted[0].media[0].name, "client.jpg");

    const cancellations = await cancelScheduledDelivery(record, {
      channelNames: ["Instagram", "TikTok", "YouTube"],
      fetchImpl: async url => url.includes("tiktok") ? new Response(JSON.stringify({ error: "Delivery is already processing." }), { status: 409 }) : new Response(JSON.stringify({ ok: true, removed: true }), { status: 200 }),
    });
    assert.deepEqual(cancellations.map(item => item.status), ["cancelled", "failed", "cancelled"]);
  });

  await check("client status refresh and duplicate-risk retry use the scheduler API", async () => {
    const calls = [];
    const job = { id: "retry-job", postId: "client-post", provider: "instagram", status: "queued", attempts: 0, mayHavePublished: false };
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(url === "/api/scheduled-posts" ? { jobs: [job] } : { ok: true, job }), { status: 200 });
    };
    assert.deepEqual(await fetchScheduledDeliveryStatuses({ fetchImpl }), [job]);
    const retried = await retryScheduledDelivery({ id: "client-post" }, { provider: "instagram", channelName: "Instagram", channelIndex: 0, mayHavePublished: true }, { fetchImpl, confirmDuplicateRisk: true });
    assert.equal(retried.status, "queued");
    assert.equal(calls[1].url, "/api/scheduled-posts/instagram/client-post/retry");
    assert.deepEqual(JSON.parse(calls[1].options.body), { confirmDuplicateRisk: true });
  });

  await check("scheduled job API validates same-origin writes and exposes per-channel recovery actions", async () => {
    const jobs = [];
    const scheduler = {
      async schedule(input) { const job = { id: "mock-job", postId: input.postId, provider: input.provider, status: "queued" }; jobs.push(job); return job; },
      async list({ postId } = {}) { return jobs.filter(job => !postId || job.postId === postId); },
      async cancel({ postId, provider }) { return jobs.find(job => job.postId === postId && job.provider === provider) || null; },
      async retry({ postId, provider, confirmDuplicateRisk }) { return { postId, provider, confirmDuplicateRisk, status: "queued" }; },
    };
    const options = {
      scheduler,
      json: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
      assertSameOrigin: request => { if (request.headers.get("origin") !== "http://localhost") throw new Error("Origin rejected"); },
      readPostForm: async request => { const form = await request.formData(); return { post: JSON.parse(form.get("post")), media: [], schedule: JSON.parse(form.get("schedule")) }; },
    };
    const form = new FormData();
    form.append("post", JSON.stringify(post));
    form.append("schedule", JSON.stringify({ postId: "api-post", scheduledAt: future }));
    const created = await handleScheduledDeliveryApi(new Request("http://localhost/api/scheduled-posts/instagram", { method: "POST", headers: { origin: "http://localhost" }, body: form }), new URL("http://localhost/api/scheduled-posts/instagram"), options);
    assert.equal(created.status, 201);
    assert.equal((await created.json()).job.provider, "instagram");
    const listed = await handleScheduledDeliveryApi(new Request("http://localhost/api/scheduled-posts?postId=api-post"), new URL("http://localhost/api/scheduled-posts?postId=api-post"), options);
    assert.equal((await listed.json()).jobs.length, 1);
    const retry = await handleScheduledDeliveryApi(new Request("http://localhost/api/scheduled-posts/instagram/api-post/retry", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ confirmDuplicateRisk: true }) }), new URL("http://localhost/api/scheduled-posts/instagram/api-post/retry"), options);
    assert.equal((await retry.json()).job.confirmDuplicateRisk, true);
  });

  console.log(`SUCCESS ${checks.length} scheduled delivery checks`);
} finally {
  await reset();
}
