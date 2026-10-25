import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: "Africa/Johannesburg" });
page.setDefaultTimeout(6000);
const baseUrl = process.env.POSTLY_BASE_URL || "http://localhost:4174";
await page.addInitScript(() => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { window.__postlyCopiedText = value; } } });
});
const errors = [];
const checks = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
const check = async (name, run) => { await run(); checks.push(name); console.log(`PASS ${name}`); };
const visible = selector => page.locator(selector).waitFor({ state: "visible" });

try {
  await page.goto(`${baseUrl}/home`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await check("New menu opens its actions and closes on Escape", async () => {
    await page.locator(".pw-sidebar .pw-new").click();
    await visible(".pw-new-popover");
    assert.equal(await page.locator(".pw-new-popover > button").count(), 5);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".pw-new-popover").count(), 0);
  });

  await check("Organization menu opens Help center and closes by Escape", async () => {
    await page.locator(".pw-organization").click();
    await visible(".pw-org-popover");
    await page.locator(".pw-org-popover").getByRole("button", { name: "Help center", exact: true }).click();
    assert.equal(await page.getByRole("dialog", { name: "Help center" }).count(), 1);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".pw-modal").count(), 0);
  });

  await check("New menu opens the composer and the close action returns to Home", async () => {
    await page.locator(".pw-sidebar .pw-new").click();
    await page.locator(".pw-new-popover").getByRole("button", { name: "Post", exact: false }).click();
    await visible(".composer-modal");
    await page.getByRole("button", { name: "Close Composer", exact: true }).click();
    assert.equal(await page.locator(".composer-modal").count(), 0);
  });

  await check("Connect Channel shows provider readiness, callback URLs, required keys, and working copy controls", async () => {
    await page.route("**/api/social/status", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providers: {
      instagram: { name: "Instagram", configured: true, connected: false, readyToConnect: true, requiredEnvironmentKeys: ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"], missingEnvironmentKeys: [], redirectUri: "http://localhost:4175/api/social/instagram/callback" },
      tiktok: { name: "TikTok", configured: false, connected: false, readyToConnect: false, requiredEnvironmentKeys: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], missingEnvironmentKeys: ["TIKTOK_CLIENT_SECRET"], redirectUri: "http://localhost:4175/api/social/tiktok/callback" },
      youtube: { name: "YouTube", configured: true, connected: true, readyToConnect: false, profile: "Studio Channel", requiredEnvironmentKeys: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"], missingEnvironmentKeys: [], redirectUri: "http://localhost:4175/api/social/youtube/callback" },
    } }) }));
    await page.locator(".pw-sidebar .pw-new").click();
    await page.locator(".pw-new-popover").getByRole("button", { name: "Connect a New Channel", exact: true }).click();
    await page.getByRole("dialog", { name: "Connect Channel" }).waitFor();
    assert.match(await page.locator(".interaction-dialog").innerText(), /Instagram|TikTok|YouTube/);
    const cases = [
      { name: "Instagram", keys: ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"], url: "http://localhost:4175/api/social/instagram/callback", state: "Disconnected · Ready to connect", marker: "Set", connectEnabled: true },
      { name: "TikTok", keys: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], missingKeys: ["TIKTOK_CLIENT_SECRET"], url: "http://localhost:4175/api/social/tiktok/callback", state: "Disconnected · Setup required", marker: "Missing", connectEnabled: false },
      { name: "YouTube", keys: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"], url: "http://localhost:4175/api/social/youtube/callback", state: "Connected as Studio Channel", marker: "Set", connectEnabled: null },
    ];
    for (const provider of cases) {
      await page.getByRole("button", { name: provider.name, exact: true }).click();
      const card = page.locator(".social-connect-card");
      await card.getByRole("status").getByText(provider.state, { exact: true }).waitFor();
      if (provider.connectEnabled !== null) assert.equal(await card.getByRole("button", { name: `Connect ${provider.name} account` }).isEnabled(), provider.connectEnabled);
      else assert.equal(await card.getByRole("button", { name: `Disconnect ${provider.name}` }).count(), 1);
      const setup = page.locator(".social-setup-details");
      if (!(await setup.evaluate(element => element.open))) await setup.locator("summary").click();
      assert.equal((await setup.locator(".social-setup-uri code").innerText()).trim(), provider.url);
      assert.equal(await setup.locator(".social-setup-keys li").count(), provider.keys.length);
      for (const key of provider.keys) {
        const row = setup.locator(".social-setup-keys li").filter({ hasText: key });
        assert.equal(await row.count(), 1);
        assert.match(await row.innerText(), provider.missingKeys?.includes(key) ? /Missing/ : /Set/);
      }
      assert.match(await setup.innerText(), new RegExp(provider.marker));
      const copyButton = setup.getByRole("button", { name: `Copy ${provider.name} redirect URL` });
      await copyButton.click();
      await setup.getByRole("status").getByText("Redirect URL copied.", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__postlyCopiedText), provider.url);
    }
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    await page.unroute("**/api/social/status");
  });

  await check("Channel setup distinguishes an unavailable API from missing provider credentials", async () => {
    await page.route("**/api/social/status", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "API unavailable" }) }));
    await page.locator(".pw-sidebar .pw-new").click();
    await page.locator(".pw-new-popover").getByRole("button", { name: "Connect a New Channel", exact: true }).click();
    await page.getByRole("dialog", { name: "Connect Channel" }).waitFor();
    await page.getByText("Connection status unavailable", { exact: true }).waitFor();
    const setup = page.locator(".social-setup-details");
    assert.equal(await setup.count(), 1);
    if (!(await setup.evaluate(element => element.open))) await setup.locator("summary").click();
    assert.match(await setup.innerText(), /The exact redirect URL is unavailable until Postly’s OAuth setup API responds/);
    assert.match(await setup.innerText(), /INSTAGRAM_CLIENT_ID/);
    assert.match(await setup.innerText(), /Not checked/);
    assert.doesNotMatch(await page.locator(".interaction-dialog").innerText(), /Disconnected · Setup required/);
    assert.match(await page.locator(".interaction-dialog").innerText(), /Provider credentials were not checked/);
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    await page.unroute("**/api/social/status");
    errors.splice(0); // The mocked 503 is the intended input for this offline-state check.
  });

  await check("An unreachable OAuth API leaves provider credentials unchecked", async () => {
    await page.route("**/api/social/status", route => route.abort("failed"));
    await page.locator(".pw-sidebar .pw-new").click();
    await page.locator(".pw-new-popover").getByRole("button", { name: "Connect a New Channel", exact: true }).click();
    await page.getByRole("dialog", { name: "Connect Channel" }).getByText("Connection status unavailable", { exact: true }).waitFor();
    assert.match(await page.locator(".interaction-dialog").innerText(), /Could not reach Postly’s local OAuth setup API/);
    const setup = page.locator(".social-setup-details");
    if (!(await setup.evaluate(element => element.open))) await setup.locator("summary").click();
    assert.match(await setup.innerText(), /Not checked/);
    assert.doesNotMatch(await page.locator(".interaction-dialog").innerText(), /Disconnected · Setup required/);
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    await page.unroute("**/api/social/status");
    errors.splice(0); // The aborted request is the intended input for this unreachable-server check.
  });

  await check("Channel setup surfaces a provider account-store error without claiming disconnection", async () => {
    await page.route("**/api/social/status", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providers: {
      instagram: { name: "Instagram", configured: true, connected: null, readyToConnect: false, error: "account_store_unavailable", requiredEnvironmentKeys: ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"], missingEnvironmentKeys: [], redirectUri: "http://localhost:4175/api/social/instagram/callback" },
      tiktok: { name: "TikTok", configured: false, connected: false, readyToConnect: false, requiredEnvironmentKeys: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], missingEnvironmentKeys: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], redirectUri: "http://localhost:4175/api/social/tiktok/callback" },
      youtube: { name: "YouTube", configured: false, connected: false, readyToConnect: false, requiredEnvironmentKeys: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"], missingEnvironmentKeys: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"], redirectUri: "http://localhost:4175/api/social/youtube/callback" },
    } }) }));
    await page.locator(".pw-sidebar .pw-new").click();
    await page.locator(".pw-new-popover").getByRole("button", { name: "Connect a New Channel", exact: true }).click();
    const card = page.locator(".social-connect-card");
    await card.getByRole("status").getByText("Connection status unavailable", { exact: true }).waitFor();
    assert.equal(await card.getByRole("button", { name: "Connect Instagram account" }).count(), 0);
    assert.match(await card.innerText(), /could not read the saved account connection/);
    assert.doesNotMatch(await card.innerText(), /Disconnected/);
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    await page.unroute("**/api/social/status");
  });

  await check("Disconnect errors remain attached to the provider with the last confirmed state", async () => {
    await page.route("**/api/social/status", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providers: {
      instagram: { name: "Instagram", configured: true, connected: true, readyToConnect: false, profile: "studio.ig", requiredEnvironmentKeys: ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"], missingEnvironmentKeys: [], redirectUri: "http://localhost:4175/api/social/instagram/callback" },
      tiktok: { name: "TikTok", configured: false, connected: false, readyToConnect: false, requiredEnvironmentKeys: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], missingEnvironmentKeys: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], redirectUri: "http://localhost:4175/api/social/tiktok/callback" },
      youtube: { name: "YouTube", configured: false, connected: false, readyToConnect: false, requiredEnvironmentKeys: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"], missingEnvironmentKeys: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"], redirectUri: "http://localhost:4175/api/social/youtube/callback" },
    } }) }));
    await page.route("**/api/social/instagram/disconnect", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "disconnect unavailable" }) }));
    await page.locator(".pw-sidebar .pw-new").click();
    await page.locator(".pw-new-popover").getByRole("button", { name: "Connect a New Channel", exact: true }).click();
    const card = page.locator(".social-connect-card");
    await card.getByRole("button", { name: "Disconnect Instagram", exact: true }).click();
    await card.getByRole("alert").getByText(/Postly could not disconnect Instagram/).waitFor();
    await card.getByRole("status").getByText("Connected as studio.ig", { exact: true }).waitFor();
    await page.getByRole("button", { name: "TikTok", exact: true }).click();
    assert.equal(await page.locator(".social-connect-card").getByRole("alert").count(), 0);
    assert.match(await page.locator(".social-connect-card").innerText(), /Disconnected · Setup required/);
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    await page.unroute("**/api/social/instagram/disconnect");
    await page.unroute("**/api/social/status");
    errors.splice(0); // The mocked disconnect failure is the intended input for this provider-action error check.
  });

  await check("Publish Channels filter opens and applies its selection", async () => {
    await page.goto(`${baseUrl}/schedule`, { waitUntil: "networkidle" });
    const channelFilter = page.locator(".pw-filter-row").getByRole("button", { name: /Channels/ }).first();
    await channelFilter.click();
    await visible(".pw-filter-popover");
    assert.match(await page.locator(".pw-filter-popover").innerText(), /Instagram|TikTok|YouTube/);
    const instagram = page.locator(".pw-filter-popover").getByLabel("Instagram", { exact: true });
    await instagram.uncheck();
    await page.locator(".pw-filter-popover").getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(await instagram.count(), 0);
  });

  await check("Mobile navigation opens, dismisses, and navigates", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/home`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await visible(".pw-mobile-menu");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".pw-mobile-menu").count(), 0);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page.locator(".pw-mobile-menu nav").getByRole("link", { name: "Publish", exact: false }).click();
    await page.waitForURL("**/schedule");
    assert.equal(await page.locator(".pw-mobile-menu").count(), 0);
  });

  assert.deepEqual(errors, []);
  console.log(`SUCCESS ${checks.length} workspace menu checks`);
} finally {
  await browser.close();
}
