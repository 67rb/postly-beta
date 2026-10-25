import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Africa/Johannesburg" });
const page = await context.newPage();
page.setDefaultTimeout(8_000);

const failures = [];
const checks = [];
let publishRequests = 0;
const scheduledRequests = [];
let scheduledApiJobs = [];
page.on("pageerror", error => failures.push(`page error: ${error.message}`));
page.on("console", message => { if (message.type() === "error") failures.push(`console error: ${message.text()}`); });
page.on("response", response => { if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`); });
page.on("request", request => { if (new URL(request.url()).origin !== "http://localhost:4176") failures.push(`external request: ${request.url()}`); });

const providers = { providers: {
  instagram: { name: "Instagram", configured: true, connected: true, profile: "ig.test" },
  tiktok: { name: "TikTok", configured: true, connected: true, profile: "tt.test" },
  youtube: { name: "YouTube", configured: true, connected: true, profile: "yt.test" },
} };
const check = async (name, run) => { await run(); checks.push(name); console.log(`PASS ${name}`); };
const start = async () => {
  await page.goto("http://localhost:4176/home", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".pw-steps article").nth(1).getByRole("button").last().click();
  await page.locator(".composer-modal").waitFor({ state: "visible" });
};
const button = name => page.getByRole("button", { name, exact: true });
const copy = () => page.locator("#composer-copy");
const deselectChannel = async index => page.locator(".channel-avatar").nth(index).click();
const setOnlyChannel = async index => {
  for (let channel = 0; channel < await page.locator(".channel-avatar").count(); channel++) {
    if (channel !== index && await page.locator(".channel-avatar").nth(channel).getAttribute("aria-pressed") === "true") await deselectChannel(channel);
  }
};
const makeImage = { name: "postly-cover.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBb0AAAAASUVORK5CYII=", "base64") };

try {
  await page.route("**/api/**", route => route.fulfill({ json: {} }));
  await page.route("**/api/scheduled-posts**", route => route.fulfill({ json: { jobs: scheduledApiJobs } }));
  await page.route("**/api/scheduled-posts/**", async route => {
    const request = route.request();
    scheduledRequests.push({ method: request.method(), url: new URL(request.url()).pathname });
    const provider = new URL(request.url()).pathname.split("/")[3] || "instagram";
    const postId = new URL(request.url()).pathname.split("/")[4] || "qa-post";
    const status = request.method() === "DELETE" ? "cancelled" : "queued";
    return route.fulfill({ status: request.method() === "POST" ? 201 : 200, json: { ok: true, removed: request.method() === "DELETE", job: { id: `qa-${provider}-${postId}`, postId, provider, status, attempts: 0, mayHavePublished: false } } });
  });
  await page.route("**/api/social/status", route => route.fulfill({ json: providers }));
  await page.route("**/api/social/tiktok/creator-info", route => route.fulfill({ json: { creator: {
    username: "tt.test", nickname: "TikTok test account", privacyLevelOptions: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxVideoPostDurationSec: 300,
  } } }));
  for (const provider of ["instagram", "tiktok", "youtube"]) {
    await page.route(`**/api/social/${provider}/publish`, route => { publishRequests++; return route.fulfill({ json: { ok: true, provider, status: "published", remoteId: `${provider}-mock-post` } }); });
  }

  await check("Composer opens on copy entry and channel selection reflects state", async () => {
    await start();
    await page.waitForFunction(() => document.activeElement?.id === "composer-copy");
    assert.equal(await page.locator(".channel-avatar").count(), 3);
    assert.equal(await page.locator(".channel-selection-count").innerText(), "3 of 3 selected");
    await deselectChannel(2);
    assert.equal(await page.locator(".channel-selection-count").innerText(), "2 of 3 selected");
    assert.equal(await page.locator(".channel-avatar").nth(2).getAttribute("aria-pressed"), "false");
    await copy().fill("Channel selection check");
    await button("Cancel").click();
    await button("Discard Changes").click();
  });

  await check("Copy counter and length validation block an over-limit post", async () => {
    await start();
    await copy().fill("x".repeat(2201));
    assert.equal(await page.locator(".character-count").innerText(), "2201 / 2,200 characters");
    await button("Customize").click();
    assert.match(await page.locator(".composer-error").first().innerText(), /2,200 character limit/);
    assert.equal(await button("Schedule post").isDisabled(), true);
    await button("Cancel").click();
    await button("Discard Changes").click();
  });

  await check("Schedule choices open by keyboard, dismiss with Escape, and restore focus", async () => {
    await start();
    await copy().fill("A keyboard scheduling draft");
    await button("Choose date and time").click();
    const trigger = button("More posting actions");
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => document.activeElement?.textContent?.includes("Next Available"));
    assert.equal(await page.locator(".date-time-actions-popover > button").count(), 4);
    await page.keyboard.press("Escape");
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.locator(".date-time-actions-popover").waitFor({ state: "visible" });
    await page.locator(".date-time-actions-popover > button").filter({ hasText: "Prioritize" }).click();
    assert.match(await page.locator(".schedule-select").innerText(), /Prioritize/);
    await button("Customize").click();
    assert.match(await page.locator(".local-queue-hint").innerText(), /server runs and resume after a restart/);
    await button("Cancel").click();
    await button("Discard Changes").click();
  });

  await check("Instagram, TikTok Video, and YouTube enforce per-network media requirements", async () => {
    const cases = [
      { channel: 0, error: /Instagram: Add at least one supported photo or video/ },
      { channel: 1, error: /TikTok: TikTok Video needs one video file/ },
      { channel: 2, error: /YouTube: YouTube needs one video file/ },
    ];
    for (const item of cases) {
      await start();
      await setOnlyChannel(item.channel);
      await copy().fill("Per-network validation check");
      await button("Customize").click();
      await button("Choose date and time").click();
      await button("More posting actions").click();
      await page.locator(".date-time-actions-popover > button").filter({ hasText: "Now" }).click();
      assert.match(await page.locator(".channel-validation").innerText(), item.error);
      assert.equal(await button("Publish now").isDisabled(), true);
      assert.equal(publishRequests, 0);
      await button("Cancel").click();
      await button("Discard Changes").click();
    }
  });

  await check("TikTok Photo validation catches PNG before any publish request", async () => {
    await start();
    await setOnlyChannel(1);
    await copy().fill("A photo post for TikTok");
    await page.locator("#media-upload").setInputFiles(makeImage);
    await page.locator(".media-attachments img").waitFor({ state: "visible" });
    await button("Customize").click();
    await page.getByLabel("Photo", { exact: true }).check();
    await button("Choose date and time").click();
    await button("More posting actions").click();
    await page.locator(".date-time-actions-popover > button").filter({ hasText: "Now" }).click();
    assert.match(await page.locator(".channel-validation").innerText(), /TikTok Photo accepts JPEG or WebP/);
    assert.equal(await button("Publish now").isDisabled(), true);
    assert.equal(publishRequests, 0);
    await button("Cancel").click();
    await button("Discard Changes").click();
  });

  await check("Media can be previewed, removed, saved with a draft, and restored after refresh", async () => {
    await start();
    await copy().fill("A local media draft");
    await page.locator("#media-upload").setInputFiles(makeImage);
    await page.locator(".media-attachments img").waitFor({ state: "visible" });
    assert.equal(await page.locator(".media-attachments img").evaluate(image => image.naturalWidth > 0), true);
    await button("Preview").click();
    await page.locator(".social-preview img").first().waitFor({ state: "visible" });
    await button("Preview").click();
    await button("Remove postly-cover.png").click();
    assert.equal(await page.locator(".media-attachment").count(), 0);
    await page.locator("#media-upload").setInputFiles(makeImage);
    await page.locator(".media-attachments img").waitFor({ state: "visible" });
    await button("Save Draft").click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("buffer-posts"))?.find(post => post.text === "A local media draft"));
    assert.equal(saved.status, "draft");
    assert.equal(saved.attachments.length, 1);
    await page.goto("http://localhost:4176/schedule/drafts", { waitUntil: "networkidle" });
    await page.locator(".pw-post-card").filter({ hasText: "A local media draft" }).waitFor({ state: "visible" });
    await page.locator(".pw-post-card").filter({ hasText: "A local media draft" }).getByRole("button", { name: "Edit" }).click();
    await button("Preview").click();
    await page.locator(".social-preview img").first().waitFor({ state: "visible" });
    assert.equal(publishRequests, 0);
  });

  await check("Cancel offers keep, discard, and draft-save paths", async () => {
    await start();
    await copy().fill("Cancel flow copy");
    await button("Cancel").click();
    await page.getByRole("alertdialog", { name: "Unsaved post" }).waitFor({ state: "visible" });
    await button("Keep Editing").click();
    assert.equal(await copy().inputValue(), "Cancel flow copy");
    await button("Cancel").click();
    await button("Discard Changes").click();
    assert.equal(await page.locator(".composer-modal").count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("buffer-posts") || "[]").some(post => post.text === "Cancel flow copy")), false);
  });

  await check("Scheduled posts register, appear in Queue/Calendar, and cancel cleanly when saved as drafts", async () => {
    await start();
    await setOnlyChannel(0);
    await copy().fill("Local queue calendar check");
    await button("Choose date and time").click();
    await button("More posting actions").click();
    await page.locator(".date-time-actions-popover > button").filter({ hasText: "Next Available" }).click();
    await button("Customize").click();
    await button("Schedule post").click();
    await page.waitForFunction(() => {
      const saved = JSON.parse(localStorage.getItem("buffer-posts"))?.find(post => post.text === "Local queue calendar check");
      return saved?.deliveryJobs?.length && saved.summary?.startsWith("Scheduled delivery saved · ");
    });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("buffer-posts"))?.find(post => post.text === "Local queue calendar check"));
    assert.equal(saved.status, "scheduled");
    assert.deepEqual(saved.channels, [0]);
    assert.match(saved.summary, /^Scheduled delivery saved · /);
    assert.deepEqual(saved.deliveryJobs.map(job => [job.provider, job.status]), [["instagram", "queued"]]);
    assert.ok(scheduledRequests.some(request => request.method === "POST" && request.url === "/api/scheduled-posts/instagram"));
    assert.ok(Date.parse(saved.scheduleAt) > Date.now());
    await page.goto("http://localhost:4176/schedule", { waitUntil: "networkidle" });
    await page.locator(".pw-post-card").filter({ hasText: "Local queue calendar check" }).waitFor({ state: "visible" });
    await page.goto("http://localhost:4176/schedule/calendar/month", { waitUntil: "networkidle" });
    await page.locator(".pw-calendar-event").filter({ hasText: "Local queue calendar check" }).waitFor({ state: "visible" });
    await page.goto("http://localhost:4176/schedule", { waitUntil: "networkidle" });
    const scheduledCard = page.locator(".pw-post-card").filter({ hasText: "Local queue calendar check" });
    await scheduledCard.getByRole("button", { name: "Edit post" }).click();
    await button("Save Draft").click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("buffer-posts"))?.find(post => post.text === "Local queue calendar check")?.status === "draft");
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("buffer-posts"))?.find(post => post.text === "Local queue calendar check"));
    assert.equal(draft.scheduleAt, null);
    assert.deepEqual(draft.deliveryJobs, []);
    assert.ok(scheduledRequests.some(request => request.method === "DELETE" && request.url.startsWith("/api/scheduled-posts/instagram/")));
    await page.goto("http://localhost:4176/schedule/drafts", { waitUntil: "networkidle" });
    await page.locator(".pw-post-card").filter({ hasText: "Local queue calendar check" }).waitFor({ state: "visible" });
    assert.equal(publishRequests, 0);
  });

  await check("Queue shows per-channel delivery states and asks before an ambiguous retry", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const record = { id: "delivery-review", text: "Review per-channel delivery", status: "scheduled", scheduleAt: future, createdAt: new Date().toISOString(), channels: [0, 1], attachments: [], publishResults: [], deliveryJobs: [] };
    scheduledApiJobs = [
      { id: "instagram-review", postId: record.id, provider: "instagram", status: "failed", scheduledAt: future, attempts: 1, error: "Provider rejected the request", mayHavePublished: false },
      { id: "tiktok-review", postId: record.id, provider: "tiktok", status: "recovery_required", scheduledAt: future, attempts: 1, error: "Check the channel before retrying", mayHavePublished: true },
    ];
    await page.goto("http://localhost:4176/home", { waitUntil: "networkidle" });
    await page.evaluate(value => localStorage.setItem("buffer-posts", JSON.stringify([value])), record);
    await page.reload({ waitUntil: "networkidle" });
    await page.goto("http://localhost:4176/schedule", { waitUntil: "networkidle" });
    const card = page.locator(".pw-post-card").filter({ hasText: record.text });
    await card.getByLabel(/Instagram: Failed/).waitFor({ state: "visible" });
    await card.getByLabel(/TikTok: Review/).waitFor({ state: "visible" });
    await card.getByRole("button", { name: "Retry Instagram" }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("buffer-posts"))?.[0]?.deliveryJobs?.find(job => job.provider === "instagram")?.status === "queued");
    let saved = await page.evaluate(() => JSON.parse(localStorage.getItem("buffer-posts"))?.[0]);
    assert.equal(saved.deliveryJobs.find(job => job.provider === "instagram").status, "queued");
    page.once("dialog", dialog => dialog.accept());
    await card.getByRole("button", { name: "Retry TikTok" }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("buffer-posts"))?.[0]?.deliveryJobs?.find(job => job.provider === "tiktok")?.status === "queued");
    saved = await page.evaluate(() => JSON.parse(localStorage.getItem("buffer-posts"))?.[0]);
    assert.equal(saved.deliveryJobs.find(job => job.provider === "tiktok").status, "queued");
    assert.equal(publishRequests, 0);
  });

  await check("Composer and schedule controls fit 320 px and 390 px mobile widths", async () => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("http://localhost:4176/home", { waitUntil: "networkidle" });
      await page.locator(".pw-mobile-topbar").getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("dialog", { name: "Navigation" }).getByRole("button", { name: "New Post" }).click();
      await page.locator(".composer-modal").waitFor({ state: "visible" });
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, composer: document.querySelector(".composer-modal").scrollWidth }));
      assert.ok(dimensions.page <= width, `page overflow at ${width}px: ${dimensions.page}`);
      assert.ok(dimensions.composer <= width, `composer overflow at ${width}px: ${dimensions.composer}`);
      await button("Choose date and time").click();
      const trigger = button("More posting actions");
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      const box = await page.locator(".date-time-actions-popover").boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, `schedule options are clipped at ${width}px`);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.locator(".date-time-picker").waitFor({ state: "hidden" });
      await button("Cancel").click();
    }
  });

  assert.deepEqual(failures, []);
  console.log(`SUCCESS ${checks.length} composer workflow checks`);
} finally {
  if (failures.length) console.log(JSON.stringify(failures, null, 2));
  await context.close();
  await browser.close();
}
