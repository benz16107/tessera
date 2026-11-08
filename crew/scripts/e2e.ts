// End-to-end check through the public path, as a separate client identity (not the crew):
// upload -> createSession -> addPhoto -> solve_result -> requestPreview -> preview done -> deletePhoto.
// Usage: npx tsx scripts/e2e.ts [photo] [base-url]
import { readFileSync } from 'node:fs';
import { DbConnection, tables } from '../src/module_bindings/index.ts';

const photo = process.argv[2] ?? new URL('../../spots/nyc_dumbo/test/d0481.jpg', import.meta.url).pathname;
const base = process.argv[3] ?? 'http://127.0.0.1:8790';
const cfg: any = await (await fetch(`${base}/api/config`)).json();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | false, ms: number, what: string): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await wait(500)) { const v = fn(); if (v) return v; }
  throw new Error(`timed out: ${what}`);
}

const conn = await new Promise<DbConnection>((res, rej) =>
  DbConnection.builder().withUri(cfg.spacetimeHost).withDatabaseName(cfg.dbName)
    .onConnect(c => res(c as DbConnection)).onConnectError((_c, e) => rej(e)).build());
await new Promise<void>(r => conn.subscriptionBuilder().onApplied(() => r())
  .subscribe([tables.session, tables.photo, tables.solveJob, tables.solveResult, tables.previewJob, tables.agentStep]));
const me = conn.identity!.toHexString();

const up: any = await (await fetch(`${base}/api/upload`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: readFileSync(photo) })).json();
console.log('upload', { ...up, thumb: `${up.thumb.length} chars` });
const spotId = up.nearestSpot ?? 'nyc_dumbo';
await conn.reducers.createSession({ spotId, title: 'e2e self-test', name: 'e2e' });
const s = await until(() => [...conn.db.session.iter()].filter(x => x.owner.toHexString() === me).sort((a, b) => Number(b.id - a.id))[0], 10_000, 'session');
await conn.reducers.addPhoto({ sessionId: s.id, spotId, url: up.url, thumb: up.thumb, width: up.width, height: up.height,
  pinLat: up.gpsLat ?? undefined, pinLon: up.gpsLon ?? undefined, exifF35: up.exifF35 ?? undefined, source: 'web' });
const p = await until(() => [...conn.db.photo.sessionId.filter(s.id)][0], 10_000, 'photo');
console.log(`session ${s.id} (${s.code}), photo ${p.id}`);

let last = '';
const job = await until(() => {
  const j = [...conn.db.solveJob.photoId.filter(p.id)][0];
  if (j && j.progress !== last) console.log(`  solve: ${j.state} ${(last = j.progress)}`);
  return j && (j.state === 'done' || j.state === 'failed') && j;
}, 8 * 60_000, 'solve');
const r = conn.db.solveResult.photoId.find(p.id);
console.log('solve', job.state, job.error, r && { ...r.pose, inliers: r.inliers, confidence: r.confidence, reason: r.reason, lensReadF35: r.lensReadF35, secs: r.secs });

await conn.reducers.requestPreview({ sessionId: s.id, photoId: p.id, instruction: '', f35: r ? r.pose.f35 * 1.5 : 50, people: 2, sunAzimuth: 240, sunAltitude: 4 });
const pj = await until(() => [...conn.db.previewJob.sessionId.filter(s.id)].find(j => j.state === 'done' || j.state === 'failed'), 5 * 60_000, 'preview');
console.log('preview', pj.state, pj.imageUrl, pj.error);
console.log('trace'); for (const a of [...conn.db.agentStep.sessionId.filter(s.id)]) console.log(`  ${a.tool} (${a.ms} ms): ${a.result.slice(0, 140)}`);

if (!process.env.KEEP) { await conn.reducers.deletePhoto({ photoId: p.id }); console.log('deleted photo', p.id); }
const ok = job.state === 'done' && r?.confidence === 'solid' && pj.state === 'done';
console.log(ok ? 'E2E OK' : 'E2E FAILED');
process.exit(ok ? 0 : 1);
