// Live check that the render turns grey mannequins into photoreal people: throwaway sessions on the A9TVAN photo with one
// and two people, studio-like layers (grey mannequins, object-ID mask, contact shadow) drawn at the people's projected
// positions, the full render pass, and before/after PNGs in web/screenshots/render-people-<n>-*.png. A9TVAN's rows are not touched.
// npx tsx scripts/render-people.ts [counts...]
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Timestamp } from 'spacetimedb';
import { conn, ready, until } from '../src/stdb.ts';
import { REPO, PREVIEWS_DIR } from '../src/config.ts';
import { addObject, latestSolved, newObject, personAt, setContext, sessionObjects } from '../src/set.ts';
import { cameraQuat, enuOf, frameToGround, project, rowAcross, type Cam } from '../src/setgeo.ts';
import { readPhoto } from '../src/vision.ts';
import { render } from '../src/render.ts';
import { sunAt, sunWindows } from '../src/sun.ts';

const OUT = join(REPO, 'web/screenshots');
const COLORS = ['#e61a8c', '#1ae64d', '#1a8ce6'];

/** A grey shop mannequin (head, torso, arms, legs) of pixel height H with its feet at (u, v), as SVG shapes. */
function mannequin(u: number, v: number, H: number, fill: string, walk: boolean) {
  const x = (f: number) => (u + f * H).toFixed(1), y = (f: number) => (v - H + f * H).toFixed(1), d = (f: number) => (f * H).toFixed(1);
  const leg = walk ? 0.06 : 0.025;
  return `<ellipse cx="${x(0)}" cy="${y(0.065)}" rx="${d(0.05)}" ry="${d(0.065)}" fill="${fill}"/>
<rect x="${x(-0.025)}" y="${y(0.12)}" width="${d(0.05)}" height="${d(0.05)}" fill="${fill}"/>
<rect x="${x(-0.12)}" y="${y(0.16)}" width="${d(0.24)}" height="${d(0.36)}" rx="${d(0.05)}" fill="${fill}"/>
<rect x="${x(-0.17)}" y="${y(0.17)}" width="${d(0.055)}" height="${d(0.33)}" rx="${d(0.025)}" fill="${fill}"/>
<rect x="${x(0.115)}" y="${y(0.17)}" width="${d(0.055)}" height="${d(0.33)}" rx="${d(0.025)}" fill="${fill}"/>
<rect x="${x(-0.1 - leg)}" y="${y(0.5)}" width="${d(0.085)}" height="${d(0.5)}" rx="${d(0.03)}" fill="${fill}"/>
<rect x="${x(0.015 + leg)}" y="${y(0.5)}" width="${d(0.085)}" height="${d(0.5)}" rx="${d(0.03)}" fill="${fill}"/>`;
}

