import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const providers = new Set(["instagram", "tiktok", "youtube"]);
const mediaTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"]);
const preflightErrorCodes = new Set(["account_not_connected", "account_store_unavailable", "reconnect_required", "media_host_required", "public_media_required", "invalid_configuration", "invalid_post", "unsupported_media", "empty_media", "media_required", "too_many_files", "unsupported_post_type", "file_too_large", "invalid_upload", "provider_not_supported", "missing_public_media"]);
const maxMediaBytes = 250 * 1024 * 1024;
const maxFiles = 35;

export class ScheduledDeliveryError extends Error {
  constructor(message, status = 400, code = "invalid_schedule") {
    super(message);
    this.name = "ScheduledDeliveryError";
    this.status = status;
    this.code = code;
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function jobId(postId, provider) {
  return digest(`postly-scheduled:${provider}:${postId}`);
}

function safePost(post) {
  if (!post || typeof post !== "object" || Array.isArray(post) || typeof post.text !== "string" || post.text.length > 2200) {
    throw new ScheduledDeliveryError("Enter a post with up to 2,200 characters.", 400, "invalid_post");
  }
  return {
    text: post.text,
    postType: String(post.postType || "").slice(0, 40),
    tiktokPrivacyLevel: String(post.tiktokPrivacyLevel || "").slice(0, 60),
    youtubePrivacyStatus: String(post.youtubePrivacyStatus || "private").slice(0, 20),
    disclosure: Boolean(post.disclosure),
    disableComments: Boolean(post.disableComments),
    disableDuet: Boolean(post.disableDuet),
    disableStitch: Boolean(post.disableStitch),
    autoAddMusic: Boolean(post.autoAddMusic),
  };
}

function safeSummary(job) {
  return {
    id: job.id,
    postId: job.postId,
    provider: job.provider,
    idempotencyKey: job.idempotencyKey,
    status: job.status,
    scheduledAt: job.scheduledAt,
    attempts: job.attempts,
    pollAttempts: job.pollAttempts,
    nextAttemptAt: job.nextAttemptAt || null,
    publishId: job.providerResult?.publishId || "",
    remoteId: job.providerResult?.remoteId || "",
    providerId: job.providerResult?.remoteId || job.providerResult?.publishId || job.providerResult?.containerId || job.providerResult?.videoId || "",
    providerStatus: job.providerResult?.providerStatus || "",
    error: job.error || "",
    code: job.errorCode || "",
    mayHavePublished: Boolean(job.mayHavePublished),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function retryDelay(attempt, baseMs) {
  return Math.min(baseMs * (2 ** Math.max(0, attempt - 1)), 60 * 60 * 1000);
}

function validPostId(value) {
  return typeof value === "string" && /^[\w.-]{1,120}$/.test(value);
}

async function pause(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function createScheduledDelivery({
  directory,
  publish,
  now = Date.now,
  retryBaseMs = 30_000,
  retryMaxAttempts = 5,
  leaseMs = 15 * 60 * 1000,
  pollIntervalMs = 60_000,
  lockTimeoutMs = 5_000,
} = {}) {
  if (!directory) throw new TypeError("A scheduled delivery directory is required.");
  if (typeof publish !== "function") throw new TypeError("A scheduled delivery publisher is required.");

  const stateFile = join(directory, "jobs.json");
  const lockFile = join(directory, ".jobs.lock");
  const mediaDirectory = join(directory, "media");
  let mutationQueue = Promise.resolve();
  let dispatching = false;
  let timer = null;
  let lastCleanupAt = 0;

  async function acquireLock() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const startedAt = Date.now();
    while (Date.now() - startedAt <= lockTimeoutMs) {
      try {
        const handle = await open(lockFile, "wx", 0o600);
        const token = randomUUID();
        await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
        return async () => {
          await handle.close().catch(() => {});
          try {
            const lock = JSON.parse(await readFile(lockFile, "utf8"));
            if (lock.token === token) await rm(lockFile, { force: true });
          } catch (error) { if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error; }
        };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          const lock = JSON.parse(await readFile(lockFile, "utf8"));
          let processRunning = false;
          if (Number.isInteger(lock.pid) && lock.pid > 0) {
            try { process.kill(lock.pid, 0); processRunning = true; }
            catch (probeError) { if (probeError.code !== "ESRCH" && probeError.code !== "ENOENT") processRunning = true; }
          }
          if (lock.pid && !processRunning) await rm(lockFile, { force: true });
          const lockStat = await stat(lockFile);
          if (!lock.pid && Date.now() - lockStat.mtimeMs > 30_000) await rm(lockFile, { force: true });
        } catch (statError) {
          if (statError.code === "ENOENT") continue;
          if (statError.name === "SyntaxError") {
            const lockStat = await stat(lockFile).catch(() => null);
            if (lockStat && Date.now() - lockStat.mtimeMs > 30_000) await rm(lockFile, { force: true });
          } else throw statError;
        }
        await pause(20);
      }
    }
    throw new ScheduledDeliveryError("The scheduled delivery store is busy. Try again shortly.", 503, "scheduler_busy");
  }

  async function readState() {
    try {
      const state = JSON.parse(await readFile(stateFile, "utf8"));
      if (state?.version !== 1 || !Array.isArray(state.jobs)) throw new Error("Invalid scheduled delivery state");
      return state;
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, jobs: [] };
      throw new ScheduledDeliveryError("The scheduled delivery store could not be read safely.", 500, "scheduler_store_unreadable");
    }
  }

  async function writeState(state) {
    const temporary = `${stateFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
      await rename(temporary, stateFile);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  function mutate(operation) {
    const pending = mutationQueue.then(async () => {
      const release = await acquireLock();
      try {
        const state = await readState();
        const { result, changed = false } = await operation(state);
        if (changed) await writeState(state);
        return result;
      } finally { await release(); }
    });
    mutationQueue = pending.catch(() => {});
    return pending;
  }

  async function writeMediaFiles(media) {
    await mkdir(mediaDirectory, { recursive: true, mode: 0o700 });
    const files = [];
    for (let index = 0; index < media.length; index++) {
      const item = media[index];
      const name = `${digest(item.data)}.bin`;
      const path = join(mediaDirectory, name);
      const bytes = Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data || []);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
      } catch (error) {
        await rm(temporary, { force: true });
        if (error.code !== "EEXIST") throw error;
        const existing = await stat(path);
        if (existing.size !== bytes.length) throw new ScheduledDeliveryError("A scheduled media file could not be verified.", 500, "scheduler_media_conflict");
      }
      files.push({ file: name, name: String(item.name || "media").slice(0, 255), type: item.type, size: bytes.length });
    }
    return files;
  }

  async function removeUnreferencedMedia(previousFiles) {
    return mutate(async state => {
      const referenced = new Set(state.jobs.flatMap(job => job.mediaFiles.map(item => item.file)));
      await Promise.all(previousFiles.filter(name => /^[\da-f]{64}\.bin$/.test(name) && !referenced.has(name)).map(name => rm(join(mediaDirectory, name), { force: true })));
      return { result: undefined, changed: false };
    });
  }

  async function loadMedia(job) {
    return Promise.all(job.mediaFiles.map(async item => {
      if (!/^[\da-f]{64}\.bin$/.test(item.file)) throw new ScheduledDeliveryError(`Saved media for ${job.provider} could not be verified. Upload it again before retrying.`, 410, "scheduled_media_missing");
      try { return { ...item, data: await readFile(join(mediaDirectory, item.file)) }; }
      catch { throw new ScheduledDeliveryError(`Saved media for ${job.provider} could not be read. Upload it again before retrying.`, 410, "scheduled_media_missing"); }
    }));
  }

  async function schedule({ postId, provider, scheduledAt, post, media = [] } = {}) {
    if (!validPostId(postId)) throw new ScheduledDeliveryError("A valid scheduled post ID is required.");
    if (!providers.has(provider)) throw new ScheduledDeliveryError("This provider does not have scheduled publishing support.");
    const timestamp = Date.parse(scheduledAt);
    if (!Number.isFinite(timestamp)) throw new ScheduledDeliveryError("Choose a valid scheduled date and time.");
    if (!Array.isArray(media) || media.length > maxFiles) throw new ScheduledDeliveryError("A post can include at most 35 media files.", 400, "too_many_files");
    let total = 0;
    const normalizedMedia = media.map(item => {
      const data = Buffer.isBuffer(item?.data) ? item.data : Buffer.from(item?.data || []);
      if (!mediaTypes.has(item?.type) || !data.length) throw new ScheduledDeliveryError("Scheduled media must be a non-empty supported image or video.", 400, "invalid_scheduled_media");
      total += data.length;
      if (total > maxMediaBytes) throw new ScheduledDeliveryError("Scheduled media must be 250 MB or smaller in total.", 413, "scheduled_media_too_large");
      return { name: String(item.name || "media").slice(0, 255), type: item.type, data };
    });
    const normalizedPost = safePost(post);
    const fingerprint = digest(JSON.stringify({ post: normalizedPost, media: normalizedMedia.map(item => ({ name: item.name, type: item.type, size: item.data.length, hash: digest(item.data) })) }));
    const id = jobId(postId, provider);
    const scheduled = new Date(timestamp).toISOString();
    const outcome = await mutate(async state => {
      const index = state.jobs.findIndex(job => job.id === id);
      const existing = index < 0 ? null : state.jobs[index];
      const sameContent = existing?.fingerprint === fingerprint;
      if (existing && (["processing", "provider_processing", "published"].includes(existing.status) || (existing.status === "recovery_required" && existing.mayHavePublished)) && (!sameContent || existing.scheduledAt !== scheduled)) {
        throw new ScheduledDeliveryError("This channel is already delivering or has published this post. Cancel or review its delivery state before changing it.", 409, "scheduled_job_locked");
      }
      if (existing && sameContent && existing.scheduledAt === scheduled && existing.status !== "cancelled") {
        return { result: { summary: safeSummary(existing), oldFiles: [] }, changed: false };
      }
      const mediaFiles = await writeMediaFiles(normalizedMedia);
      const createdAt = existing?.createdAt || new Date(now()).toISOString();
      const job = {
        id,
        postId,
        provider,
        idempotencyKey: `${postId}:${provider}`,
        fingerprint,
        status: "queued",
        scheduledAt: scheduled,
        nextAttemptAt: null,
        attempts: 0,
        pollAttempts: 0,
        leaseUntil: null,
        claimedFrom: null,
        mediaFiles,
        post: normalizedPost,
        providerResult: null,
        error: "",
        errorCode: "",
        mayHavePublished: false,
        createdAt,
        updatedAt: new Date(now()).toISOString(),
      };
      if (index < 0) state.jobs.push(job);
      else state.jobs[index] = job;
      const oldFiles = existing?.mediaFiles.map(item => item.file) || [];
      return { result: { summary: safeSummary(job), oldFiles }, changed: true };
    });
    if (outcome.oldFiles.length) await removeUnreferencedMedia(outcome.oldFiles);
    return outcome.summary;
  }

  async function readStateUnlocked() {
    return mutate(async state => ({ result: state, changed: false }));
  }

  async function cleanupOrphanMedia() {
    await mkdir(mediaDirectory, { recursive: true, mode: 0o700 });
    const state = await readStateUnlocked();
    const referenced = new Set(state.jobs.filter(job => !["published", "cancelled"].includes(job.status)).flatMap(job => job.mediaFiles.map(item => item.file)));
    const entries = await readdir(mediaDirectory);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    await Promise.all(entries.filter(name => name.endsWith(".bin") || name.endsWith(".tmp")).map(async name => {
      if (referenced.has(name)) return;
      try { if ((await stat(join(mediaDirectory, name))).mtimeMs < cutoff) await rm(join(mediaDirectory, name), { force: true }); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }));
  }

  async function list({ postId } = {}) {
    return mutate(async state => ({ result: state.jobs.filter(job => !postId || job.postId === postId).map(safeSummary), changed: false }));
  }

  async function cancel({ postId, provider } = {}) {
    const outcome = await mutate(async state => {
      const job = state.jobs.find(item => item.id === jobId(postId, provider));
      if (!job) return { result: null, changed: false };
      if (["processing", "provider_processing", "published"].includes(job.status)) throw new ScheduledDeliveryError("This post is already being delivered or was published and cannot be cancelled safely.", 409, "scheduled_job_locked");
      if (job.status === "cancelled") return { result: { summary: safeSummary(job), oldFiles: [] }, changed: false };
      const oldFiles = job.mediaFiles.map(item => item.file);
      job.status = "cancelled";
      job.mediaFiles = [];
      job.nextAttemptAt = null;
      job.error = "";
      job.errorCode = "";
      job.updatedAt = new Date(now()).toISOString();
      return { result: { summary: safeSummary(job), oldFiles }, changed: true };
    });
    if (!outcome) return null;
    if (outcome.oldFiles.length) await removeUnreferencedMedia(outcome.oldFiles);
    return outcome.summary;
  }

  async function retry({ postId, provider, confirmDuplicateRisk = false } = {}) {
    return mutate(async state => {
      const job = state.jobs.find(item => item.id === jobId(postId, provider));
      if (!job) return { result: null, changed: false };
      if (!["failed", "recovery_required"].includes(job.status)) throw new ScheduledDeliveryError("Only failed or recoverable scheduled deliveries can be retried.", 409, "scheduled_job_not_retryable");
      if (job.providerResult?.status === "publishing" && (job.providerResult.publishId || job.providerResult.containerId || job.providerResult.videoId)) {
        job.status = "provider_processing";
        job.nextAttemptAt = new Date(now()).toISOString();
        job.pollAttempts = 0;
        job.leaseUntil = null;
        job.claimedFrom = null;
        job.error = "";
        job.errorCode = "";
        job.mayHavePublished = true;
        job.updatedAt = new Date(now()).toISOString();
        return { result: safeSummary(job), changed: true };
      }
      if (job.mayHavePublished && confirmDuplicateRisk !== true) throw new ScheduledDeliveryError("The provider may already have received this post. Check the channel first, then confirm duplicate risk to retry.", 409, "delivery_outcome_unknown");
      job.status = "queued";
      job.scheduledAt = new Date(now()).toISOString();
      job.nextAttemptAt = null;
      job.attempts = 0;
      job.pollAttempts = 0;
      job.leaseUntil = null;
      job.claimedFrom = null;
      job.providerResult = null;
      job.error = "";
      job.errorCode = "";
      job.mayHavePublished = false;
      job.updatedAt = new Date(now()).toISOString();
      return { result: safeSummary(job), changed: true };
    });
  }

  async function recoverExpiredLeases() {
    return mutate(async state => {
      let changed = false;
      for (const job of state.jobs) {
        if (job.status !== "processing" || !job.leaseUntil || job.leaseUntil > now()) continue;
        if (job.claimedFrom === "provider_processing") {
          job.status = "provider_processing";
          job.nextAttemptAt = new Date(now()).toISOString();
        } else {
          job.status = "recovery_required";
          job.error = "The server stopped during delivery. Check the channel before retrying.";
          job.errorCode = "delivery_interrupted";
          job.mayHavePublished = true;
        }
        job.leaseUntil = null;
        job.claimedFrom = null;
        job.updatedAt = new Date(now()).toISOString();
        changed = true;
      }
      return { result: state.jobs.filter(job => job.status === "recovery_required" || job.status === "provider_processing").map(safeSummary), changed };
    });
  }

  async function claimNext() {
    return mutate(async state => {
      for (const job of state.jobs) {
        if (job.status === "processing" && job.leaseUntil <= now()) {
          if (job.claimedFrom === "provider_processing") {
            job.status = "provider_processing";
            job.nextAttemptAt = new Date(now()).toISOString();
          } else {
            job.status = "recovery_required";
            job.error = "The server stopped during delivery. Check the channel before retrying.";
            job.errorCode = "delivery_interrupted";
            job.mayHavePublished = true;
          }
          job.leaseUntil = null;
          job.claimedFrom = null;
          job.updatedAt = new Date(now()).toISOString();
        }
      }
      const due = state.jobs
        .filter(job => ["queued", "retry_wait", "provider_processing"].includes(job.status) && Date.parse(job.scheduledAt) <= now() && (!job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= now()))
        .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.id.localeCompare(b.id))[0];
      if (!due) return { result: null, changed: false };
      const previous = due.status;
      if (previous === "provider_processing") due.pollAttempts += 1;
      else due.attempts += 1;
      due.status = "processing";
      due.claimedFrom = previous;
      due.leaseUntil = now() + leaseMs;
      due.updatedAt = new Date(now()).toISOString();
      return { result: { ...due, action: previous === "provider_processing" ? "poll" : "publish" }, changed: true };
    });
  }

  async function finish(job, outcome, error) {
    return mutate(async state => {
      const current = state.jobs.find(item => item.id === job.id);
      if (!current || current.status !== "processing" || current.attempts !== job.attempts || current.pollAttempts !== job.pollAttempts) return { result: null, changed: false };
      current.leaseUntil = null;
      current.claimedFrom = null;
      current.updatedAt = new Date(now()).toISOString();
      if (error) {
        const retryable = error.status === 429 || error.retryable === true;
        const definiteRejection = !error.ambiguous && ((Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) || preflightErrorCodes.has(error.code));
        if (job.action === "poll" && current.pollAttempts <= 10) {
          current.status = "provider_processing";
          current.nextAttemptAt = new Date(now() + retryDelay(current.pollAttempts, retryBaseMs)).toISOString();
          current.error = String(error.message || "The provider status could not be checked yet.").slice(0, 500);
          current.errorCode = String(error.code || "provider_status_unavailable").slice(0, 100);
          current.mayHavePublished = true;
          return { result: safeSummary(current), changed: true };
        }
        if (job.action === "poll") {
          current.status = "recovery_required";
          current.nextAttemptAt = null;
          current.error = "The provider status remains unavailable. Check the channel before retrying.";
          current.errorCode = "provider_status_unavailable";
          current.mayHavePublished = true;
          return { result: safeSummary(current), changed: true };
        }
        if (retryable && current.attempts <= retryMaxAttempts) {
          current.status = "retry_wait";
          current.nextAttemptAt = new Date(now() + retryDelay(current.attempts, retryBaseMs)).toISOString();
          current.error = String(error.message || "Provider rate limit reached.").slice(0, 500);
          current.errorCode = String(error.code || "provider_rate_limited").slice(0, 100);
          current.mayHavePublished = false;
        } else {
          current.status = definiteRejection || retryable ? "failed" : "recovery_required";
          current.nextAttemptAt = null;
          current.error = String(error.message || "The delivery result could not be confirmed.").slice(0, 500);
          current.errorCode = String(error.code || "delivery_outcome_unknown").slice(0, 100);
          current.mayHavePublished = !definiteRejection && !retryable;
        }
      } else if (outcome?.status === "published" && (outcome.remoteId || outcome.containerId || outcome.videoId || outcome.providerStatus === "PUBLISHED")) {
        current.status = "published";
        current.providerResult = {
          provider: current.provider,
          status: "published",
          remoteId: String(outcome.remoteId || "").slice(0, 240),
          publishId: String(outcome.publishId || "").slice(0, 240),
          containerId: String(outcome.containerId || "").slice(0, 240),
          videoId: String(outcome.videoId || "").slice(0, 240),
          providerStatus: String(outcome.providerStatus || "").slice(0, 120),
          privacyStatus: String(outcome.privacyStatus || "").slice(0, 40),
          privacyLevel: String(outcome.privacyLevel || "").slice(0, 80),
          profile: String(outcome.profile || "").slice(0, 160),
        };
        current.nextAttemptAt = null;
        current.error = "";
        current.errorCode = "";
        current.mayHavePublished = false;
      } else if (outcome?.status === "failed") {
        current.status = "failed";
        current.nextAttemptAt = null;
        current.error = String(outcome.error || "The provider reported that this post did not publish.").slice(0, 500);
        current.errorCode = String(outcome.code || "provider_publish_failed").slice(0, 100);
        current.providerResult = { ...current.providerResult, status: "failed", providerStatus: String(outcome.providerStatus || "FAILED").slice(0, 120) };
        current.mayHavePublished = false;
      } else if (outcome?.status === "publishing" && (outcome.publishId || outcome.containerId || outcome.videoId)) {
        current.status = "provider_processing";
        current.providerResult = {
          provider: current.provider,
          status: "publishing",
          publishId: String(outcome.publishId).slice(0, 240),
          containerId: String(outcome.containerId || "").slice(0, 240),
          videoId: String(outcome.videoId || "").slice(0, 240),
          providerStatus: String(outcome.providerStatus || "PROCESSING_UPLOAD").slice(0, 120),
          profile: String(outcome.profile || "").slice(0, 160),
        };
        current.nextAttemptAt = new Date(now() + pollIntervalMs).toISOString();
      } else if (outcome?.status === "processing") {
        current.status = "provider_processing";
        current.nextAttemptAt = new Date(now() + pollIntervalMs).toISOString();
      } else {
        current.status = "recovery_required";
        current.nextAttemptAt = null;
        current.error = "The provider response did not confirm publication. Check the channel before retrying.";
        current.errorCode = "delivery_outcome_unknown";
        current.mayHavePublished = true;
      }
      return { result: safeSummary(current), changed: true };
    });
  }

  async function dispatchDue({ limit = 20 } = {}) {
    if (dispatching) return { processed: 0, busy: true };
    dispatching = true;
    let processed = 0;
    try {
      if (Date.now() - lastCleanupAt >= 24 * 60 * 60 * 1000) {
        await cleanupOrphanMedia();
        lastCleanupAt = Date.now();
      }
      await recoverExpiredLeases();
      while (processed < limit) {
        const claimed = await claimNext();
        if (!claimed) break;
        let result;
        let error;
        try {
          const media = await loadMedia(claimed);
          result = await publish({ ...claimed, media });
        } catch (caught) { error = caught; }
        await finish(claimed, result, error);
        processed++;
      }
      return { processed, busy: false };
    } finally { dispatching = false; }
  }

  function start({ intervalMs = 5_000, onError = () => {} } = {}) {
    if (timer) return () => stop();
    void cleanupOrphanMedia().then(() => { lastCleanupAt = Date.now(); return dispatchDue(); }).catch(onError);
    timer = setInterval(() => { void dispatchDue().catch(onError); }, intervalMs);
    timer.unref?.();
    return () => stop();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { schedule, list, cancel, retry, recoverExpiredLeases, dispatchDue, start, stop };
}
