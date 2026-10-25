import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Africa/Johannesburg" });
const page = await context.newPage();
page.setDefaultTimeout(8_000);
const baseUrl = process.env.POSTLY_BASE_URL || "http://localhost:4174";
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
const checks = [];
const button = name => page.getByRole("button", { name, exact: true });
const run = async (name, fn) => { await fn(); checks.push(name); console.log(`PASS ${name}`); };
let instagramCalls = 0;
let tiktokCalls = 0;
let mockConnected = true;
let failAllProviders = false;

try {
  await page.route("**/api/social/status", route => route.fulfill({ json: { providers: {
    instagram: { name: "Instagram", configured: mockConnected, connected: mockConnected, profile: "ig.test" },
    tiktok: { name: "TikTok", configured: mockConnected, connected: mockConnected, profile: "tt.test" },
    youtube: { name: "YouTube", configured: mockConnected, connected: mockConnected, profile: "yt.test" },
  } } }));
  await page.route("**/api/social/tiktok/creator-info", route => route.fulfill({ json: { creator: {
    username: "tt.test", nickname: "TikTok test account", privacyLevelOptions: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxVideoPostDurationSec: 300,
  } } }));
  await page.route("**/api/social/instagram/publish", async route => {
    instagramCalls++;
    const body = route.request().postDataBuffer();
    assert.ok(body.includes(Buffer.from("postly-test-video")));
    if (failAllProviders) return route.fulfill({ status: 503, json: { error: "Instagram test failure" } });
    return route.fulfill({ json: { ok: true, provider: "instagram", status: "published", remoteId: "ig-post-1" } });
  });
  await page.route("**/api/social/tiktok/publish", async route => {
    tiktokCalls++;
    const body = route.request().postDataBuffer();
    assert.ok(body.includes(Buffer.from("postly-test-video")));
    if (tiktokCalls === 1 || failAllProviders) return route.fulfill({ status: 503, json: { error: "TikTok test failure" } });
    return route.fulfill({ json: { ok: true, provider: "tiktok", status: "published", remoteId: "tt-post-2", publishId: "tt-pub-2", privacyLevel: "SELF_ONLY" } });
  });

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await run("Publish status explains disconnected accounts without claiming publishing is disabled", async () => {
    mockConnected = false;
    await page.goto(`${baseUrl}/schedule`, { waitUntil: "networkidle" });
    const notice = await page.locator(".pw-local-notice").innerText();
    assert.match(notice, /Connect an account to publish live/);
    assert.match(notice, /Scheduled deliveries are stored by this Postly server/);
    assert.match(notice, /Hosted background delivery is not set up/);
    assert.doesNotMatch(notice, /Live publishing is not enabled/);
    mockConnected = true;
    await page.goto(`${baseUrl}/schedule`, { waitUntil: "networkidle" });
    assert.match(await page.locator(".pw-local-notice").innerText(), /Use Publish now for connected accounts/);
  });
  await page.goto(`${baseUrl}/home`, { waitUntil: "networkidle" });
  await run("Composer exposes current TikTok audience options before publishing", async () => {
    await page.locator(".pw-steps article").nth(1).getByRole("button").last().click();
    await page.locator(".composer-modal").waitFor({ state: "visible" });
    await page.locator("textarea[aria-label='composer textbox']").fill("Postly test publish");
    await page.locator("#media-upload").setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("postly-test-video") });
    await page.locator(".media-attachments").waitFor({ state: "visible" });
    await page.locator(".channel-avatar").nth(2).click();
    await button("Choose date and time").click();
    await page.locator(".more-posting-actions").click();
    await page.locator(".date-time-actions-popover button").filter({ hasText: "Now" }).click();
    await button("Customize").click();
    await page.locator(".customize-tabs button").filter({ hasText: "TikTok" }).click();
    await page.locator("#tiktok-audience").waitFor({ state: "visible" });
    await page.locator("#tiktok-audience").selectOption("SELF_ONLY");
    assert.equal(await page.locator("#tiktok-audience option").count(), 3);
    assert.match(await page.locator(".customize-content").innerText(), /TikTok test account/);
  });

  await run("Partial provider failure leaves only the failed channel selected for retry", async () => {
    await page.locator(".customize-tabs button").filter({ hasText: "Instagram" }).click();
    await page.locator(".radio-option").filter({ hasText: "Reel" }).locator("input").check();
    await page.locator(".customize-tabs button").filter({ hasText: "TikTok" }).click();
    await button("Publish now").click();
    await page.getByRole("alert").filter({ hasText: "Only the channels that failed remain selected" }).waitFor({ state: "visible" });
    const channels = page.locator(".channel-avatar");
    assert.equal(await channels.nth(0).getAttribute("aria-pressed"), "false");
    assert.equal(await channels.nth(1).getAttribute("aria-pressed"), "true");
    assert.equal(await channels.nth(2).getAttribute("aria-pressed"), "false");
    const record = await page.evaluate(() => JSON.parse(localStorage.getItem("buffer-posts"))[0]);
    assert.equal(record.status, "published");
    assert.deepEqual(record.channels, [0, 1]);
    assert.deepEqual(record.publishResults.map(result => [result.provider, result.status]), [["instagram", "published"], ["tiktok", "failed"]]);
    assert.equal(record.publishResults[1].error, "TikTok test failure");
    assert.equal(instagramCalls, 1);
    assert.equal(tiktokCalls, 1);

    await page.goto(`${baseUrl}/schedule/sent`, { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    const failedCard = page.locator(".pw-real-post").filter({ hasText: "Postly test publish" });
    assert.equal(await failedCard.count(), 1);
    await failedCard.getByLabel("Instagram: Published").waitFor();
    await failedCard.getByLabel("TikTok: Failed — TikTok test failure").waitFor();
    await page.getByRole("textbox", { name: "Search posts" }).fill("TikTok test failure");
    assert.equal(await page.locator(".pw-post-list .pw-real-post").count(), 1);
    await page.getByRole("textbox", { name: "Search posts" }).fill("");
    await failedCard.getByRole("button", { name: "Edit post" }).click();
    await page.locator(".composer-modal").waitFor({ state: "visible" });
    const retrySelection = page.locator(".channel-avatar");
    assert.equal(await retrySelection.nth(0).getAttribute("aria-pressed"), "false");
    assert.equal(await retrySelection.nth(1).getAttribute("aria-pressed"), "true");
    assert.equal(await retrySelection.nth(2).getAttribute("aria-pressed"), "false");
  });

  await run("Retry publishes only to TikTok and merges into one local record", async () => {
    await button("Customize").click();
    await button("Publish now").click();
    await page.locator(".composer-modal").waitFor({ state: "detached" });
    const records = await page.evaluate(() => JSON.parse(localStorage.getItem("buffer-posts")));
    assert.equal(records.length, 1);
    assert.equal(records[0].status, "published");
    assert.deepEqual(records[0].channels, [0, 1]);
    assert.deepEqual(records[0].publishResults.map(result => [result.provider, result.status]), [["instagram", "published"], ["tiktok", "published"]]);
    assert.equal(instagramCalls, 1);
    assert.equal(tiktokCalls, 2);
  });

  await run("A provider-confirmed publish is labeled Published in the sent archive", async () => {
    await page.goto(`${baseUrl}/schedule/sent`, { waitUntil: "networkidle" });
    assert.equal(await page.locator(".pw-record-status").first().innerText(), "Published");
    assert.match(await page.locator(".pw-post-card").first().innerText(), /Instagram/);
    assert.match(await page.locator(".pw-post-card").first().innerText(), /TikTok/);
  });

  await run("All provider failures persist as a retryable draft after navigation and refresh", async () => {
    failAllProviders = true;
    await page.goto(`${baseUrl}/home`, { waitUntil: "networkidle" });
    await page.locator(".pw-steps article").nth(1).getByRole("button").last().click();
    await page.locator("textarea[aria-label='composer textbox']").fill("All provider failure test");
    await page.locator("#media-upload").setInputFiles({ name: "all-fail-clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("postly-test-video") });
    await page.locator(".media-attachments").waitFor({ state: "visible" });
    await page.locator(".channel-avatar").nth(2).click();
    await button("Choose date and time").click();
    await page.locator(".more-posting-actions").click();
    await page.locator(".date-time-actions-popover button").filter({ hasText: "Now" }).click();
    await button("Customize").click();
    await page.locator(".radio-option").filter({ hasText: "Reel" }).locator("input").check();
    await page.locator(".customize-tabs button").filter({ hasText: "TikTok" }).click();
    await page.locator("#tiktok-audience").waitFor({ state: "visible" });
    await page.locator("#tiktok-audience").selectOption("SELF_ONLY");
    await button("Publish now").click();
    await page.getByRole("alert").filter({ hasText: "Only the channels that failed remain selected for retry" }).waitFor({ state: "visible" });
    const failedRecord = await page.evaluate(() => JSON.parse(localStorage.getItem("buffer-posts")).find(item => item.text === "All provider failure test"));
    assert.equal(failedRecord.status, "draft");
    assert.deepEqual(failedRecord.channels, [0, 1]);
    assert.deepEqual(failedRecord.publishResults.map(result => [result.provider, result.status]), [["instagram", "failed"], ["tiktok", "failed"]]);
    assert.ok(failedRecord.attachments.length);

    await page.goto(`${baseUrl}/schedule/drafts`, { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    const failedCard = page.locator(".pw-real-post").filter({ hasText: "All provider failure test" });
    await failedCard.getByLabel("Instagram: Failed — Instagram test failure").waitFor();
    await failedCard.getByLabel("TikTok: Failed — TikTok test failure").waitFor();
    await failedCard.getByRole("button", { name: "Edit post" }).click();
    const retrySelection = page.locator(".channel-avatar");
    assert.equal(await retrySelection.nth(0).getAttribute("aria-pressed"), "true");
    assert.equal(await retrySelection.nth(1).getAttribute("aria-pressed"), "true");
    assert.equal(await retrySelection.nth(2).getAttribute("aria-pressed"), "false");
    failAllProviders = false;
  });

  assert.deepEqual(pageErrors, []);
  console.log(`SUCCESS ${checks.length} live-publish UI checks`);
} finally {
  await context.close();
  await browser.close();
}
