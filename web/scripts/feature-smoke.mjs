// Feature smoke test on a live ShotMatch: re-runs the core paths in a fresh scratch shoot and prints PASS or FAIL per path.
//   node scripts/feature-smoke.mjs [--render] [--keep]
// Env: BASE (default production), PW (playwright-core dir), CHROME (default /usr/bin/google-chrome), GL=gpu for ANGLE on Vulkan.
// SwiftShader is the default: headless Chrome on linuxbox's integrated GPU lost its WebGL context in Simple under load.
// It creates its own shoot from the example photo and deletes it at the end with "Delete shoot" (unless --keep). It never opens
// the demo shoot A9TVAN. --render adds one AI render (NVIDIA inference, about a minute).
const BASE = process.env.BASE || 'https://104-238-146-229.sslip.io';
const PW = process.env.PW || '/tmp/shots/node_modules/playwright-core';
const { chromium } = await import(`${PW}/index.mjs`);
const args = new Set(process.argv.slice(2));
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  args: process.env.GL !== 'gpu' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const results = [];
const report = (path, ok, detail) => { results.push({ path, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${path}: ${detail}`); };
const until = async (fn, ms = 15000, step = 500) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, step))) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } } return null; };
async function person(name, view) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 982 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(([n, v]) => { localStorage.setItem('shotmatch/name', n); localStorage.setItem('shotmatch/view', v); localStorage.setItem('studio/hint-focus', '1'); localStorage.setItem('studio/hint-walk', '1'); }, [name, view]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e.message || e).slice(0, 160)));
  return page;
}
const lens = p => p.locator('.s-lensline').innerText().catch(() => '');
const head = p => p.locator('aside[aria-label=Inspector] .st-insp-head').first().innerText().then(t => t.replace(/\s+/g, ' ')).catch(() => '');
const view = p => p.locator('.studio').getAttribute('data-view');
const SHOTS = new URL('../screenshots/feature/', import.meta.url).pathname;
const pathTry = async (name, fn) => { try { await fn(); } catch (e) { const f = `${SHOTS}smoke-fail-${name.replace(/\W+/g, '-').toLowerCase()}.png`; await A.screenshot({ path: f }).catch(() => {}); report(name, false, `${String(e).split('\n')[0].slice(0, 200)} (screenshot ${f.split('/web/')[1]})`); } };

const A = await person('Smoke A', 'simple');
let code = '';
await pathTry('Simple 1: drop the example photo and solve', async () => {
  await A.goto(`${BASE}/`);
  const ex = A.getByRole('button', { name: /Try Manhattan Bridge/ });
  await ex.waitFor({ timeout: 30000 }); await until(() => ex.isEnabled(), 20000);
  await ex.click();
  await A.waitForURL(/\/(p|studio)\/[A-Z0-9]+/, { timeout: 60000 });
  code = A.url().match(/\/(?:p|studio)\/([A-Z0-9]+)/)[1];
  const found = await until(async () => /mm/.test(await A.locator('.s-panel-body').innerText()) && (await A.locator('.s-steps [role=tab]').count()) === 3, 150000, 2000);
  const text = (await A.locator('.s-panel-body').innerText()).replace(/\s+/g, ' ');
  report('Simple 1: drop the example photo and solve', !!found && /Solid|Check/.test(text), `${code}: ${text.slice(0, 90)}`);
});
await pathTry('Simple 2: Make it yours (Golden hour, Portrait look)', async () => {
  await A.locator('.s-steps [role=tab]', { hasText: 'Make it yours' }).click(); await A.waitForTimeout(1500);
  await A.locator('.s-presets .s-chip', { hasText: 'Portrait look' }).click();
  const g = A.locator('.s-presets .s-chip', { hasText: 'Golden hour' });
  if (await g.isEnabled()) await g.click();
  const ok = await until(async () => /8[0-9] mm/.test(await lens(A)) && /golden hour/.test(await lens(A)), 10000);
  report('Simple 2: Make it yours (Golden hour, Portrait look)', !!ok, await lens(A));
});
await pathTry('Simple 3: Take me there', async () => {
  await A.locator('.s-steps [role=tab]', { hasText: 'Take me there' }).click(); await A.waitForTimeout(3000);
  const href = await A.locator('.s-panel-body a', { hasText: 'Walking directions' }).getAttribute('href');
  const qr = await A.locator('img[alt^="QR code to open the scout camera"]').getAttribute('alt');
  report('Simple 3: Take me there', /travelmode=walking/.test(href) && qr.includes(`/s/${code}`), `${href.slice(0, 70)}; QR ${qr.split(' at ')[1]}`);
});
await pathTry('Simple 4: Share, copy link', async () => {
  await A.locator('.s-session button', { hasText: 'Share' }).click(); await A.waitForTimeout(600);
  await A.locator('.s-sharelink .s-btn').click(); await A.waitForTimeout(400);
  const clip = await A.evaluate(() => navigator.clipboard.readText());
  await A.locator('dialog.s-share button[aria-label=Close]').click();
  report('Simple 4: Share, copy link', clip === `${BASE}/p/${code}`, clip);
});
await pathTry('Simple to Studio: settings carry over', async () => {
  const before = await lens(A.locator ? A : A);
  await A.locator('.s-steps [role=tab]', { hasText: 'Make it yours' }).click(); await A.waitForTimeout(800);
  const line = await lens(A);
  await A.locator('.vswitch button', { hasText: 'Studio' }).first().click();
  await A.waitForURL(/\/studio\//, { timeout: 15000 });
  await until(async () => (await A.locator('aside[aria-label=Inspector] .st-insp').count()) > 0, 90000);
  await A.waitForTimeout(12000);
  const h = await head(A);
  void before;
  report('Simple to Studio: settings carry over', h.includes(line.match(/(\d+) mm/)?.[1] + ' mm'), `Simple "${line}", Studio "${h}", view ${await view(A)}`);
});
await pathTry('Studio: views keep the camera settings', async () => {
  const sel = A.locator('aside[aria-label=Inspector] select[aria-label=Aperture]');
  await sel.selectOption('5.6'); await A.waitForTimeout(1500);
  const h0 = await head(A);
  const seen = [];
  for (const v of ['World', 'Map', 'World', 'Walk', 'Top']) {
    if (v === 'Walk') await A.keyboard.press('Escape');
    await A.locator('[role=group][aria-label=View] button').filter({ hasText: new RegExp(`^${v}$`) }).first().click({ timeout: 8000 });
    await A.waitForTimeout(v === 'Map' ? 5000 : 2500); seen.push(await view(A));
    if (v === 'Walk') { await A.keyboard.press('Escape'); await A.keyboard.press('Escape'); }
  }
  await A.keyboard.press('0'); await A.waitForTimeout(2500); seen.push(await view(A));
  const h1 = await head(A);
  report('Studio: views keep the camera settings', h0 === h1 && seen.join() === 'persp,map,persp,walk,top,shot', `${seen.join(' ')}; "${h0}" -> "${h1}"`);
});
await pathTry('Studio: place a person (two-context sync)', async () => {
  const B = await person('Smoke B', 'studio');
  await B.goto(`${BASE}/studio/${code}`);
  await until(async () => (await B.locator('aside[aria-label=Scene]').count()) > 0, 90000);
  await B.waitForTimeout(6000);
  await A.keyboard.press('5'); await A.waitForTimeout(1500);
  await A.keyboard.press('Shift+A');
  await A.locator('[role=dialog][aria-label="Add to the set"] [role=tab]', { hasText: 'People' }).click();
  await A.locator('button.st-pose[title="Add a person, stand"]').click();
  const seen = await until(async () => /People/.test(await B.locator('aside[aria-label=Scene]').innerText()), 10000);
  report('Studio: place a person (two-context sync)', !!seen, `B outliner ${seen ? 'shows People' : 'has no person'}`);
  // Change time on A and see it on B
  await A.keyboard.press('Escape');
  const tr = A.locator('div.st-track[role=slider]');
  await tr.focus(); await A.keyboard.press('Shift+ArrowRight'); await A.keyboard.press('Shift+ArrowRight');
  const t = await tr.getAttribute('aria-valuetext');
  const ok = await until(async () => (await B.locator('div.st-track[role=slider]').getAttribute('aria-valuetext')) === t, 10000);
  report('Studio: change time (two-context sync)', !!ok, `A ${t}, B ${await B.locator('div.st-track[role=slider]').getAttribute('aria-valuetext')}`);
  await B.context().close();
});
await pathTry('Share link in a new browser', async () => {
  await A.locator('.st-session button', { hasText: 'Share' }).click(); await A.waitForTimeout(500);
  const url = await A.evaluate(() => navigator.clipboard.readText());
  const C = await person('Smoke C', 'studio');
  await C.goto(url);
  await until(async () => (await C.locator('aside[aria-label=Inspector] .st-insp').count()) > 0, 90000);
  await C.waitForTimeout(8000);
  const hc = await head(C), ha = await head(A);
  report('Share link in a new browser', url === `${BASE}/studio/${code}` && hc.split('·').slice(1).join() === ha.split('·').slice(1).join(), `${url}; A "${ha}", C "${hc}"`);
  await C.context().close();
});
if (args.has('--render')) await pathTry('Studio: render with the current settings', async () => {
  let body = '';
  A.on('request', r => { if (r.url().endsWith('/api/render') && r.method() === 'POST') body = (r.postDataBuffer() || Buffer.alloc(0)).toString('latin1'); });
  await A.locator('.st-session button', { hasText: 'Render' }).click(); await A.waitForTimeout(2500);
  await A.locator('section[aria-label="AI render"] .nv-btn.primary').click();
  const done = await until(async () => (await A.locator('section[aria-label="AI render"] .nv-render img').count()) || (await A.locator('section[aria-label="AI render"] .nv-error').count()), 240000, 3000);
  const err = await A.locator('section[aria-label="AI render"] .nv-error').innerText().catch(() => '');
  const badge = await A.locator('section[aria-label="AI render"] .nv-badge').innerText().catch(() => '');
  const sent = JSON.parse(body.match(/name="settings"\r?\n\r?\n([^\r\n]+)/)?.[1] ?? '{}');
  report('Studio: render with the current settings', !!done && !err && /AI interpretation/i.test(badge) && sent.aperture === 5.6, `badge "${badge}" ${err}; sent f/${sent.aperture}`);
});
if (!args.has('--keep') && code) await pathTry('Delete the scratch shoot', async () => {
  await A.goto(`${BASE}/p/${code}`);
  await A.locator('.s-session button', { hasText: 'Share' }).click({ timeout: 60000 });
  await A.locator('.s-danger .s-textbtn').click();
  await A.locator('.s-btn.danger', { hasText: 'Delete shoot' }).click();
  await A.waitForURL(u => new URL(u).pathname === '/', { timeout: 15000 });
  await A.goto(`${BASE}/p/${code}`); await A.waitForTimeout(6000);
  report('Delete the scratch shoot', /No shoot with the code/.test(await A.locator('h1').first().innerText()), `${code} gone`);
});
if (A.errors.length) console.log('page errors:', A.errors.slice(0, 5).join(' | '));
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} paths pass${code ? ` (shoot ${code}${args.has('--keep') ? ', kept' : ', deleted'})` : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
