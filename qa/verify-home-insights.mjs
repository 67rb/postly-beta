import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: "Africa/Johannesburg", acceptDownloads: true });
page.setDefaultTimeout(7_000);
const errors = [];
const insightRequests = [];
let connected = true;
const liveProviders = {
  instagram: { name: "Instagram", configured: true, connected: true, profile: "studio.ig", scopes: ["instagram_business_manage_insights"] },
  tiktok: { name: "TikTok", configured: false, connected: false, profile: "", scopes: [] },
  youtube: { name: "YouTube", configured: true, connected: true, profile: "Studio Channel", scopes: ["youtube.readonly"] },
};
const disconnectedProviders = Object.fromEntries(Object.entries(liveProviders).map(([provider, status]) => [provider, { ...status, connected: false }]));
const fixture = {
  accounts: [
    { provider: "instagram", name: "studio.ig", followers: 1284, summary: { followers: 1284, views: 25000, likes: 120, comments: 30, shares: 10, reactions: 160, posts: 12 } },
    { provider: "youtube", name: "Studio Channel", followers: 250, summary: { followers: 250, views: 9000, likes: 70, comments: 9, shares: 0, reactions: 79, posts: 4 } },
  ],
  posts: [
    { id: "ig-post-1", provider: "instagram", text: "A studio update", createdAt: "2026-10-22T10:00:00Z", permalink: "https://instagram.com/p/demo", metrics: { likes: 120, comments: 30, shares: 10, views: 1200, reactions: 160 } },
    { id: "yt-post-1", provider: "youtube", text: "Creator recap", createdAt: "2026-10-21T10:00:00Z", permalink: "https://youtube.com/watch?v=demo", metrics: { likes: 70, comments: 9, shares: 0, views: 800, reactions: 79 } },
    { id: "ig-post-old", provider: "instagram", text: "Older studio update", createdAt: "2026-10-16T10:00:00Z", permalink: "https://instagram.com/p/older", metrics: { likes: 5, comments: 2, shares: 0, views: 100, reactions: 7 } },
  ],
  errors: [],
  source: "synthetic",
};

