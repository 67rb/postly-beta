const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_URL || 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'Africa/Johannesburg'});
page.setDefaultTimeout(6000);
const errors=[], results=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
const button=name=>page.getByRole('button',{name,exact:true});
const editor=()=>page.locator('textarea[aria-label="composer textbox"]');
const open=async()=>{await page.locator('.step-card').nth(1).getByRole('button',{name:'Create Post',exact:true}).click();};
const queue=async()=>{await button('Open menu').click();await page.locator('.side-nav button').filter({hasText:'Publish'}).click();};
const check=async(name,action)=>{await action();results.push(name);console.log('PASS '+name);};
try {
 await page.goto('http://localhost:4174/',{waitUntil:'networkidle'});
 await page.evaluate(()=>localStorage.clear());await page.reload({waitUntil:'networkidle'});
 await check('Unsaved post supports keep editing, discard, and save',async()=>{
  await open();await editor().fill('An unfinished post');await button('Close Composer').click();await page.getByRole('alertdialog',{name:'Unsaved post'}).waitFor();
  await button('Keep Editing').click();assert.equal(await editor().inputValue(),'An unfinished post');
  await page.keyboard.press('Escape');await button('Discard Changes').click();assert.equal(await page.locator('.composer-modal').count(),0);
  await open();assert.equal(await editor().inputValue(),'');await editor().fill('Save from the close dialog');await button('Close Composer').click();await page.locator('.discard-dialog').getByRole('button',{name:'Save Draft',exact:true}).click();assert.equal(await page.locator('.composer-modal').count(),0);
 });
 await check('Image bytes survive saving a draft and a page refresh',async()=>{
  await open();await editor().fill('A persistent media draft');
  await page.locator('#media-upload').setInputFiles({name:'persistent.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBb0AAAAASUVORK5CYII=','base64')});
  await page.locator('.file-list').waitFor();await button('Save Draft').click();await page.reload({waitUntil:'networkidle'});
  await queue();await button('Drafts (2)').click();await page.locator('.saved-post').filter({hasText:'A persistent media draft'}).getByRole('button',{name:'Edit',exact:true}).click();await button('Preview').click();
  await page.locator('.social-preview img').first().waitFor();assert.equal(await page.locator('.social-preview img').first().evaluate(image=>image.complete && image.naturalWidth>0),true);await button('Close Composer').click();
 });
 await check('Invalid and past times are rejected',async()=>{
  await open();await editor().fill('Future post');await button('Choose date and time').click();await page.getByRole('textbox',{name:'Select Time',exact:true}).fill('99:99');assert.equal(await button('Done').isDisabled(),true);assert.match(await page.locator('.date-time-picker [role="alert"]').innerText(),/valid time/);
  await page.getByRole('textbox',{name:'Select Time',exact:true}).fill('12:00 AM');assert.equal(await button('Done').isDisabled(),true);assert.match(await page.locator('.date-time-picker [role="alert"]').innerText(),/future/);
  await button('Next month').click();await page.locator('.calendar-days button:not(.outside-month):not([disabled])').first().click();await page.getByRole('textbox',{name:'Select Time',exact:true}).fill('11:45 AM');await button('Done').click();
 });
 let savedAt;
 await check('Selected schedule date and time restore when editing',async()=>{
  await button('Customize').click();await button('Schedule Posts').click();savedAt=await page.evaluate(()=>JSON.parse(localStorage.getItem('buffer-posts')).find(post=>post.status==='scheduled').scheduleAt);assert.ok(Date.parse(savedAt)>Date.now());
  await button('More post options').click();await page.getByRole('menuitem',{name:'Edit post',exact:true}).click();assert.match(await button('Choose date and time').innerText(),/11:45 AM/);await button('Choose date and time').click();assert.equal(await page.getByRole('textbox',{name:'Select Time',exact:true}).inputValue(),'11:45 AM');await button('Done').click();await button('Customize').click();await button('Schedule Posts').click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('buffer-posts')).find(post=>post.status==='scheduled').scheduleAt),savedAt);
 });
 await check('Character limit blocks scheduling but permits saving a draft',async()=>{
  await open();await editor().fill('x'.repeat(2201));await button('Customize').click();assert.equal(await button('Schedule Posts').isDisabled(),true);assert.match(await page.locator('.composer-footer [role="alert"]').innerText(),/2,200/);await button('Save Draft').click();
 });
 await check('Publish Now is separate from scheduled queue',async()=>{
  await open();await editor().fill('Publish locally now');await button('Choose date and time').click();await button('More Posting Actions').click();await page.locator('.date-time-actions-menu button').filter({hasText:'Publish your post right away.'}).click();await button('Customize').click();await button('Schedule Posts').click();
  assert.match(await page.locator('.activity-section').first().innerText(),/1 posts scheduled/);await queue();await button('Published (1)').click();assert.match(await page.locator('.saved-post').innerText(),/Publish locally now/);await button('Queue (1)').click();assert.match(await page.locator('.saved-post').innerText(),/Future post/);await button('Close panel').click();
 });
 await check('First Steps completion persists after refresh',async()=>{await page.locator('.step-check').first().click();await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('.step-check').first().getAttribute('aria-pressed'),'true');});
 await check('Repeated template name updates the saved template without duplicate keys',async()=>{await open();await button('Templates').click();for(const content of ['First version','Updated version']){await button('New Template').click();await page.getByLabel('Template name',{exact:true}).fill('Reusable template');await page.getByLabel('Post content',{exact:true}).fill(content);await button('Save Template').click();}assert.equal(await page.locator('.drawer-template').count(),1);assert.match(await page.locator('.drawer-template').innerText(),/Updated version/);await button('Close Composer').click();});
 await check('Modal keyboard focus stays inside the active dialog',async()=>{await button('Share Feedback').click();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.querySelector('.interaction-dialog').contains(document.activeElement)),true);for(let i=0;i<12;i++)await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('.interaction-dialog').contains(document.activeElement)),true);await page.keyboard.press('Escape');});
 await check('Responsive layouts remain within viewport at 320, 390, 768, 1024, and 1440 pixels',async()=>{for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),String(width));await open();await button('Choose date and time').click();const rect=await page.locator('.date-time-picker').boundingBox();assert.ok(rect.x>=0 && rect.x+rect.width<=width+1,`${width}: ${JSON.stringify(rect)}`);await button('Done').click();await button('Close Composer').click();}});
 await check('Calendar remains usable in short and landscape windows',async()=>{for(const [width,height] of [[320,568],[844,390],[1024,500]]){await page.setViewportSize({width,height});await open();await button('Choose date and time').click();const box=await page.locator('.date-time-picker').boundingBox();assert.ok(box.y>=0 && box.y+box.height<=height,JSON.stringify(box));await button('Done').click();await button('Close Composer').click();}});
 await check('Unavailable browser storage reports an error without crashing',async()=>{await page.evaluate(()=>{window.originalStorageWrite=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Unavailable','QuotaExceededError');};});await page.locator('.step-check').first().click();await page.getByRole('status').filter({hasText:'storage'}).waitFor();assert.equal(await page.locator('.dashboard').isVisible(),true);await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageWrite;});});
 await check('Malformed browser data does not crash the application',async()=>{await page.evaluate(()=>{localStorage.setItem('buffer-posts','{}');localStorage.setItem('buffer-templates','[null,12]');localStorage.setItem('buffer-channels','{}');});await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('.dashboard').isVisible(),true);await open();await button('Templates').click();await button('Personal').click();assert.equal(await page.locator('.drawer-template').count(),0);});
 assert.deepEqual(errors,[]);
 fs.writeFileSync('qa/edge-results.json',JSON.stringify({passed:results,errors},null,2));console.log(`SUCCESS ${results.length} edge-case checks`);
} catch(error){console.error(error.stack);console.error(errors);await page.screenshot({path:'qa/edge-failure.png',fullPage:true});fs.writeFileSync('qa/edge-results.json',JSON.stringify({passed:results,failure:error.message,errors},null,2));process.exitCode=1;}
finally{await browser.close();}
