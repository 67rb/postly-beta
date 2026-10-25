import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: "Africa/Johannesburg" });
page.setDefaultTimeout(8_000);
const errors = [];
const checks = [];
page.on("pageerror", error => errors.push(error.message));
const run = async (name, fn) => { await fn(); checks.push(name); console.log(`PASS ${name}`); };

try {
  await page.goto("http://localhost:4174/create/ideas", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await run("Starter ideas match the source board and use the local Postly illustration asset", async () => {
    assert.equal(await page.locator(".pw-idea-title").count(), 2);
    assert.match(await page.locator(".pw-idea-title").first().innerText(), /This is a place to plan/);
    assert.match(await page.locator(".pw-idea-title").nth(1).innerText(), /Save inspirations you find online/);
    assert.equal(await page.getByRole("button", { name: "Add idea column" }).count(), 1);
    const art = page.locator(".pw-idea-art");
    await art.waitFor({ state: "visible" });
    assert.equal(await art.evaluate(image => image.complete && image.naturalWidth > 0), true);
    await page.screenshot({ path: "qa/current/postly-create-ideas-1440x900.png", fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: "qa/current/postly-create-ideas-390x844.png", fullPage: false });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await run("Compact Ideas search opens, filters results, and closes with Escape", async () => {
    const trigger = page.getByRole("button", { name: "Search ideas", exact: true });
    await trigger.click();
    await page.getByRole("textbox", { name: "Search ideas", exact: true }).fill("inspiration");
    assert.equal(await page.locator(".pw-idea-title").count(), 1);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".pw-ideas-search-panel").count(), 0);
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  });

  await run("A new board column saves, blocks duplicates, and survives refresh", async () => {
    await page.getByRole("button", { name: "Add idea column" }).click();
    await page.getByLabel("Column name").fill("Research");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    assert.equal(await page.locator(".pw-ideas-grid h3").filter({ hasText: "Research" }).count(), 1);

    await page.getByRole("button", { name: "Add idea column" }).click();
    await page.getByLabel("Column name").fill("Research");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "already exists" }).waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator(".pw-ideas-grid h3").filter({ hasText: "Research" }).count(), 1);
  });

  await run("Ideas can create tags, assign them, filter, and preserve them after refresh", async () => {
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await page.locator(".pw-ideas-tag-panel").getByRole("button", { name: "Create tag", exact: true }).click();
    await page.getByLabel("Tag name", { exact: true }).fill("Campaign");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("postly-tags") || "[]").includes("Campaign"));

    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await page.locator(".pw-ideas-tag-panel").getByLabel("Campaign", { exact: true }).check();
    await page.locator(".pw-ideas-tag-panel").getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(await page.locator(".pw-idea-title").count(), 0);

    await page.locator(".pw-header-create").getByRole("button", { name: "New Idea", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Tagged campaign idea");
    await page.getByLabel("Notes", { exact: true }).fill("Keep this easy to find.");
    await page.getByLabel("Campaign", { exact: true }).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Tagged campaign idea", exact: true }).count(), 1);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("postly-ideas")).find(idea => idea.title === "Tagged campaign idea").tags), ["Campaign"]);

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await page.locator(".pw-ideas-tag-panel").getByLabel("Campaign", { exact: true }).check();
    await page.locator(".pw-ideas-tag-panel").getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Tagged campaign idea", exact: true }).click();
    assert.equal(await page.getByLabel("Campaign", { exact: true }).isChecked(), true);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Tagged campaign idea", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await page.locator(".pw-ideas-tag-panel").getByRole("button", { name: "Clear selection", exact: true }).click();
    await page.locator(".pw-ideas-tag-panel").getByRole("button", { name: "Done", exact: true }).click();
  });

  await run("Ideas can move into a custom column and retain edits after refresh", async () => {
    await page.getByRole("button", { name: "New idea in Research" }).click();
    await page.getByLabel("Title").fill("A new research idea");
    await page.getByLabel("Notes").fill("Keep this in the custom column.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const customColumn = page.locator(".pw-ideas-grid section").filter({ has: page.locator("h3", { hasText: "Research" }) });
    await customColumn.getByText("A new research idea", { exact: true }).waitFor();

    await page.locator(".pw-idea-title").first().click();
    await page.getByLabel("Title").fill("Edited starter idea persists");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.getByRole("button", { name: "Edited starter idea persists", exact: true }).count(), 1);
    assert.equal(await page.getByText("A new research idea", { exact: true }).count(), 1);
  });

  await run("Malformed idea storage is ignored without crashing the board", async () => {
    await page.evaluate(() => localStorage.setItem("postly-ideas", JSON.stringify([null, 12, { id: "bad", title: 5 }, { id: "ok", title: "Valid row", body: "Safe", stage: "Unassigned" }])));
    await page.evaluate(() => localStorage.setItem("postly-tags", JSON.stringify([null, 12, {}, { title: "Migrated tag" }, "Valid tag"])));
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator(".pw-idea-title").count(), 1);
    assert.equal(await page.getByRole("heading", { name: "Create", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    assert.equal(await page.locator(".pw-ideas-tag-panel label").count(), 2);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("postly-tags"))), ["Migrated tag", "Valid tag"]);
  });

  assert.deepEqual(errors, []);
  console.log(`SUCCESS ${checks.length} Ideas board checks`);
} finally {
  await browser.close();
}
