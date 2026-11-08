// Live check of the text-to-set agent: a throwaway session with a shot camera at the demo session's solved pose, then real
// commands against hosted Nemotron (and Bolt offline with --offline). Deletes the session unless --keep. Never touches A9TVAN's rows.
// npx tsx scripts/set-smoke.ts ["command" ...] [--offline] [--keep] [--rebuild]
import { conn, ready, until } from '../src/stdb.ts';
import { setCommand } from '../src/setagent.ts';
import { describeObjects, latestSolved, newObject, setContext, sessionObjects } from '../src/set.ts';
import { cameraQuat, enuOf } from '../src/setgeo.ts';
import { runTool } from '../src/settools.ts';
import { usage } from '../src/ledger.ts';

const args = process.argv.slice(2), flags = new Set(args.filter(a => a.startsWith('--')));
const commands = args.filter(a => !a.startsWith('--'));
if (!commands.length) commands.push('two friends walking toward camera, a red vintage bike on the left wall, warm string lights', 'move the bike a little closer to the camera', 'what lens am I on?');

await ready;
await until(() => conn.db.session.code.find('A9TVAN'), 15_000, 'the demo session');
const demo = conn.db.session.code.find('A9TVAN')!;
const solved = latestSolved(demo.id);
if (!solved) throw new Error('A9TVAN has no solved photo');
const spot = conn.db.spot.id.find(demo.spotId || 'nyc_dumbo')!;
const title = `nvidia-smoke-${Date.now()}`;
await conn.reducers.createSession({ spotId: spot.id, title, name: 'ShotMatch crew' });
const s = await until(() => [...conn.db.session.iter()].find(x => x.title === title), 15_000, 'the test session');
console.log(`test session ${s.id} (${s.code}) at ${spot.id}`);
const p = solved.p, pose = solved.r!.pose;
await conn.reducers.addPhoto({ sessionId: s.id, spotId: '', url: p.url, thumb: p.thumb, width: p.width, height: p.height, pinLat: undefined, pinLon: undefined, exifF35: p.exifF35, source: 'web' });
const e = enuOf(spot, pose.lat, pose.lon);
const cam = newObject('camera', 'Shot camera', { ...e, z: Math.max(0.3, pose.alt) }, cameraQuat(pose.heading, pose.pitch, pose.roll), {}, { shot: 1, f35: Math.round(pose.f35 * 10) / 10 });
await conn.reducers.addSceneObject({ sessionId: s.id, ...cam });
await until(() => sessionObjects(s.id).length > 0 && [...conn.db.photo.sessionId.filter(s.id)].length > 0, 10_000, 'camera and photo rows');
const ctx = setContext(s.id)!;
console.log(`shot camera from ${ctx.camSource}: ${JSON.stringify({ ...ctx.cam, x: Math.round(ctx.cam.x), y: Math.round(ctx.cam.y) })}`);

try {
  if (flags.has('--rebuild')) {
    const t0 = Date.now(), out = await runTool(s.id, 'rebuild_from_photo', {});
    console.log(`\nrebuild_from_photo ${Date.now() - t0} ms: ${JSON.stringify(out).slice(0, 600)}`);
  }
  for (const c of commands) {
    const r = await setCommand(s.id, c, { offline: flags.has('--offline'), channel: 'smoke test' });
    console.log(`\n> ${c}\n${r.intent} via ${r.model}${r.offline ? ' (offline)' : ''} in ${r.ms} ms (route ${r.routeMs ?? '-'} ms): ${r.reply}`);
    for (const st of r.steps) console.log(`  ${st.tool} ${st.args.slice(0, 160)} -> ${st.result.slice(0, 200)} (${st.ms} ms)`);
  }
  console.log(`\nset now:\n${describeObjects(setContext(s.id)!)}`);
  console.log(`\nledger:\n${usage().map(u => `${u.model} [${u.provider}] ${u.roles.join(', ')}: ${u.calls} calls, median ${u.medianMs} ms`).join('\n')}`);
} finally {
  if (!flags.has('--keep')) { await conn.reducers.deleteSession({ sessionId: s.id }); console.log(`\ndeleted test session ${s.code}`); }
  else console.log(`\nkept test session ${s.code}: /studio/${s.code}`);
  await new Promise(r => setTimeout(r, 11_000)); // let the ledger save
  process.exit(0);
}
