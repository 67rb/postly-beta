import { ScheduledDeliveryError } from "./scheduled-delivery.js";

export async function handleScheduledDeliveryApi(request, url, { scheduler, json, assertSameOrigin, readPostForm } = {}) {
  try {
    if (url.pathname === "/api/scheduled-posts" && request.method === "GET") {
      const jobs = await scheduler.list({ postId: url.searchParams.get("postId") || undefined });
      return json({ jobs });
    }

    const createMatch = url.pathname.match(/^\/api\/scheduled-posts\/(instagram|tiktok|youtube)$/);
    if (createMatch && request.method === "POST") {
      assertSameOrigin(request);
      const [, provider] = createMatch;
      const { post, media, schedule } = await readPostForm(request);
      if (!schedule || typeof schedule !== "object" || typeof schedule.postId !== "string" || typeof schedule.scheduledAt !== "string") {
        return json({ error: "Scheduled post ID and time are required.", code: "invalid_schedule" }, 400);
      }
      const job = await scheduler.schedule({ postId: schedule.postId, scheduledAt: schedule.scheduledAt, provider, post, media });
      return json({ ok: true, job }, 201);
    }

    const retryMatch = url.pathname.match(/^\/api\/scheduled-posts\/(instagram|tiktok|youtube)\/([\w.-]{1,120})\/retry$/);
    if (retryMatch && request.method === "POST") {
      assertSameOrigin(request);
      const [, provider, postId] = retryMatch;
      let body = {};
      try { body = await request.json(); }
      catch { return json({ error: "Retry options could not be read.", code: "invalid_json" }, 400); }
      const job = await scheduler.retry({ postId, provider, confirmDuplicateRisk: body.confirmDuplicateRisk === true });
      return job ? json({ ok: true, job }) : json({ error: "Scheduled delivery was not found.", code: "scheduled_job_not_found" }, 404);
    }

    const cancelMatch = url.pathname.match(/^\/api\/scheduled-posts\/(instagram|tiktok|youtube)\/([\w.-]{1,120})$/);
    if (cancelMatch && request.method === "DELETE") {
      assertSameOrigin(request);
      const [, provider, postId] = cancelMatch;
      const job = await scheduler.cancel({ postId, provider });
      return json({ ok: true, removed: Boolean(job), job });
    }

    if (createMatch || retryMatch || cancelMatch) return json({ error: "Method not allowed." }, 405);
    return null;
  } catch (error) {
    const response = scheduledDeliveryErrorResponse(error, json);
    if (response) return response;
    throw error;
  }
}

export function scheduledDeliveryErrorResponse(error, json) {
  if (!(error instanceof ScheduledDeliveryError)) return null;
  return json({ error: error.message, code: error.code }, error.status);
}