async function layers(cam: Cam, people: { x: number; y: number; h: number; walk: boolean; color: string }[]) {
  const { w, h } = cam;
  const shapes = people.map(p => { const f = project(cam, { x: p.x, y: p.y, z: 0 })!, t = project(cam, { x: p.x, y: p.y, z: p.h })!; return { ...p, u: f.u, v: f.v, H: f.v - t.v }; });
  const svg = (body: string, defs = '') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>${defs}</defs>${body}</svg>`);
  const grad = '<linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#c9c9c9"/><stop offset="0.55" stop-color="#9a9a9a"/><stop offset="1" stop-color="#6e6e6e"/></linearGradient>';
  const beauty = await sharp(svg(shapes.map(s => mannequin(s.u, s.v, s.H, 'url(#g)', s.walk)).join(''), grad)).png().toBuffer();
  const mask = await sharp({ create: { width: w, height: h, channels: 3, background: '#000' } }).composite([{ input: svg(shapes.map(s => mannequin(s.u, s.v, s.H, s.color, s.walk)).join('')) }]).png().toBuffer();
  const shadow = await sharp(svg(shapes.map(s => `<ellipse cx="${s.u.toFixed(1)}" cy="${s.v.toFixed(1)}" rx="${(0.22 * s.H).toFixed(1)}" ry="${(0.035 * s.H).toFixed(1)}" fill="black" fill-opacity="0.75"/>`).join(''))).blur(4).png().toBuffer();
  return { beauty, mask, shadow };
}

await ready;
mkdirSync(OUT, { recursive: true });
await until(() => conn.db.session.code.find('A9TVAN'), 15_000, 'the demo session');
const demo = conn.db.session.code.find('A9TVAN')!, solved = latestSolved(demo.id)!;
const spot = conn.db.spot.id.find(demo.spotId || 'nyc_dumbo')!, p = solved.p, pose = solved.r!.pose;
for (const n of (process.argv.slice(2).map(Number).filter(Boolean).length ? process.argv.slice(2).map(Number) : [1, 2])) {
  const title = `nvidia-render-people-${n}-${Date.now()}`;
  await conn.reducers.createSession({ spotId: spot.id, title, name: 'ShotMatch crew' });
  const s = await until(() => [...conn.db.session.iter()].find(x => x.title === title), 15_000, 'the test session');
  try {
    await conn.reducers.addPhoto({ sessionId: s.id, spotId: '', url: p.url, thumb: p.thumb, width: p.width, height: p.height, pinLat: undefined, pinLon: undefined, exifF35: p.exifF35, source: 'web' });
    const e = enuOf(spot, pose.lat, pose.lon);
    await conn.reducers.addSceneObject({ sessionId: s.id, ...newObject('camera', 'Shot camera', { ...e, z: Math.max(0.3, pose.alt) }, cameraQuat(pose.heading, pose.pitch, pose.roll), {}, { shot: 1, f35: pose.f35 }) });
    const photo = await until(() => [...conn.db.photo.sessionId.filter(s.id)][0], 10_000, 'the photo row');
    await until(() => sessionObjects(s.id).length > 0, 10_000, 'the camera row');
    const g = sunWindows(pose.lat, pose.lon, pose.heading).golden!, mid = new Date((g.start.getTime() + g.end.getTime()) / 2);
    await conn.reducers.setPlanTime({ sessionId: s.id, at: new Timestamp(BigInt(mid.getTime()) * 1000n) });
    await readPhoto(s.id, photo.id);
    const cam = setContext(s.id)!.cam;
    const spots = rowAcross(cam, frameToGround(cam, n === 1 ? 0.05 : 0, 6.5), n, 1.3);
    const people = [];
    for (const [i, at] of spots.entries()) {
      const hM = [1.72, 1.8, 1.66][i], walk = i === 0;
      const row = await addObject(s.id, personAt(`Person ${i + 1}`, at, (pose.heading + 180) % 360, walk ? 'walk' : 'stand', hM));
      people.push({ ...at, h: hM, walk, color: COLORS[i], id: String(row.id) });
    }
    const l = await layers(cam, people);
    const sun = sunAt(mid, pose.lat, pose.lon);
    const t0 = Date.now();
    const r = await render({ sessionId: s.id, photoId: photo.id, beauty: l.beauty, shadow: l.shadow, mask: l.mask, sun,
      legend: people.map((pp, i) => ({ id: pp.id, name: `Person ${i + 1}`, kind: 'person', color: pp.color })), f35: cam.f35 });
    const file = (u: string) => join(PREVIEWS_DIR, u.replace('/preview/', ''));
    await sharp(file(r.compositeUrl)).png().toFile(join(OUT, `render-people-${n}-before.png`));
    await sharp(file(r.url)).png().toFile(join(OUT, `render-people-${n}-after.png`));
    if (r.rerendered) await sharp(file(r.url.replace(/r2\.jpg$/, '.jpg'))).png().toFile(join(OUT, `render-people-${n}-after-round1.png`));
    console.log(`\n${n} people: ${Date.now() - t0} ms, ${r.model}, placeholders ${r.placeholders}, rerendered ${r.rerendered}${r.fallback ? `\n  fallback: ${r.fallback.slice(0, 160)}` : ''}`);
    for (const c of r.checks) console.log(`  check ${c.round}: ${c.pass ? 'pass' : 'fail'}, mannequins ${JSON.stringify(c.placeholders)}: ${c.summary}`);
    console.log(`  prompt: ${r.prompt.slice(0, 700)}`);
  } finally { await conn.reducers.deleteSession({ sessionId: s.id }); }
}
setTimeout(() => process.exit(0), 11_000);
