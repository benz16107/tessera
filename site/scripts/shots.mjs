// Screenshots of the site at desktop and phone size. Usage: node scripts/shots.mjs <base url> <out dir> [path=name ...]
// Defaults: the landing, the NVIDIA track page and the get-started page, saved as site-<name>-<size>.png.
import { chromium } from '/home/ben/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
const [base, out, ...pairs] = process.argv.slice(2);
const pages = pairs.length ? pairs.map((p) => p.split('=')) : [['/', 'landing'], ['/tracks/nvidia/', 'track-nvidia'], ['/docs/get-started/', 'docs-get-started']];
const SIZES = { desktop: { viewport: { width: 1512, height: 982 }, deviceScaleFactor: 1 }, phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const browser = await chromium.launch({ executablePath: '/home/ben/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome' });
for (const [size, opts] of Object.entries(SIZES)) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  for (const [path, name] of pages) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    // Scroll through once so lazy images load and the tagline reveal runs, then back to the top.
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await page.screenshot({ path: `${out}/site-${name}-${size}.png`, fullPage: true });
    console.log(size, path, overflow > 0 ? `HORIZONTAL OVERFLOW ${overflow}px` : 'no overflow', errors.length ? errors.join(' | ') : '');
    errors.length = 0;
  }
  await ctx.close();
}
await browser.close();
