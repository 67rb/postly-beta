import assert from "node:assert/strict";
import { copyText } from "../src/local-data.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || "playwright");
const checks = [];
const check = async (name, run) => { await run(); checks.push(name); console.log(`PASS ${name}`); };

await check("Copy helper prefers the secure Clipboard API", async () => {
  let value = "";
  const copied = await copyText("Postly link", { navigatorObject: { clipboard: { writeText: async text => { value = text; } } }, documentObject: null });
  assert.equal(copied, true);
  assert.equal(value, "Postly link");
});

await check("Copy helper falls back when clipboard permission is denied", async () => {
  let appended;
  let removed = false;
  const field = { style: {}, value: "", setAttribute() {}, focus() {}, select() {}, setSelectionRange() {}, remove() { removed = true; } };
  const documentObject = {
    body: { appendChild(element) { appended = element; } },
    activeElement: null,
    createElement(tag) { assert.equal(tag, "textarea"); return field; },
    execCommand(command) { assert.equal(command, "copy"); return true; },
  };
  const copied = await copyText("Fallback link", { navigatorObject: { clipboard: { writeText: async () => { throw new Error("permission denied"); } } }, documentObject });
  assert.equal(copied, true);
  assert.equal(appended, field);
  assert.equal(field.value, "Fallback link");
  assert.equal(removed, true);
});

await check("Copy helper reports when the browser offers no clipboard", async () => {
  assert.equal(await copyText("Unavailable", { navigatorObject: {}, documentObject: null }), false);
  assert.equal(await copyText("", { navigatorObject: {}, documentObject: null }), false);
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("http://localhost:4174/start-page", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await check("Start Page creates and saves a title and introduction", async () => {
    await page.getByRole("button", { name: "New Start Page" }).click();
    await page.getByLabel("Page title").fill("Field Notes");
    await page.getByLabel("Introduction").fill("Small observations from the studio.");
    await page.getByLabel("Social links").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "HTTPS" }).waitFor();
    await page.getByLabel("Social links").fill("https://instagram.com/postly.studio\nhttps://youtube.com/@postly");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(/\/start-page\//);
    await page.getByRole("heading", { name: "Field Notes", exact: true }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Field Notes", exact: true }).waitFor();
    const pages = await page.evaluate(() => JSON.parse(localStorage.getItem("postly-start-pages")) || []);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].links.length, 2);
  });

  let shareUrl = "";
  await check("Copy share link produces a self-contained local preview URL", async () => {
    await page.getByRole("button", { name: "Copy share link" }).click();
    await page.getByRole("status").getByText("Share link copied").waitFor();
    shareUrl = await page.evaluate(() => navigator.clipboard.readText());
    const url = new URL(shareUrl);
    assert.equal(url.origin, "http://localhost:4174");
    assert.match(url.pathname, /^\/start-page\//);
    assert.deepEqual(JSON.parse(url.searchParams.get("share")), {
      title: "Field Notes",
      description: "Small observations from the studio.",
      links: [
        { label: "instagram.com", url: "https://instagram.com/postly.studio" },
        { label: "youtube.com", url: "https://youtube.com/@postly" },
      ],
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth), true);
    await page.screenshot({ path: "qa/current/postly-start-page-owner-390x844.png" });
    await page.getByRole("button", { name: "Copy share link" }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), shareUrl);
  });

  await check("Shared Start Page opens without local saved data or the workspace shell", async () => {
    const recipientContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const recipient = await recipientContext.newPage();
    const recipientErrors = [];
    recipient.on("pageerror", error => recipientErrors.push(error.message));
    await recipient.goto(shareUrl, { waitUntil: "networkidle" });
    assert.equal(await recipient.getByRole("heading", { name: "Field Notes", exact: true }).count(), 1);
    assert.equal(await recipient.getByText("Small observations from the studio.").count(), 1);
    assert.equal(await recipient.getByRole("navigation", { name: "Social links" }).getByRole("link").count(), 2);
    assert.equal(await recipient.getByRole("link", { name: "instagram.com", exact: true }).getAttribute("href"), "https://instagram.com/postly.studio");
    assert.equal(await recipient.getByRole("link", { name: "youtube.com", exact: true }).getAttribute("target"), "_blank");
    assert.equal(await recipient.locator(".pw-sidebar").count(), 0);
    for (const width of [320, 390, 768, 1440]) {
      await recipient.setViewportSize({ width, height: 844 });
      assert.equal(await recipient.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth), true, `shared page overflows at ${width}px`);
    }
    await recipient.setViewportSize({ width: 390, height: 844 });
    await recipient.screenshot({ path: "qa/current/postly-start-page-shared-390x844.png" });
    assert.deepEqual(recipientErrors, []);
    await recipientContext.close();
  });

  await check("Untrusted share text renders as text, not markup", async () => {
    const payload = encodeURIComponent(JSON.stringify({ title: "<script>unsafe</script>", description: "<img src=x onerror=alert(1)>" }));
    await page.goto(`http://localhost:4174/start-page/shared?share=${payload}`, { waitUntil: "networkidle" });
    assert.equal(await page.locator(".pw-public-start-card img, .pw-public-start-card script").count(), 0);
    assert.equal(await page.getByRole("heading", { name: "<script>unsafe</script>", exact: true }).count(), 1);
  });

  assert.deepEqual(pageErrors, []);
} finally {
  await browser.close();
}

console.log(`SUCCESS ${checks.length} copy and Start Page checks`);