try {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) errors.push(response.status() + " " + response.url()); });
  await page.route("**/api/social/status", route => route.fulfill({ json: { providers: connected ? liveProviders : disconnectedProviders } }));
  await page.route("**/api/social/insights**", route => {
    const url = new URL(route.request().url());
    insightRequests.push({ since: url.searchParams.get("since"), until: url.searchParams.get("until") });
    return route.fulfill({ json: fixture });
  });
  await page.route("**/api/social/community**", route => route.fulfill({ json: { kind: "comments", items: [], unavailable: [], errors: [], source: "synthetic" } }));

  await page.goto("http://localhost:4174/home", { waitUntil: "networkidle" });
  const homeScore = page.locator(".pw-score-row article:last-child .pw-home-score-figure");
  await homeScore.waitFor();
  assert.equal(await homeScore.locator("> span").textContent(), "39");
  assert.equal(await homeScore.locator("> small").textContent(), "SAMPLE");
  assert.match(await homeScore.getAttribute("title"), /Synthetic sample data/);
  assert.match(await page.locator(".pw-score-row article").first().innerText(), /Local history/);
  assert.match(await page.locator(".pw-score-row article").nth(1).innerText(), /local history/);
  await page.getByRole("button", { name: "About Comment Score" }).click();
  assert.match(await page.getByRole("status").innerText(), /connected provider data when available/);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const size = await page.evaluate(() => ({ viewport: innerWidth, content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
    assert.ok(size.content <= size.viewport, "Home overflows at " + width + "px: " + size.content + "px");
    if (width === 390) {
      assert.equal(await homeScore.locator("> small").isVisible(), true);
      await page.getByRole("button", { name: "About Comment Score" }).click();
      assert.match(await page.getByRole("status").innerText(), /connected provider data when available/);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://localhost:4174/insights", { waitUntil: "networkidle" });
  const metrics = page.locator(".pw-insight-summary .pw-metrics article");
  await page.getByText("Synthetic sample data").first().waitFor();
  assert.equal(await metrics.nth(0).locator("b").textContent(), "3");
  assert.equal(await metrics.nth(1).locator("b").textContent(), "1.5K");
  assert.equal(await metrics.nth(2).locator("b").textContent(), "239");
  assert.equal(await metrics.nth(3).locator("b").textContent(), "39");
  assert.equal(await page.locator(".pw-top-posts article").count(), 3);
  assert.ok(insightRequests.some(request => request.since && request.until));

  await page.locator(".pw-insight-toolbar>.pw-tabs").getByRole("button", { name: "7 Days" }).click();
  await page.waitForFunction(() => document.querySelector(".pw-insight-summary .pw-metrics article b")?.textContent === "2");
  assert.equal(await page.locator(".pw-top-posts article").count(), 2);
  assert.equal(await page.getByText("Older studio update", { exact: true }).count(), 0);
  const csvDownloadPromise = page.waitForEvent("download");
  await page.locator(".pw-insight-toolbar>.pw-filter-row button").last().click();
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csvDownload = await csvDownloadPromise;
  const csv = readFileSync(await csvDownload.path(), "utf8");
  assert.match(csv, /Synthetic sample data/);
  assert.match(csv, /ig-post-1/);
  assert.match(csv, /yt-post-1/);
  assert.doesNotMatch(csv, /ig-post-old/);

  await page.locator(".pw-insight-toolbar>.pw-filter-row button").first().click();
  await page.locator(".pw-insight-toolbar>.pw-filter-row input[type=checkbox]").first().uncheck();
  await page.waitForFunction(() => document.querySelector(".pw-insight-summary .pw-metrics article b")?.textContent === "1");
  assert.equal(await metrics.nth(1).locator("b").textContent(), "250");
  assert.equal(await metrics.nth(3).locator("b").textContent(), "9");
  assert.equal(await page.locator(".pw-top-posts article").count(), 1);
  assert.equal(await page.locator(".pw-table>div").count(), 2);
  const jsonDownloadPromise = page.waitForEvent("download");
  await page.locator(".pw-insight-toolbar>.pw-filter-row button").last().click();
  await page.getByRole("button", { name: "Download JSON" }).click();
  const jsonDownload = await jsonDownloadPromise;
  const exported = JSON.parse(readFileSync(await jsonDownload.path(), "utf8"));
  assert.deepEqual(exported.filters.providers, ["youtube"]);
  assert.equal(exported.source, "synthetic");
  assert.equal(exported.posts.length, 1);
  assert.equal(exported.posts[0].id, "yt-post-1");
  assert.equal(exported.summary.posts, 1);

  await page.locator(".pw-insight-toolbar>.pw-filter-row button").first().click();
  await page.getByRole("button", { name: "Select all" }).click();
  await page.locator(".pw-insight-toolbar>.pw-tabs").getByRole("button", { name: "Custom" }).click();
  await page.locator("input[aria-label='Insights start date']").fill("2026-10-22");
  await page.locator("input[aria-label='Insights end date']").fill("2026-10-22");
  await page.waitForFunction(() => document.querySelector(".pw-insight-summary .pw-metrics article b")?.textContent === "1");
  assert.ok(insightRequests.some(request => request.since === "2026-10-22" && request.until === "2026-10-22"));
  assert.equal(await page.locator(".pw-top-posts article").count(), 1);
  await page.getByText("A studio update", { exact: true }).waitFor();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const mobileSize = await page.evaluate(() => ({ viewport: innerWidth, content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
    assert.ok(mobileSize.content <= mobileSize.viewport, "Insights overflows at " + width + "px: " + mobileSize.content + "px");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".pw-insight-mobile-tools .pw-range-wrap>button").click();
  await page.getByRole("button", { name: "30 Days", exact: true }).last().click();
  await page.locator(".pw-insight-mobile-tools button[aria-label='Filter insights by channel']").click();
  await page.locator(".pw-insight-mobile-tools input[type=checkbox]").first().uncheck();
  await page.waitForFunction(() => document.querySelector(".pw-insight-summary .pw-metrics article b")?.textContent === "1");
  const mobileJsonDownloadPromise = page.waitForEvent("download");
  await page.locator(".pw-insight-mobile-export").click();
  await page.getByRole("button", { name: "Download JSON" }).click();
  const mobileJsonDownload = await mobileJsonDownloadPromise;
  const mobileExport = JSON.parse(readFileSync(await mobileJsonDownload.path(), "utf8"));
  assert.deepEqual(mobileExport.filters.providers, ["youtube"]);
  assert.equal(mobileExport.posts.length, 1);

  connected = false;
  await page.goto("http://localhost:4174/home", { waitUntil: "networkidle" });
  const disconnectedHomeScore = page.locator(".pw-score-row article:last-child .pw-home-score-figure");
  await disconnectedHomeScore.waitFor();
  assert.equal(await disconnectedHomeScore.locator("> span").textContent(), "—");
  assert.equal(await disconnectedHomeScore.locator("> small").textContent(), "OFF");
  await page.goto("http://localhost:4174/insights", { waitUntil: "networkidle" });
  const disconnectedMetrics = page.locator(".pw-insight-summary .pw-metrics article b");
  await disconnectedMetrics.first().waitFor();
  assert.deepEqual(await disconnectedMetrics.allTextContents(), ["—", "—", "—", "—", "—", "—"]);
  assert.match(await page.locator(".pw-insight-summary>.pw-muted").innerText(), /Disconnected · live metrics unavailable/);
  assert.deepEqual(errors, []);
  console.log("PASS Home comment summary uses the shared Insights response and labels local/sample data");
  console.log("PASS Insights date/channel filters and CSV/JSON exports use the selected provider data");
  console.log("PASS disconnected Home and Insights show unavailable metrics, not fabricated zeroes");
  console.log("PASS Home and Insights fit at mobile widths and mobile filter/export controls work");
} finally {
  await browser.close();
}
