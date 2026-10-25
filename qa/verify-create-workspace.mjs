import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Africa/Johannesburg" });
const page = await context.newPage();
page.setDefaultTimeout(8_000);
const errors = [];
const checks = [];
page.on("pageerror", error => errors.push(error.message));
const check = async (name, run) => { await run(); checks.push(name); console.log(`PASS ${name}`); };
const waitForLocalValue = key => page.waitForFunction(name => localStorage.getItem(name) !== null, key);

try {
  await page.goto("http://localhost:4174/create/ideas", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await check("Ideas convert to drafts that appear in Publish after refresh", async () => {
    await page.getByRole("button", { name: "Add idea column" }).click();
    await page.getByLabel("Column name").fill("Campaign");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.getByRole("button", { name: "New idea in Campaign" }).click();
    await page.getByLabel("Title", { exact: true }).fill("Build a creator series");
    await page.getByLabel("Notes", { exact: true }).fill("Show one useful production lesson each week.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await waitForLocalValue("postly-ideas");

    await page.getByRole("button", { name: "Idea actions for Build a creator series" }).click();
    await page.getByRole("button", { name: "Convert to post" }).click();
    const composer = page.getByRole("dialog", { name: "Create Post" });
    await composer.waitFor();
    const editor = composer.getByRole("textbox", { name: "composer textbox" });
    assert.equal(await editor.inputValue(), "Build a creator series\n\nShow one useful production lesson each week.");
    await composer.getByRole("button", { name: "Save Draft" }).click();
    await waitForLocalValue("buffer-posts");

    let records = await page.evaluate(() => JSON.parse(localStorage.getItem("buffer-posts")) || []);
    const draft = records.find(record => record.text.startsWith("Build a creator series"));
    assert.equal(draft?.status, "draft");
    assert.equal(draft?.text, "Build a creator series\n\nShow one useful production lesson each week.");

    await page.goto("http://localhost:4174/schedule/drafts", { waitUntil: "networkidle" });
    await page.getByText("Build a creator series", { exact: false }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Build a creator series", { exact: false }).waitFor();
    records = await page.evaluate(() => JSON.parse(localStorage.getItem("buffer-posts")) || []);
    assert.equal(records.filter(record => record.status === "draft").length, 1);

    await page.goto("http://localhost:4174/create/ideas", { waitUntil: "networkidle" });
    const campaign = page.locator(".pw-ideas-grid section").filter({ has: page.getByRole("heading", { name: "Campaign" }) });
    await campaign.getByRole("button", { name: "Build a creator series", exact: true }).waitFor();
    const savedIdea = await page.evaluate(() => JSON.parse(localStorage.getItem("postly-ideas")).find(item => item.title === "Build a creator series"));
    assert.equal(savedIdea.stage, "Campaign");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("postly-idea-stages")).includes("Campaign")), true);
  });

  await check("Personal templates save, edit, use as a draft, delete, and persist", async () => {
    await page.goto("http://localhost:4174/create/templates", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New Template", exact: true }).click();
    await page.getByLabel("Template name").fill("Creator series template");
    await page.getByLabel("Post content").fill("Original template text.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await waitForLocalValue("postly-templates");
    await page.getByRole("button", { name: /Personal/ }).click();
    await page.getByText("Creator series template", { exact: true }).waitFor();

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Personal/ }).click();
    await page.getByText("Creator series template", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Edit template Creator series template" }).click();
    await page.getByLabel("Post content").fill("Updated template text.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await waitForLocalValue("postly-templates");

    const card = page.locator(".pw-template-card").filter({ hasText: "Creator series template" });
    await card.getByRole("button", { name: "Use template" }).click();
    const composer = page.getByRole("dialog", { name: "Create Post" });
    const editor = composer.getByRole("textbox", { name: "composer textbox" });
    await composer.waitFor();
    assert.equal(await editor.inputValue(), "Creator series template\n\nUpdated template text.");
    await composer.getByRole("button", { name: "Save Draft" }).click();
    await waitForLocalValue("buffer-posts");

    const records = await page.evaluate(() => JSON.parse(localStorage.getItem("buffer-posts")) || []);
    assert.equal(records.some(record => record.status === "draft" && record.text === "Creator series template\n\nUpdated template text."), true);
    await page.goto("http://localhost:4174/schedule/drafts", { waitUntil: "networkidle" });
    await page.getByText("Creator series template", { exact: false }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Creator series template", { exact: false }).waitFor();

    await page.goto("http://localhost:4174/create/templates", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Personal/ }).click();
    await page.getByText("Updated template text.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Delete template Creator series template" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await waitForLocalValue("postly-templates");
    assert.equal(await page.getByText("Creator series template", { exact: true }).count(), 0);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Personal/ }).click();
    assert.equal(await page.getByText("Creator series template", { exact: true }).count(), 0);
  });

  await check("Feeds validate URLs and preserve add, open, curated, and remove actions", async () => {
    await page.goto("http://localhost:4174/create/feeds", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New Feed", exact: true }).click();
    await page.getByLabel("Feed name").fill("Postly QA Source");
    await page.getByLabel("Feed URL").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "full feed URL" }).waitFor();

    await page.getByLabel("Feed URL").fill("https://example.test/rss.xml");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Postly QA Source", { exact: true }).waitFor();
    await waitForLocalValue("postly-feeds");
    const openSource = page.locator(".pw-setting-channel").filter({ hasText: "Postly QA Source" }).getByRole("link", { name: "Open source ↗" });
    assert.equal(await openSource.getAttribute("href"), "https://example.test/rss.xml");
    assert.equal(await openSource.getAttribute("target"), "_blank");

    await page.getByRole("button", { name: "Explore Curated Feeds" }).click();
    const curated = page.locator(".pw-modal-options > div").filter({ hasText: "Creator Science" });
    await curated.getByRole("button", { name: "Add feed" }).click();
    let feeds = await page.evaluate(() => JSON.parse(localStorage.getItem("postly-feeds")) || []);
    assert.equal(feeds.some(feed => feed.title === "Creator Science" && feed.url === "https://creatorscience.com/"), true);
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Postly QA Source", { exact: true }).waitFor();
    await page.getByText("Creator Science", { exact: true }).waitFor();

    await page.locator(".pw-setting-channel").filter({ hasText: "Postly QA Source" }).getByRole("button", { name: "Remove" }).click();
    await waitForLocalValue("postly-feeds");
    feeds = await page.evaluate(() => JSON.parse(localStorage.getItem("postly-feeds")) || []);
    assert.equal(feeds.some(feed => feed.title === "Postly QA Source"), false);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.getByText("Postly QA Source", { exact: true }).count(), 0);
    await page.locator(".pw-setting-channel").filter({ hasText: "Creator Science" }).getByRole("button", { name: "Remove" }).click();
  });

  await check("Ideas, templates, and feeds remain usable at mobile widths", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("http://localhost:4174/create/ideas", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Gallery view" }).click();
    assert.equal(await page.locator(".pw-ideas-grid.gallery").count(), 1);
    await page.getByRole("button", { name: "Board view" }).click();
    await page.locator(".pw-header-create").getByRole("button", { name: "New Idea", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Mobile workspace idea");
    await page.getByLabel("Notes", { exact: true }).fill("Created on a narrow viewport.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Mobile workspace idea", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: "qa/current/postly-create-ideas-390x844.png" });

    await page.goto("http://localhost:4174/create/templates", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Discover/ }).click();
    await page.getByRole("textbox", { name: "Search templates" }).fill("earlier self");
    await page.getByRole("button", { name: "Use template" }).click();
    const composer = page.getByRole("dialog", { name: "Create Post" });
    await composer.waitFor();
    await composer.getByRole("button", { name: "Save Draft" }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.goto("http://localhost:4174/create/feeds", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Explore Curated Feeds" }).click();
    await page.locator(".pw-modal-options > div").filter({ hasText: "Creator Science" }).getByRole("button", { name: "Add feed" }).click();
    await page.getByRole("button", { name: "Close dialog" }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: "qa/current/postly-create-feeds-390x844.png" });

    await page.setViewportSize({ width: 320, height: 780 });
    for (const route of ["/create/ideas", "/create/templates", "/create/feeds"]) {
      await page.goto(`http://localhost:4174${route}`, { waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} overflows at 320px`);
    }
  });

  assert.deepEqual(errors, []);
  console.log(`SUCCESS ${checks.length} Create workspace workflows`);
} finally {
  await context.close();
  await browser.close();
}
