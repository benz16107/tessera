// Captures the landing page for review. Usage: node scripts/landing-capture.mjs <base url> <out dir>
// Writes: site-landing-v2-{desktop,phone}.png (frames along the scroll, with motion),
//         site-landing-v2-reduced-{desktop,phone}.png (full page with prefers-reduced-motion: reduce),
//         site-landing-v2.webm (a desktop scroll through the page, wheel-driven so Lenis and the pins behave as for a person).
import { chromium } from '/home/ben/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
import { renameSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import sharp from 'sharp';

const [base, out] = process.argv.slice(2);
const SIZES = {
  desktop: { viewport: { width: 1512, height: 982 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const browser = await chromium.launch({ executablePath: '/home/ben/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Scroll positions worth seeing: progress points inside each pinned section, then the sections after them.
async function positions(page) {
  return page.evaluate(() => {
    const at = (sel, ps) => {
      const el = document.querySelector(sel);
      const sp = el.closest('.pin-spacer') ?? el;
      const top = sp.getBoundingClientRect().top + scrollY - 56;
      const range = Math.max(0, sp.offsetHeight - el.offsetHeight);
      return ps.map((p) => Math.round(top + p * range));
    };
    const below = (sel, off) => Math.round(document.querySelector(sel).getBoundingClientRect().top + scrollY - off);
    return [
      ...at('[data-hero]', [0, 0.25, 0.55, 0.97]),
      ...at('[data-steps]', [0.05, 0.38, 0.68, 0.97]),
      below('[data-views]', 120),
      below('[data-numbers]', innerHeight * 0.3),
      document.documentElement.scrollHeight - innerHeight,
    ];
  });
}

for (const [size, opts] of Object.entries(SIZES)) {
  // Frames with motion.
  let ctx = await browser.newContext({ ...opts, reducedMotion: 'no-preference' });
  let page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await sleep(600);
  const frames = [];
  for (const [i, y] of (await positions(page)).entries()) {
    await page.evaluate((y) => scrollTo(0, y), y);
    await sleep(i === 8 ? 2200 : i === 9 ? 1800 : 700); // the Simple-to-Studio wipe and the count-up need time to finish
    frames.push(await page.screenshot());
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  console.log(size, 'motion frames', frames.length, overflow > 0 ? `HORIZONTAL OVERFLOW ${overflow}px` : 'no overflow', errors.join(' | '));
  await ctx.close();
  const W = size === 'desktop' ? 756 : 393, cols = size === 'desktop' ? 3 : 4;
  const tiles = await Promise.all(frames.map((f) => sharp(f).resize({ width: W }).png().toBuffer({ resolveWithObject: true })));
  const H = tiles[0].info.height, G = 16, rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * W + (cols + 1) * G, height: rows * H + (rows + 1) * G, channels: 3, background: '#2b2a27' } })
    .composite(tiles.map((t, i) => ({ input: t.data, left: G + (i % cols) * (W + G), top: G + Math.floor(i / cols) * (H + G) })))
    .png().toFile(`${out}/site-landing-v2-${size}.png`);

  // Full page with reduced motion: the static layout.
  ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
  page = await ctx.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); } scrollTo(0, 0); });
  await sleep(300);
  const motionClass = await page.evaluate(() => document.documentElement.classList.contains('motion'));
  await page.screenshot({ path: `${out}/site-landing-v2-reduced-${size}.png`, fullPage: true });
  console.log(size, 'reduced', motionClass ? 'MOTION CLASS STILL SET' : 'static');
  await ctx.close();
}

// The scroll video, desktop, driven by the mouse wheel.
const dir = `${out}/.video-tmp`;
mkdirSync(dir, { recursive: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir, size: { width: 1280, height: 800 } }, reducedMotion: 'no-preference' });
const page = await ctx.newPage();
await page.goto(base + '/', { waitUntil: 'networkidle' });
await sleep(1500);
await page.mouse.move(640, 400);
// About 30 s of scrolling, with short holds where the story lands: the camera view, and the Simple-to-Studio wipe.
const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
const holds = await page.evaluate(() => {
  const sp = document.querySelector('[data-hero]').closest('.pin-spacer');
  const views = document.querySelector('[data-views]');
  return [sp.offsetTop + sp.offsetHeight * 0.62, views.getBoundingClientRect().top + scrollY - innerHeight * 0.3];
});
const step = Math.max(24, Math.round(total / 520));
for (let y = 0; y < total; y += step) {
  await page.mouse.wheel(0, step);
  await sleep(40);
  if (holds.length && y >= holds[0]) { holds.shift(); await sleep(1800); }
}
await sleep(2500);
await ctx.close();
const vid = readdirSync(dir).find((f) => f.endsWith('.webm'));
renameSync(`${dir}/${vid}`, `${out}/site-landing-v2.webm`);
rmSync(dir, { recursive: true, force: true });
console.log('video', `${out}/site-landing-v2.webm`);
await browser.close();
