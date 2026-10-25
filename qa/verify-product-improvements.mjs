import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Africa/Johannesburg' });
const page = await context.newPage();
page.setDefaultTimeout(7_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const checks = [];
const check = async (name, run) => { await run(); checks.push(name); console.log(`PASS ${name}`); };
const button = name => page.getByRole('button', { name, exact: true });
const posts = () => page.evaluate(() => JSON.parse(localStorage.getItem('buffer-posts')));
const statusCounts = () => page.locator('.pw-publish-status-tabs button').evaluateAll(buttons => buttons.map(item => [item.firstChild.textContent.trim(), item.querySelector('small')?.textContent.trim()]));
const ready = async () => { await page.locator('.pw-main').waitFor(); };
const go = async route => { await page.goto(`http://localhost:4174${route}`, { waitUntil: 'networkidle' }); await ready(); };
const outputDir = resolve(process.env.POSTLY_QA_OUTPUT_DIR || fileURLToPath(new URL('./current/improvements/', import.meta.url)));
const screenshot = name => `${outputDir}/${name}.png`;
mkdirSync(outputDir, { recursive: true });
const commentItems = [
  { id: 'ig-1', provider: 'instagram', postId: 'ig-post', author: 'Mina', text: 'Loved this behind the scenes look!', postText: 'A week in the studio', createdAt: new Date().toISOString(), replies: [] },
  { id: 'yt-1', provider: 'youtube', postId: 'yt-video', author: 'Jordan', text: 'When is your next tutorial?', postText: 'New creative tools', createdAt: new Date(Date.now() - 3600000).toISOString(), replies: [] },
];
const mentions = [{ id: 'mention-1', provider: 'instagram', postId: 'mentioned-post', author: 'Ellie', text: '@postly.studio loved the workshop', postText: 'Weekend workshop', createdAt: new Date().toISOString(), replies: [] }];
let mediaId;
try {
  await page.route('**/api/social/status', route => route.fulfill({ json: { providers: {
    instagram: { name: 'Instagram', connected: true, configured: true, profile: 'postly.studio', scopes: ['instagram_business_manage_comments'] },
    youtube: { name: 'YouTube', connected: true, configured: true, profile: 'Studio videos', scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'] },
    tiktok: { name: 'TikTok', connected: false, configured: false, profile: '' },
  } } }));
  await page.route('**/api/social/community**', route => route.fulfill({ json: { items: new URL(route.request().url()).searchParams.get('kind') === 'mentions' ? mentions : commentItems, errors: [], unavailable: [] } }));
  await page.route('**/api/social/insights**', route => route.fulfill({ json: { accounts: [{ provider: 'instagram', name: 'postly.studio', summary: { followers: 1520, reactions: 142, comments: 21, views: 16300, posts: 12, engagement: 9.34 } }], posts: [], errors: [] } }));
  await page.route('**/api/social/instagram/comments/ig-1/reply', route => {
    assert.equal(route.request().postDataJSON().text, 'Thank you, Mina!');
    return route.fulfill({ status: 201, json: { reply: { id: 'reply-1', text: 'Thank you, Mina!' } } });
  });
  await page.route('**/api/social/tiktok/publish-status**', route => route.fulfill({ json: { status: 'published', providerStatus: 'PUBLISH_COMPLETE' } }));
  await go('/schedule');
  mediaId = await page.evaluate(async () => {
    localStorage.clear();
    const { saveMedia } = await import('/src/local-data.js');
    const pixel = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7iUAAAAASUVORK5CYII='), char => char.charCodeAt(0));
    const attachment = await saveMedia(new File([pixel], 'studio-cover.png', { type: 'image/png' }));
    const make = (id, text, days, channels, status = 'scheduled') => ({ id, text, channels, status, attachments: [], files: [], scheduleAt: new Date(Date.now() + days * 86400000).toISOString(), createdAt: new Date(Date.now() - (4 - days) * 3600000).toISOString(), scheduleMode: 'Date & Time', dateTimeSet: true });
    localStorage.setItem('buffer-posts', JSON.stringify([
      { ...make('q1', 'Studio launch: the process behind the work', 1, [0]), updatedAt: new Date(Date.now() - 3600000).toISOString(), attachments: [attachment], files: [attachment.name], productTags: 'launch, studio' },
      { ...make('q2', 'A quick studio update', -1, [1]), updatedAt: new Date(Date.now() - 7200000).toISOString() },
      { ...make('q3', 'New tutorial this Friday', 2, [2]), updatedAt: new Date(Date.now() - 10800000).toISOString(), productTags: 'education' },
      make('draft', 'An idea for next month', 3, [0], 'draft'),
      { ...make('sent', 'Our first public video', -2, [2], 'published'), publishResults: [{ provider: 'youtube', status: 'published', remoteId: 'video-1' }] },
      { ...make('pending', 'A video being processed', 0, [1], 'publishing'), publishResults: [{ provider: 'tiktok', status: 'publishing', publishId: 'publish-1' }] },
    ]));
    return attachment.id;
  });
  await page.reload({ waitUntil: 'networkidle' });

  await check('Queue, Drafts, and Sent counts derive from the persisted records after navigation and refresh', async () => {
    assert.deepEqual(await statusCounts(), [['Queue', '3'], ['Drafts', '1'], ['Approvals', '0'], ['Sent', '2']]);
    await go('/schedule/drafts');
    assert.equal(await page.locator('.pw-post-list .pw-real-post').count(), 1);
    await page.reload({ waitUntil: 'networkidle' });
    assert.deepEqual(await statusCounts(), [['Queue', '3'], ['Drafts', '1'], ['Approvals', '0'], ['Sent', '2']]);
    await go('/schedule/sent');
    assert.equal(await page.locator('.pw-post-list .pw-real-post').count(), 2);
    await go('/schedule');
  });

  await check('Queue search includes media and tags; sorting and overdue filters work', async () => {
    assert.equal(await page.locator('.pw-post-list .pw-real-post').count(), 3);
    await page.getByRole('textbox', { name: 'Search posts', exact: true }).fill('STUDIO-COVER');
    assert.equal(await page.locator('.pw-post-list .pw-real-post').count(), 1);
    await page.getByRole('textbox', { name: 'Search posts', exact: true }).fill('tutorial education');
    assert.equal(await page.locator('.pw-post-list .pw-real-post').count(), 1);
    await button('Clear search').click();
    await page.getByLabel('Sort posts').selectOption('newest');
    assert.match(await page.locator('.pw-post-list .pw-real-post').first().innerText(), /New tutorial/);
    await page.getByLabel('Sort posts').selectOption('updated');
    assert.match(await page.locator('.pw-post-list .pw-real-post').first().innerText(), /Studio launch/);
    await page.getByLabel('Sort posts').selectOption('default');
    await button('Show overdue').click();
    assert.equal(await page.locator('.pw-post-list .pw-real-post').count(), 1);
    assert.match(await page.locator('.pw-record-status').innerText(), /Past scheduled time/);
    await button('Show all').click();
  });

  await check('Editing a queued post keeps its saved media and schedule across refresh', async () => {
    const card = page.locator('.pw-real-post').filter({ hasText: 'Studio launch: the process behind the work' });
    const scheduleAt = (await posts()).find(post => post.id === 'q1').scheduleAt;
    await card.getByRole('button', { name: 'Edit post' }).click();
    await page.locator("textarea[aria-label='composer textbox']").fill('Updated studio launch: the process behind the work');
    await button('Customize').click();
    await button('Add to local queue').click();
    await page.locator('.composer-modal').waitFor({ state: 'detached' });
    const updated = (await posts()).find(post => post.id === 'q1');
    assert.match(updated.text, /^Updated studio launch/);
    assert.ok(Math.abs(Date.parse(updated.scheduleAt) - Date.parse(scheduleAt)) < 60_000);
    assert.deepEqual(updated.attachments.map(item => item.id), [mediaId]);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.pw-real-post').filter({ hasText: 'Updated studio launch' }).locator('.pw-record-media img').waitFor();
  });

  await check('Selection drops hidden posts; bulk move updates counts and Undo survives navigation', async () => {
    await button('Select posts').click();
    await page.getByRole('checkbox', { name: 'Select all visible posts' }).check();
    await page.getByRole('textbox', { name: 'Search posts', exact: true }).fill('Updated studio launch');
    assert.match(await page.locator('.pw-bulk-bar').innerText(), /1 selected/);
    await button('Clear search').click();
    assert.match(await page.locator('.pw-bulk-bar').innerText(), /1 selected/);
    await page.getByRole('checkbox', { name: 'Select post: New tutorial this Friday', exact: true }).check();
    await page.screenshot({ path: screenshot('04-queue-after'), animations: 'disabled' });
    await button('Move to drafts').click();
    assert.equal((await posts()).filter(post => post.status === 'scheduled').length, 1);
    assert.equal((await posts()).filter(post => post.status === 'draft').length, 3);
    assert.deepEqual(await statusCounts(), [['Queue', '1'], ['Drafts', '3'], ['Approvals', '0'], ['Sent', '2']]);
    await go('/schedule/drafts');
    assert.equal(await page.locator('.pw-post-list .pw-real-post').count(), 3);
    await button('Undo').click();
    assert.equal((await posts()).filter(post => post.status === 'scheduled').length, 3);
    assert.equal((await posts()).filter(post => post.status === 'draft').length, 1);
  });

  await check('Deletion confirms first and Undo restores attached media after refresh', async () => {
    await go('/schedule');
    await button('Select posts').click();
    await page.getByRole('checkbox', { name: 'Select all visible posts' }).check();
    await page.locator('.pw-bulk-bar').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog', { name: 'Delete 3 posts?' }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal((await posts()).filter(post => post.status === 'scheduled').length, 3);
    await page.locator('.pw-bulk-bar').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete 3 posts', exact: true }).click();
    assert.equal((await posts()).filter(post => post.status === 'scheduled').length, 0);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(async id => Boolean(await (await import('/src/local-data.js')).readMedia(id)), mediaId), true);
    await button('Undo').click();
    assert.equal((await posts()).filter(post => post.status === 'scheduled').length, 3);
    await page.locator('.pw-record-media img').waitFor();
    assert.ok(await page.locator('.pw-record-media img').evaluate(img => img.complete && img.naturalWidth > 0));
  });

  await check('Sent includes processing posts; checking status works; copies have no old publish result', async () => {
    await go('/schedule/sent');
    assert.equal(await page.locator('.pw-post-list .pw-real-post').count(), 2);
    await button('Check status').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('buffer-posts')).find(post => post.id === 'pending').status === 'published');
    const sentCard = page.locator('.pw-real-post').filter({ hasText: 'Our first public video' });
    await sentCard.getByRole('button', { name: 'Duplicate post to drafts' }).click();
    const copied = (await posts()).find(post => !['q1','q2','q3','draft','sent','pending'].includes(post.id));
    assert.equal(copied.status, 'draft');
    assert.deepEqual(copied.publishResults, []);
    assert.equal(copied.scheduleAt, null);
    await button('Undo').click();
    assert.equal((await posts()).length, 6);
  });

  await check('Channel checkboxes represent all, individual, and empty selections accurately', async () => {
    await go('/schedule');
    await page.locator('.pw-publish-tabs .pw-filter-row').getByRole('button', { name: /Channels/ }).click();
    const filters = page.locator('.pw-filter-popover');
    for (const name of ['Instagram', 'TikTok', 'YouTube']) assert.ok(await filters.getByLabel(name, { exact: true }).isChecked());
    for (const name of ['TikTok', 'YouTube']) await filters.getByLabel(name, { exact: true }).uncheck();
    await filters.getByRole('button', { name: 'Done', exact: true }).click();
    assert.deepEqual(await statusCounts(), [['Queue', '1'], ['Drafts', '1'], ['Approvals', '0'], ['Sent', '0']]);
    await page.locator('.pw-publish-tabs .pw-filter-row').getByRole('button', { name: /Channels/ }).click();
    const none = page.locator('.pw-filter-popover');
    await none.getByLabel('Instagram', { exact: true }).uncheck();
    await none.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.locator('.pw-post-list .pw-real-post').count(), 0);
    await button('Clear filters').click();
    assert.equal(await page.locator('.pw-post-list .pw-real-post').count(), 3);
  });

  await check('Menus close on Escape, outside clicks, and focus changes; only one stays open', async () => {
    await go('/insights');
    const tools = page.locator('.pw-insight-toolbar > .pw-filter-row');
    const exportButton = tools.getByRole('button', { name: 'Export', exact: true });
    await exportButton.focus();
    await page.keyboard.press('ArrowDown');
    assert.ok(await button('Download CSV').evaluate(el => el === document.activeElement));
    await page.keyboard.press('Escape');
    assert.equal(await button('Download CSV').count(), 0);
    assert.ok(await exportButton.evaluate(el => el === document.activeElement));
    await exportButton.click();
    await tools.getByRole('button', { name: 'Channels', exact: true }).click();
    assert.equal(await page.locator('.pw-disclosure-panel').count(), 1);
    await page.getByRole('heading', { name: 'Summary', exact: true }).click();
    assert.equal(await page.locator('.pw-disclosure-panel').count(), 0);
    await exportButton.click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.pw-disclosure-panel').count(), 0);
    await exportButton.click();
    const bounds = await page.locator('.pw-export-popover').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1440);
    await page.screenshot({ path: screenshot('06-menu-after'), animations: 'disabled' });
    await page.keyboard.press('Escape');
  });

  await check('Inbox search, resolution, mobile tab navigation, replies, and Back work', async () => {
    await go('/community/posts');
    await page.getByRole('textbox', { name: 'Search inbox' }).fill('Jordan');
    assert.equal(await page.locator('.pw-community-list-item').count(), 1);
    await button('Clear inbox search').click();
    await button('Resolve selected conversation').click();
    await button('Reopen selected conversation').waitFor();
    await button('Reopen selected conversation').click();
    await button('Resolve selected conversation').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await button('Mentions').click();
    await page.locator('.pw-community-list-item').filter({ hasText: 'Weekend workshop' }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await button('Mentions').getAttribute('aria-pressed'), 'true');
    await button('Comments').click();
    await page.locator('.pw-community-list-item').filter({ hasText: 'A week in the studio' }).click();
    await button('Back to inbox').waitFor();
    assert.equal(await page.locator('.pw-community-posts').isVisible(), false);
    await page.getByRole('textbox', { name: 'Reply to Mina' }).fill('Thank you, Mina!');
    await button('Reply').click();
    await page.locator('.pw-community-reply').filter({ hasText: 'Thank you, Mina!' }).waitFor();
    await page.screenshot({ path: screenshot('05-inbox-mobile-after'), animations: 'disabled' });
    await button('Back to inbox').click();
    assert.equal(await page.locator('.pw-community-posts').isVisible(), true);
    assert.ok(await page.locator('.pw-community-list-item.selected').evaluate(el => el === document.activeElement));
  });

  await check('Changed surfaces and open menus fit desktop, tablet, and phone in both themes', async () => {
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['/schedule', '/community/posts', '/insights']) {
        await go(route);
        if (route === '/schedule') {
          await button('Select posts').click();
          await page.getByRole('checkbox', { name: 'Select all visible posts' }).check();
        }
        if (route === '/insights') {
          await (width <= 650 ? button('Export insights') : page.locator('.pw-insight-toolbar > .pw-filter-row').getByRole('button', { name: 'Export', exact: true })).click();
        }
        const size = await page.evaluate(() => ({ width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), viewport: innerWidth }));
        assert.ok(size.width <= size.viewport, `${route} overflows at ${width}: ${size.width}`);
      }
    }
    await page.evaluate(() => localStorage.setItem('postly-preferences', JSON.stringify({ Appearance: 'Dark', Timezone: 'Johannesburg' })));
    await go('/schedule');
    await button('Select posts').click();
    await page.getByRole('checkbox', { name: 'Select all visible posts' }).check();
    await page.screenshot({ path: screenshot('07-queue-dark-after'), animations: 'disabled' });
  });
  assert.deepEqual(errors, []);
  console.log(`SUCCESS ${checks.length} product improvement workflows`);
} finally {
  await context.close();
  await browser.close();
}
