const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--remote-debugging-port=9238"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("https://publish.buffer.com/home");
console.log(`Reference browser open at ${page.url()}. Sign in manually if prompted; do not send credentials in chat.`);
await new Promise(resolve => browser.on("disconnected", resolve));
