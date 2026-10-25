import assert from "node:assert/strict";
import {
  formatCalendarHour,
  formatInTimezone,
  formatScheduleTime,
  nextAvailableSlot,
  parseScheduleTime,
  scheduledDateInTimezone,
} from "../src/local-data.js";

const springDay = new Date(2027, 2, 14);
const fallDay = new Date(2026, 10, 1);
assert.deepEqual(parseScheduleTime("9:15 PM"), { hour: 21, minute: 15 });
assert.deepEqual(parseScheduleTime("00:00"), { hour: 0, minute: 0 });
assert.equal(parseScheduleTime("24:00"), null);
assert.equal(formatScheduleTime("00:00"), "12:00 AM");
assert.equal(formatScheduleTime("9:15 PM", "24-hour"), "21:15");
assert.equal(formatCalendarHour(0, "24-hour"), "00");
assert.equal(formatCalendarHour(13), "1 PM");

assert.equal(scheduledDateInTimezone(springDay, "2:30 AM", "America/New_York"), null);
assert.equal(scheduledDateInTimezone(springDay, "3:30 AM", "America/New_York")?.toISOString(), "2027-03-14T07:30:00.000Z");
const repeatedFallTime = scheduledDateInTimezone(fallDay, "1:30 AM", "America/New_York");
assert.equal(repeatedFallTime?.toISOString(), "2026-11-01T05:30:00.000Z", "the repeated wall time resolves to its earlier occurrence");
assert.equal(formatInTimezone(repeatedFallTime, { hour: "numeric", minute: "2-digit", hourCycle: "h23" }, "America/New_York"), "01:30");
assert.equal(formatInTimezone(repeatedFallTime, { hour: "numeric", minute: "2-digit", hourCycle: "h12" }, "America/New_York"), "1:30 AM");

