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
// PHONE=1: a 390 x 844 touch phone (coarse pointer), for the phone layouts.
const page = await browser.newPage(process.env.PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1512, height: 982 } });
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
for (const step of stepsArg.split(/,(?![^{]*})/)) {
  if (step === 'main') { await page.waitForTimeout(500); await S(''); }
  if (step === 'walk') { // Walk: the help card, then a few steps forward and a turn to the right
    await page.keyboard.press('5'); await page.waitForTimeout(800);
    await page.keyboard.press('Backquote'); await page.waitForTimeout(1500); await S('-walk');
    await page.keyboard.down('ArrowUp'); await page.waitForTimeout(2200); await page.keyboard.up('ArrowUp');
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(700); await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(800); await S('-walk-moved');
  }
  if (step === 'earth') { await page.keyboard.press('5'); await page.waitForTimeout(35000); await S('-earth'); }
  if (step === 'earthwalk') { // Walk from the aerial: land on the street ahead, walk forward
    await page.keyboard.press('Backquote'); await page.waitForTimeout(6000);
    await page.locator('.st-walk-help button').click().catch(() => {});
    // Rise to about 10 m (a drone's eye): Google's tiles melt at 1.6 m
    await page.keyboard.down('Shift'); await page.keyboard.down('e'); await page.waitForTimeout(2600); await page.keyboard.up('e'); await page.keyboard.up('Shift');
    await page.waitForTimeout(6000); await S('-earth-walk'); await page.keyboard.press('Escape');
  }
  if (step.startsWith('fly:')) { // fly:<place>: search and fly there, no new shoot
    await page.keyboard.press('5'); await page.waitForTimeout(800);
    await page.locator('button[aria-label="Go to a place"]').click();
    await page.locator('input[aria-label="Place"]').fill(step.slice(4)); await page.keyboard.press('Enter');
    await page.locator('.st-search > button').first().click({ timeout: 15000 });
    await page.waitForTimeout(18000); await S('-fly');
  }
  if (step.startsWith('goto:')) { // goto:<place>, then New shoot here and a camera dropped there
    await page.keyboard.press('5'); await page.waitForTimeout(800);
    await page.locator('button[aria-label="Go to a place"]').click();
    await page.locator('input[aria-label="Place"]').fill(step.slice(5)); await page.keyboard.press('Enter');
    await page.locator('.st-search > button').first().click({ timeout: 15000 });
    await page.waitForTimeout(18000); await S('-goto');
    await page.locator('.st-explore button', { hasText: 'New shoot here' }).click({ timeout: 30000 });
    await page.waitForURL(u => !u.toString().includes(new URL(url).pathname), { timeout: 30000 });
    console.log('new shoot', page.url());
    await page.waitForTimeout(25000); await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+A'); await page.waitForTimeout(800);
    await page.locator('.st-drawer-add').getByRole('tab', { name: 'Cameras' }).click();
    await page.locator('.st-drawer-add .st-asset').first().click();
    await page.waitForTimeout(5000); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.waitForTimeout(3000); await S('-goto-cam');
  }
  if (step === 'map') { await page.keyboard.press('5'); await page.waitForTimeout(1500); await page.locator('.st-viewswitch [role="group"] button', { hasText: /^Map$/ }).click(); await page.waitForTimeout(9000); await S('-map'); }
  if (step === 'map3d') { // zoom the map in past street level: it hands over to the 3D set
    await page.mouse.move(732, 480);
    for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(250); }
    await page.waitForTimeout(12000); await S('-map3d');
  }
  if (step === '3dmap') { // pull the World camera out past 2 km: it hands back to the map
    await page.keyboard.press('5'); await page.waitForTimeout(3000); await page.mouse.move(732, 480);
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(120); }
    await page.waitForTimeout(8000); await S('-3dmap');
  }
  if (step.startsWith('cam|')) { // cam|<name>|<json shot patch>[|lock], from Through Cam A
    const [, name, json, lock] = step.split('|');
    await page.evaluate(([j, l]) => { window.__cam.set(JSON.parse(j), l === 'lock'); }, [json, lock]);
    await page.waitForTimeout(5000); await S(`-${name}`);
  }
  if (step === 'restore') { // end Compare (puts Cam A back) and return the shot settings to A9TVAN's originals
    await page.evaluate(() => { window.__cam.endCompare(); });
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__cam.set({ bodyId: 'sony-a7iv', lensId: 'tamron-28-75-f28-g2', focalMm: 51, aperture: 2.8, shutterS: 1 / 640, iso: 100, focusM: 5.1, whiteBalanceK: 5500 }, false));
    await page.waitForTimeout(3000);
  }
  if (step === 'preset') { await page.evaluate(() => window.__cam.preset()); await page.waitForTimeout(9000); await S('-compare'); }
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
