import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: "Africa/Johannesburg" });
page.setDefaultTimeout(7_000);
const errors = [];
const requests = [];
let expectedReplyFailure = false;
let expectedForbiddenConsoleCount = 0;
const screenshot = name => fileURLToPath(new URL(`./current/postly-connected-${name}.png`, import.meta.url));
mkdirSync(new URL("./current/", import.meta.url), { recursive: true });
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {
  if (message.type() !== "error") return;
  if (expectedForbiddenConsoleCount && message.text().includes("status of 403 (Forbidden)")) {
    expectedForbiddenConsoleCount -= 1;
    return;
  }
  errors.push(message.text());
});
page.on("response", response => {
  const isExpectedReplyFailure = expectedReplyFailure && response.status() === 403 && response.url().includes("/api/social/instagram/comments/ig-comment-1/reply");
  if (isExpectedReplyFailure) {
    expectedReplyFailure = false;
    expectedForbiddenConsoleCount += 1;
  } else if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
});

const providers = {
  instagram: { name: "Instagram", configured: true, connected: true, profile: "studio.ig", scopes: ["instagram_business_manage_comments", "instagram_business_manage_insights"] },
  tiktok: { name: "TikTok", configured: false, connected: false, profile: "", scopes: [] },
  youtube: { name: "YouTube", configured: true, connected: true, profile: "Studio Channel", scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"] },
};
let instagramScopes = providers.instagram.scopes;
const commentItems = [
  { id: "yt-comment-1", provider: "youtube", postId: "yt-video-1", author: "Jordan", text: "Useful walkthrough.", createdAt: "2026-10-21T10:00:00Z", permalink: "https://youtube.com/watch?v=demo", postText: "Creator recap", replies: [] },
  { id: "ig-comment-1", provider: "instagram", postId: "ig-post-1", author: "Mina", text: "Great video!", createdAt: "2026-10-22T10:00:00Z", permalink: "https://instagram.com/p/demo", postText: "A studio update", replies: [] },
  { id: "ig-comment-2", provider: "instagram", postId: "ig-post-1", author: "Rae", text: "Could you share the checklist?", createdAt: "2026-10-23T10:00:00Z", permalink: "https://instagram.com/p/demo", postText: "A studio update", replies: [] },
];
const mentions = [{ id: "ig-mention-1", provider: "instagram", postId: "ig-mention-post", author: "Studio friend", text: "@studio.ig this reminded me of you", createdAt: "2026-10-23T10:00:00Z", permalink: "https://instagram.com/p/mention", postText: "Mention from a creator" }];

try {
  await page.route("**/api/social/status", route => route.fulfill({ json: { providers: { ...providers, instagram: { ...providers.instagram, scopes: instagramScopes } } } }));
  await page.route("**/api/social/insights**", async route => {
    requests.push({ path: new URL(route.request().url()).pathname, query: new URL(route.request().url()).searchParams });
    await route.fulfill({ json: {
      accounts: [
        { provider: "instagram", name: "studio.ig", followers: 1284, posts: 12, summary: { followers: 1284, views: 25000, likes: 120, comments: 30, shares: 10, reactions: 160, engagement: 12.46, posts: 12 } },
        { provider: "youtube", name: "Studio Channel", followers: 250, posts: 4, summary: { followers: 250, views: 9000, likes: 70, comments: 9, shares: 0, reactions: 79, engagement: 31.6, posts: 4 } },
      ],
      summary: { followers: 1534, views: 34000, likes: 190, comments: 39, shares: 10, reactions: 239, engagement: 15.58, posts: 16 },
      posts: [
        { id: "ig-post-1", provider: "instagram", text: "A studio update", createdAt: "2026-10-22T10:00:00Z", permalink: "https://instagram.com/p/demo", metrics: { likes: 120, comments: 30, shares: 10, views: 1200, reactions: 160 } },
        { id: "yt-video-1", provider: "youtube", text: "Creator recap", createdAt: "2026-10-21T10:00:00Z", permalink: "https://youtube.com/watch?v=demo", metrics: { likes: 70, comments: 9, shares: 0, views: 800, reactions: 79 } },
      ], errors: [], source: "synthetic",
    } });
  });
  await page.route("**/api/social/community**", route => {
    const kind = new URL(route.request().url()).searchParams.get("kind");
    requests.push({ path: new URL(route.request().url()).pathname, kind });
    return route.fulfill({ json: { kind, items: kind === "mentions" ? mentions : commentItems, unavailable: [{ provider: "tiktok", message: "TikTok's standard creator API does not provide a comment or mention inbox." }], errors: [], source: "synthetic" } });
  });
  await page.route("**/api/social/instagram/comments/ig-comment-1/reply", async route => {
    const body = route.request().postDataJSON();
    requests.push({ path: new URL(route.request().url()).pathname, body });
    if (body.text === "Blocked reply") {
      expectedReplyFailure = true;
      await route.fulfill({ status: 403, json: { error: "Instagram comment management permission is required." } });
      return;
    }
    assert.equal(body.text, "Thanks for watching!");
    await route.fulfill({ status: 201, json: { ok: true, reply: { id: "ig-reply-1", provider: "instagram", text: body.text } } });
  });
  await page.route("**/api/social/youtube/comments/yt-comment-1/reply", async route => {
    const body = route.request().postDataJSON();
    assert.equal(body.text, "Thanks from YouTube!");
    requests.push({ path: new URL(route.request().url()).pathname, body });
    await route.fulfill({ status: 201, json: { ok: true, reply: { id: "yt-reply-1", provider: "youtube", text: body.text } } });
  });

  await page.goto("http://localhost:4174/home", { waitUntil: "networkidle" });
  await page.locator(".pw-home-comments-list").waitFor();
  await page.locator(".pw-home-comments-list").getByText("Great video!").waitFor();
  await page.screenshot({ path: screenshot("home-1440x900"), animations: "disabled" });
  await page.goto("http://localhost:4174/insights", { waitUntil: "networkidle" });
  await page.locator(".pw-insight-summary").waitFor();
  await page.getByText("A studio update", { exact: true }).waitFor();
  await page.getByText("Synthetic sample data").first().waitFor();
  await page.screenshot({ path: screenshot("insights-1440x900"), animations: "disabled" });
  assert.equal(await page.locator(".pw-insight-summary .pw-metrics article").nth(1).locator("b").textContent(), "1.5K");
  assert.equal(await page.locator(".pw-insight-summary .pw-metrics article").nth(2).locator("b").textContent(), "239");
  await page.locator(".pw-insight-toolbar>.pw-tabs").getByRole("button", { name: "7 Days" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".pw-top-posts article").length > 0);
  assert.ok(requests.some(item => item.path === "/api/social/insights" && item.query?.get("since")));
  await page.locator(".pw-insight-toolbar>.pw-filter-row").getByRole("button", { name: /Channels/ }).click();
  await page.locator(".pw-insight-toolbar>.pw-filter-row input[type=checkbox]").first().uncheck();
  assert.equal(await page.locator(".pw-top-posts article").count(), 1);
  await page.getByRole("button", { name: "Select all" }).click();
  assert.equal(await page.locator(".pw-top-posts article").count(), 2);

  await page.goto("http://localhost:4174/community/posts", { waitUntil: "networkidle" });
  await page.locator(".pw-community-comment").filter({ hasText: "Great video!" }).waitFor();
  await page.screenshot({ path: screenshot("community-1440x900"), animations: "disabled" });
  assert.equal(await page.locator(".pw-page-count").textContent(), "3");
  await page.getByRole("status").filter({ hasText: "synthetic sample data" }).waitFor();
  assert.match(await page.locator(".pw-community-list-item").first().innerText(), /A studio update/);
  await page.getByRole("button", { name: "Sort order: newest first" }).click();
  assert.match(await page.locator(".pw-community-list-item").first().innerText(), /Creator recap/);
  await page.getByRole("button", { name: "Sort order: oldest first" }).click();
  assert.match(await page.locator(".pw-community-list-item").first().innerText(), /A studio update/);
  await page.locator(".pw-community-list-item").filter({ hasText: "Creator recap" }).click();
  const youtubeComment = page.locator(".pw-community-comment").filter({ hasText: "Useful walkthrough." });
  await youtubeComment.getByRole("textbox", { name: "Reply to Jordan" }).fill("Thanks from YouTube!");
  await youtubeComment.getByRole("button", { name: "Reply", exact: true }).click();
  await youtubeComment.getByText("Thanks from YouTube!", { exact: true }).waitFor();
  await page.locator(".pw-community-list-item").filter({ hasText: "A studio update" }).click();

  await page.getByRole("button", { name: "Channels", exact: true }).click();
  const channelCheckboxes = page.locator(".pw-filter-popover input[type=checkbox]");
  assert.equal(await channelCheckboxes.count(), 2);
  await channelCheckboxes.nth(1).uncheck();
  await page.waitForFunction(() => document.querySelector(".pw-page-count")?.textContent === "2");
  const savedFilters = await page.evaluate(() => ({
    community: JSON.parse(localStorage.getItem("postly-community-channel-filters") || "{}"),
    shared: JSON.parse(localStorage.getItem("postly-filters") || "{}"),
  }));
  assert.equal(savedFilters.community.youtube, false);
  assert.equal(Object.hasOwn(savedFilters.shared, "Instagram"), false);
  await page.getByRole("button", { name: "All channels" }).click();
  await page.waitForFunction(() => document.querySelector(".pw-page-count")?.textContent === "3");
  assert.equal(await page.locator(".pw-page-count").textContent(), "3");

  await page.getByRole("textbox", { name: "Search inbox" }).fill("studio update checklist");
  assert.equal(await page.locator(".pw-page-count").textContent(), "2");
  await page.getByText("Great video!", { exact: true }).waitFor();
  await page.locator(".pw-community-detail").getByText("Could you share the checklist?", { exact: true }).waitFor();
  const replyField = page.getByRole("textbox", { name: "Reply to Mina" });
  const replyButton = page.locator(".pw-community-comment").filter({ hasText: "Great video!" }).getByRole("button", { name: "Reply", exact: true });
  await replyField.fill("   ");
  assert.equal(await replyButton.isEnabled(), false);
  await replyField.fill("x".repeat(2001));
  const oversizedLength = await replyField.evaluate(element => element.value.length);
  assert.ok(oversizedLength <= 2000 || !(await replyButton.isEnabled()), "overlong replies must be truncated or blocked");
  assert.equal(await replyField.getAttribute("maxlength"), "2000");
  await replyField.fill("Blocked reply");
  await replyButton.click();
  await page.locator(".pw-community-comment").filter({ hasText: "Great video!" }).getByRole("alert").waitFor();
  assert.equal(await replyField.inputValue(), "Blocked reply");
  await replyField.fill("Thanks for watching!");
  assert.equal(await page.locator(".pw-community-comment").filter({ hasText: "Great video!" }).getByRole("alert").count(), 0);
  await replyButton.click();
  await page.locator(".pw-community-reply").filter({ hasText: "Thanks for watching!" }).waitFor();

  await page.getByRole("textbox", { name: "Search inbox" }).fill("THANKS WATCHING");
  await page.locator(".pw-community-list-item").filter({ hasText: "A studio update" }).waitFor();
  await page.getByText("Thanks for watching!", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear inbox search" }).click();
  assert.deepEqual((await page.locator(".pw-community-comment-top>b").allTextContents()).slice(0, 2), ["Mina", "Rae"]);

  const minaComment = page.locator(".pw-community-comment").filter({ hasText: "Great video!" });
  await minaComment.getByRole("button", { name: "Resolve", exact: true }).click();
  assert.equal(await minaComment.getByRole("button", { name: "Reopen", exact: true }).getAttribute("aria-pressed"), "true");
  await minaComment.getByRole("button", { name: "Reopen", exact: true }).click();
  assert.equal(await minaComment.getByRole("button", { name: "Resolve", exact: true }).getAttribute("aria-pressed"), "false");
  await page.getByRole("button", { name: "Resolve selected conversation" }).click();
  await page.getByRole("button", { name: "Reopen selected conversation" }).waitFor();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("postly-resolved-comments") || "[]").includes("instagram:ig-comment-1"));
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".pw-community-comment").filter({ hasText: "Great video!" }).waitFor();
  assert.equal(await page.locator(".pw-community-comment").filter({ hasText: "Great video!" }).evaluate(element => element.classList.contains("resolved")), true);
  await page.getByRole("button", { name: "All" }).click();
  await page.getByRole("button", { name: "Resolved", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".pw-page-count")?.textContent === "2");
  assert.equal(await page.locator(".pw-page-count").textContent(), "2");
  await page.getByRole("button", { name: "Reopen selected conversation" }).click();
  await page.waitForFunction(() => document.querySelector(".pw-page-count")?.textContent === "0");
  await page.getByRole("button", { name: "Resolved" }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".pw-page-count")?.textContent === "3");
  assert.equal(await page.locator(".pw-page-count").textContent(), "3");

  await page.getByRole("button", { name: "Channels", exact: true }).click();
  await page.locator(".pw-filter-popover input[type=checkbox]").nth(1).uncheck();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector(".pw-page-count")?.textContent === "2");
  assert.equal(await page.locator(".pw-page-count").textContent(), "2");
  await page.getByRole("button", { name: "Channels", exact: true }).click();
  await page.getByRole("button", { name: "All channels" }).click();
  await page.waitForFunction(() => document.querySelector(".pw-page-count")?.textContent === "3");
  assert.equal(await page.locator(".pw-page-count").textContent(), "3");

  await page.getByRole("button", { name: "Mentions", exact: true }).first().click();
  await page.locator(".pw-community-comment").filter({ hasText: "@studio.ig this reminded me of you" }).waitFor();
  assert.equal(await page.locator(".pw-community-reply-form").count(), 0);
  await page.locator(".pw-data-limit").filter({ hasText: "TikTok's standard creator API" }).waitFor();
  assert.ok(requests.some(item => item.path === "/api/social/community" && item.kind === "mentions"));
  await page.getByRole("button", { name: "List", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("tab"), "mentions");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".pw-community-comment").filter({ hasText: "@studio.ig this reminded me of you" }).waitFor();

  instagramScopes = [];
  await page.goto("http://localhost:4174/community/posts", { waitUntil: "networkidle" });
  await page.locator(".pw-community-comment").filter({ hasText: "Great video!" }).waitFor();
  const instagramCommentWithoutScope = page.locator(".pw-community-comment").filter({ hasText: "Great video!" });
  assert.equal(await instagramCommentWithoutScope.locator(".pw-community-reply-form").count(), 0);
  await instagramCommentWithoutScope.getByText("Reconnect this account and grant comment management access to reply.").waitFor();
  instagramScopes = providers.instagram.scopes;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:4174/community", { waitUntil: "networkidle" });
  await page.locator(".pw-community-list-item").filter({ hasText: "Rae" }).waitFor();
  const mobile = await page.evaluate(() => ({ viewport: innerWidth, width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
  assert.ok(mobile.width <= mobile.viewport, `Community view overflows at 390px: ${mobile.width}px`);
  const raeRow = page.locator(".pw-community-list-item").filter({ hasText: "Rae" }).first();
  await raeRow.click();
  assert.equal(await page.locator(".pw-community-layout").evaluate(element => element.classList.contains("pw-mobile-detail")), true);
  await page.keyboard.press("Escape");
  const escapeFocus = await page.evaluate(() => {
    const active = document.activeElement;
    const rect = active?.getBoundingClientRect();
    return { text: active?.textContent || "", selected: active?.getAttribute("aria-pressed"), visible: Boolean(rect && rect.bottom > 0 && rect.top < innerHeight) };
  });
  assert.match(escapeFocus.text, /Rae/);
  assert.equal(escapeFocus.selected, "true");
  assert.equal(escapeFocus.visible, true);
  await raeRow.click();
  await page.getByRole("button", { name: "Back to inbox" }).click();
  const backFocus = await page.evaluate(() => ({ text: document.activeElement?.textContent || "", selected: document.activeElement?.getAttribute("aria-pressed") }));
  assert.match(backFocus.text, /Rae/);
  assert.equal(backFocus.selected, "true");
  await page.setViewportSize({ width: 320, height: 700 });
  const narrowMobile = await page.evaluate(() => ({ viewport: innerWidth, width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
  assert.ok(narrowMobile.width <= narrowMobile.viewport, `Community view overflows at 320px: ${narrowMobile.width}px`);
  assert.deepEqual(requests.filter(item => item.path?.endsWith("/reply")).map(item => item.body.text).sort(), ["Blocked reply", "Thanks for watching!", "Thanks from YouTube!"].sort());
  console.log("PASS Community conversation search, independent channel filters, newest/oldest sorting, and filter persistence");
  console.log("PASS resolve/reopen persists locally; scoped Instagram and YouTube replies validate and use mocked responses only");
  console.log("PASS mobile Back and Escape return focus to the selected visible row at 390px; no overflow at 320px");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:4174/insights", { waitUntil: "networkidle" });
  await page.locator(".pw-insight-summary").waitFor();
  await page.screenshot({ path: screenshot("insights-mobile-390x844"), animations: "disabled" });
  await page.locator(".pw-insight-mobile-tools .pw-range-wrap>button").click();
  await page.getByRole("button", { name: "30 Days", exact: true }).last().click();
  await page.locator(".pw-insight-mobile-tools button[aria-label='Filter insights by channel']").click();
  await page.locator(".pw-insight-mobile-tools input[type=checkbox]").first().uncheck();
  await page.locator(".pw-top-posts article").first().waitFor();
  assert.equal(await page.locator(".pw-top-posts article").count(), 1);
  await page.locator(".pw-insight-mobile-export").click();
  await page.getByRole("button", { name: "Download JSON" }).click();
  assert.deepEqual(errors, []);
  console.log("PASS synthetic Insights fixture is labeled clearly and filters account summaries, posts, and date queries");
  console.log("PASS Home previews connected comments; Community renders comments and mentions, persists resolution, and posts replies");
  console.log("PASS responsive Community and Insights controls work without mobile overflow or browser errors");
} finally {
  await browser.close();
}