const realNow = Date.now;
Date.now = () => Date.parse("2027-03-14T06:00:00.000Z");
let nextNewYorkSlot;
try {
  nextNewYorkSlot = nextAvailableSlot([{
    timezone: "America/New_York",
    days: [{ day: "Sunday", enabled: true, times: ["2:30 AM", "3:30 AM"] }],
  }]);
} finally {
  Date.now = realNow;
}
assert.equal(nextNewYorkSlot?.toISOString(), "2027-03-14T07:30:00.000Z", "Next Available skips the nonexistent spring-forward slot");

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  timezoneId: "America/Los_Angeles",
});
const page = await context.newPage();
await page.clock.install({ time: new Date("2026-10-24T12:00:00.000Z") });
page.setDefaultTimeout(6_000);
const errors = [];
page.on("pageerror", error => errors.push(`page: ${error.message}`));
page.on("console", message => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
page.on("response", response => { if (response.status() >= 400 && new URL(response.url()).origin === "http://localhost:4174") errors.push(`http ${response.status()}: ${response.url()}`); });

const base = "http://localhost:4174";
const instagramId = "6abbdc0fea19ca0bde244c7e";
const channelIds = [instagramId, "6abbdb9eea19ca0bde244939", "6abbdadbea19ca0bde24433e"];
const channelNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const preferences = {
  Timezone: "America/New_York",
  "Time Format": "24-hour",
  "Start of Week": "Monday",
  "Default Posting Action": "Set Date and Time",
};
const records = [
  {
    id: "qa-calendar-fall-back-early",
    text: "Fall-back event",
    status: "scheduled",
    scheduleAt: "2026-11-01T05:30:00.000Z",
    selectedTime: "1:30 AM",
    timezone: "America/New_York",
    dateTimeSet: true,
    channels: [0],
    files: [],
    attachments: [],
    createdAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "qa-calendar-channel-filter",
    text: "Channel filter event",
    status: "scheduled",
    scheduleAt: "2026-11-01T08:15:00.000Z",
    selectedTime: "3:15 AM",
    timezone: "America/New_York",
    dateTimeSet: true,
    channels: [1],
    files: [],
    attachments: [],
    createdAt: "2026-10-01T12:01:00.000Z",
  },
];
const channelSchedule = {
  timezone: "America/New_York",
  days: channelNames.map(day => ({ day, enabled: true, times: ["9:00 AM"] })),
};

try {
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await page.evaluate(({ preferences, records, channelSchedule, instagramId }) => {
    localStorage.clear();
    localStorage.setItem("postly-preferences", JSON.stringify(preferences));
    localStorage.setItem("buffer-posts", JSON.stringify(records));
    localStorage.setItem(`postly-channel-schedule-${instagramId}`, JSON.stringify(channelSchedule));
  }, { preferences, records, channelSchedule, instagramId });

  await page.goto(`${base}/schedule/calendar/month`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Next month" }).click();
  await page.locator(".pw-calendar-head strong").getByText("November 2026").waitFor();
  const channelFilterButton = page.locator(".pw-filter-row button").filter({ hasText: "Channels" });
  await channelFilterButton.click();
  const instagramFilter = page.locator(".pw-filter-popover label").filter({ hasText: "Instagram" }).locator("input");
  await instagramFilter.uncheck();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  assert.deepEqual(await page.locator(".pw-calendar-event").allTextContents(), ["03:15Channel filter event"]);
  await channelFilterButton.click();
  await page.locator(".pw-filter-popover label").filter({ hasText: "Instagram" }).locator("input").check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const eventLabels = await page.locator(".pw-calendar-event").allTextContents();
  assert.deepEqual(eventLabels, ["01:30Fall-back event", "03:15Channel filter event"], "calendar events are chronological in the selected timezone and use 24-hour labels");

  await page.locator(".pw-calendar-event").filter({ hasText: "Fall-back event" }).click();
  await page.locator(".composer-modal").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Choose date and time" }).click();
  assert.match(await page.locator(".timezone-label").innerText(), /America\/New_York/);
  assert.equal(await page.getByRole("textbox", { name: "Select Time" }).inputValue(), "01:30", "editing a calendar event respects the current 24-hour setting");
  await page.getByRole("button", { name: "Close Composer", exact: true }).click();

  await page.goto(`${base}/schedule/calendar/month`, { waitUntil: "networkidle" });
  for (let month = 0; month < 5; month++) await page.getByRole("button", { name: "Next month" }).click();
  await page.locator(".pw-calendar-head strong").getByText("March 2027").waitFor();
  await page.getByLabel("Calendar view").selectOption("Week");
  await page.getByRole("button", { name: "Next week" }).click();
  await page.getByRole("button", { name: "Create post on Sunday, March 14, 2027 at 02" }).click();
  assert.match(await page.getByRole("status").innerText(), /skipped when clocks move forward in America\/New_York/);

  await page.goto(`${base}/channels/${instagramId}/settings`, { waitUntil: "networkidle" });
  assert.equal(await page.getByLabel("Channel schedule timezone").inputValue(), "America/New_York");
  const mondayTimes = page.locator(".pw-schedule-setting").first().locator(".pw-time-slot input");
  assert.equal(await mondayTimes.first().inputValue(), "09:00", "channel slots render in the selected 24-hour display");
  await mondayTimes.first().fill("25:00");
  await mondayTimes.first().blur();
  assert.equal(await mondayTimes.first().getAttribute("aria-invalid"), "true");
  assert.match(await page.getByRole("alert").innerText(), /1 invalid posting time/);
  await mondayTimes.first().fill("13:45");
  await mondayTimes.first().blur();
  assert.equal(await mondayTimes.first().inputValue(), "13:45");
  await page.locator(".pw-schedule-setting").first().locator("button").filter({ hasText: "Add time" }).click();
  assert.equal(await mondayTimes.nth(1).inputValue(), "12:00");
  await page.getByLabel("Channel schedule timezone").selectOption("UTC");
  const persistedSchedule = await page.evaluate(id => JSON.parse(localStorage.getItem(`postly-channel-schedule-${id}`)), instagramId);
  assert.equal(persistedSchedule.timezone, "UTC");
  assert.deepEqual(persistedSchedule.days[0].times, ["13:45", "12:00"]);

  await page.goto(`${base}/settings/preferences`, { waitUntil: "networkidle" });
  await page.getByLabel("Time Format").selectOption("12-hour");
  await page.goto(`${base}/channels/${instagramId}/settings`, { waitUntil: "networkidle" });
  const twelveHourSlots = page.locator(".pw-schedule-setting").first().locator(".pw-time-slot input");
  assert.deepEqual(await twelveHourSlots.evaluateAll(inputs => inputs.map(input => input.value)), ["1:45 PM", "12:00 PM"]);

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["/schedule/calendar/week", "/schedule/calendar/month", `/channels/${instagramId}/settings`]) {
      const response = await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
      assert.equal(response?.status(), 200, `${route} returned ${response?.status()} at ${width}px`);
      const metrics = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      assert.ok(Math.max(metrics.document, metrics.body) <= metrics.viewport, `${route} overflows at ${width}px: ${JSON.stringify(metrics)}`);
    }
  }

  assert.deepEqual(errors, []);
  console.log("PASS calendar/time helper DST, channel slot format and persistence, event opening, filters, and selected timezone behavior");
  console.log("PASS calendar and channel schedule responsiveness at 320, 390, 768, 1024, and 1440px");
} catch (error) {
  if (errors.length) console.error(JSON.stringify({ browserErrors: errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
