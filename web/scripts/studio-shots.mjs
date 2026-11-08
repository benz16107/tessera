// Screenshots of the studio in a GPU-backed headless Chrome (ANGLE on Vulkan), for splat views the software renderer
// can't draw at a usable frame rate.
//   node scripts/studio-shots.mjs <playwright-core dir> <url> <out-prefix> [steps]
// steps (comma list): main (the opening view), world, person, camera, add, generate, timeline, focus. Prints the measured frame rate.
const [, , pwDir, url, out, stepsArg = 'main'] = process.argv;
const { chromium } = await import(`${pwDir}/index.mjs`);
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
await page.goto(new URL('/credits', url).href);
await page.evaluate(() => localStorage.setItem('shotmatch/name', 'Studio'));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(40000);
const fps = async () => {
  const f = () => page.evaluate(() => window.__studio?.gl?.info?.render?.frame ?? 0);
  const a = await f(); await page.waitForTimeout(2000); return ((await f()) - a) / 2;
};
console.log('renderer', await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; }));
console.log('fps', await fps(), 'world', await page.evaluate(() => document.querySelector('.st-panel-head .st-meta')?.textContent));
await page.keyboard.press('Escape');
const S = n => page.screenshot({ path: `${out}${n}.png` });
for (const step of stepsArg.split(',')) {
  if (step === 'main') { await page.waitForTimeout(500); await S(''); }
  if (step === 'world') { await page.keyboard.press('5'); await page.waitForTimeout(3000); await S('-world'); }
  if (step.startsWith('style:')) { // style:<World style label>, from the World view's default camera
    const label = step.slice(6);
    await page.keyboard.press('5'); await page.waitForTimeout(1000);
    await page.locator('.st-viewswitch button[aria-expanded]').click();
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    await page.waitForTimeout(label === 'Splat' ? 25000 : 6000);
    await S(`-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  }
  if (step === 'person') { await page.locator('.st-ol-row', { hasText: 'Person' }).nth(0).locator('button').first().click(); await page.waitForTimeout(1500); await S('-person'); await page.keyboard.press('Escape'); }
  if (step === 'camera') { await page.keyboard.press('0'); await page.waitForTimeout(6000); await S('-camera'); await page.keyboard.press('5'); await page.waitForTimeout(2000); }
  if (step === 'add') { await page.keyboard.press('Shift+A'); await page.waitForTimeout(800); await S('-add'); }
  if (step === 'generate') { await page.locator('.st-drawer-add').getByRole('tab', { name: 'Generate' }).click(); await page.waitForTimeout(500); await S('-generate'); await page.keyboard.press('Escape'); }
  if (step === 'timeline') { await page.mouse.move(800, 960); await page.waitForTimeout(900); await S('-timeline'); await page.mouse.move(800, 400); await page.waitForTimeout(600); }
  if (step === 'focus') { await page.keyboard.press('Tab'); await page.waitForTimeout(1200); await S('-focus'); await page.keyboard.press('Tab'); }
}
await browser.close();
