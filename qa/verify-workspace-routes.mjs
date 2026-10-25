import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: "Africa/Johannesburg" });
page.setDefaultTimeout(6_000);
const errors = [];
page.on("pageerror", error => errors.push({ type: "pageerror", message: error.message, url: page.url() }));
page.on("console", message => { if (message.type() === "error") errors.push({ type: "console", message: message.text(), url: page.url() }); });
page.on("response", response => { if (response.status() >= 400) errors.push({ type: "http", status: response.status(), url: response.url() }); });

const channelIds = ["6abbdc0fea19ca0bde244c7e", "6abbdb9eea19ca0bde244939", "6abbdadbea19ca0bde24433e"];
const routes = [
  ["Home", "/home"], ["Start Page", "/start-page"], ["Publish Queue", "/schedule"], ["Publish Drafts", "/schedule/drafts"],
  ["Publish Sent", "/schedule/sent"], ["Publish Approvals", "/schedule/approvals"], ["Week Calendar", "/schedule/calendar/week"], ["Month Calendar", "/schedule/calendar/month"],
  ["Create Ideas Board", "/create/ideas"], ["Create Ideas Gallery", "/create/ideas?view=gallery"], ["Create Templates", "/create/templates"], ["Create Feeds", "/create/feeds"],
  ["Community Posts", "/community/posts"], ["Community List", "/community"], ["Community Grid", "/community/grid"], ["Community Mentions", "/community/mentions"], ["Insights", "/insights"],
  ["Settings Profile", "/settings"], ["Settings Preferences", "/settings/preferences"], ["Settings Notifications", "/settings/notifications"], ["Settings General", "/settings/general"],
  ["Settings Roles", "/settings/role-and-permissions"], ["Settings Channels", "/settings/channels"], ["Settings Billing", "/settings/billing"], ["Settings Tags", "/settings/tags"],
  ["Settings Channel Groups", "/settings/channel-groups"], ["Settings Saved Replies", "/settings/saved-replies"], ["Settings API", "/settings/api"], ["Settings Apps", "/settings/apps-extras"],
  ["Settings Beta", "/settings/beta"], ["Settings Referrals", "/settings/refer-a-friend"], ["Settings Integrations", "/settings/integrations"],
  ...channelIds.flatMap((id, index) => [[`Channel ${index + 1} Schedule`, `/channels/${id}/schedule`], [`Channel ${index + 1} Settings`, `/channels/${id}/settings`]]),
];
const viewports = [320, 390, 768, 1024, 1440];
const failures = [];
let checks = 0;

try {
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 844 });
    for (const [name, path] of routes) {
      try {
        const response = await page.goto(`http://localhost:4174${path}`, { waitUntil: "networkidle" });
        assert.equal(response?.status(), 200, `${name} returned ${response?.status()}`);
        await page.locator(".pw-main").waitFor({ state: "visible" });
        const metrics = await page.evaluate(() => ({ viewport: innerWidth, width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), title: document.querySelector(".pw-main h1")?.textContent?.trim() }));
        assert.ok(metrics.width <= metrics.viewport, `${name} at ${width}px overflows to ${metrics.width}px`);
        assert.ok(metrics.title, `${name} at ${width}px has no page heading`);
        checks++;
      } catch (error) {
        failures.push({ route: name, path, width, error: error.message });
      }
    }
  }
  assert.deepEqual(failures, []);
  assert.deepEqual(errors, []);
  console.log(`SUCCESS ${checks} route/viewport checks (${routes.length} routes × ${viewports.length} widths)`);
} finally {
  if (failures.length || errors.length) console.log(JSON.stringify({ failures, errors }, null, 2));
  await browser.close();
}
