// End to end proof of the five Photon mechanisms without Photon credentials: the real crew process (src/main.ts) against the
// scratch database shotmatch-photon, the real module, real NVIDIA calls, a fake Photon server (test/fake-photon.ts) and a fake
// solver that places the check-in photo 3.2 m east of the mark. Never against shotmatch: registerCrew would take the crew role.
// Run: cd crew && npx tsx scripts/photon-e2e.ts        (needs the owner's spacetime CLI login to set a dev crew code)
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { DbConnection } from '../src/module_bindings/index.ts';
import { Timestamp } from 'spacetimedb';
import { fakePhoton } from '../test/fake-photon.ts';
import { cameraQuat, llOf } from '../src/setgeo.ts';

const DB = 'shotmatch-photon', PORT = 8893, BASE = `http://127.0.0.1:${PORT}`, REPO = join(import.meta.dirname, '../..');
const spot = JSON.parse(readFileSync(join(REPO, 'spots/nyc_dumbo/spot.json'), 'utf8'));
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push([name, ok, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail.replace(/\n/g, ' / ').slice(0, 220)})` : ''}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | null | false, ms = 30_000): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return undefined; await sleep(250); }
}
const textOf = (c: any): string => c?.type === 'text' ? c.text : c?.type === 'group' ? c.parts.map(textOf).join('\n') : c?.type === 'attachment' ? (c.metadata?.caption?.text ?? '') : '';

// ---- fakes ---------------------------------------------------------------------------------------------------------
const AGENTS = { imessage: '+18885550111', sms: '+18885550100', email: 'set@mail.shotmatch.test', telegram: '@ShotMatchSetBot', whatsapp: '+18885550122', voice: '+18885550100' };
const photon = await fakePhoton({ agents: AGENTS });
const MARK = { x: 0, y: 0, heading: 0 };
const solved = llOf(spot, MARK.x + 3.2, MARK.y);
const solver = createServer((req, res) => {
  if (req.url === '/spots') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(['nyc_dumbo'])); }
  if (req.url === '/health') return res.end('ok');
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  res.write(JSON.stringify({ progress: 'matching 20 nearby photos' }) + '\n');
  res.end(JSON.stringify({ result: { ok: true, error: '', lat: solved.lat, lon: solved.lon, alt: 1.6, heading: 346, pitch: 0, roll: 0, f35: 35, fpx: 1000, width: 1600, height: 1200, inliers: 1204, confidence: 'solid', reason: '1204 matches, 3 m from a mapped camera', nearest_camera_m: 3, secs: 0.1 } }) + '\n');
}).listen(0, '127.0.0.1');
await new Promise(r => solver.once('listening', r));
const SOLVER = `http://127.0.0.1:${(solver.address() as any).port}`;

// ---- a crew of our own, on the scratch database, with secrets in a temp HOME -------------------------------------
const home = mkdtempSync(join(tmpdir(), 'photon-e2e-')), sec = join(home, '.config/shotmatch');
mkdirSync(sec, { recursive: true });
for (const f of ['nvidia_key', 'vultr_inference_key', 'openai_key', 'gemini_key', 'maps_key', 'voice_tool_secret'])
  if (existsSync(join(homedir(), '.config/shotmatch', f))) copyFileSync(join(homedir(), '.config/shotmatch', f), join(sec, f));
const code = randomBytes(12).toString('hex');
writeFileSync(join(sec, 'crew_code'), code, { mode: 0o600 });
writeFileSync(join(sec, 'photon_agents'), JSON.stringify(AGENTS), { mode: 0o600 });
const toolSecret = readFileSync(join(sec, 'voice_tool_secret'), 'utf8').trim();
execFileSync('spacetime', ['call', '--server', 'maincloud', DB, 'set_crew_code', JSON.stringify(code)], { stdio: 'ignore' });
const crew = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
  cwd: join(REPO, 'crew'), stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, HOME: home, DB_NAME: DB, PORT: String(PORT), PUBLIC_URL: BASE, SOLVER_URL: SOLVER, PHOTON_API_URL: photon.url, PHOTON_API_KEY: photon.key, PHOTON_PROJECT_ID: photon.project, PHOTON_STORE: join(home, 'photon.json') },
});
let crewLog = '';
crew.stdout.on('data', d => { crewLog += d; });
crew.stderr.on('data', d => { crewLog += d; });
const stop = async (code = 0) => {
  crew.kill('SIGTERM'); solver.close(); await photon.close();
  writeFileSync(join(REPO, 'data/photon-e2e.log'), crewLog);
  const pass = results.filter(r => r[1]).length;
  console.log(`\n${pass}/${results.length} passed. Crew log: data/photon-e2e.log`);
  process.exit(code || (pass === results.length ? 0 : 1));
};
process.on('uncaughtException', e => { console.error(e); check('no crash', false, (e as Error).message); void stop(1); });
process.on('unhandledRejection', e => { console.error(e); check('no crash', false, String(e)); void stop(1); });
if (!(await until(() => crewLog.includes('crew registered and subscribed'), 60_000))) { console.log(crewLog.slice(-2000)); check('crew starts on shotmatch-photon with Photon on the fake server', false); await stop(1); }
check('crew starts on shotmatch-photon with Photon on the fake server', true, crewLog.match(/Photon subscribed from seq \d+/)?.[0] ?? 'subscribing');

// ---- the planner (a browser identity) makes a set with a mark, a bike and a photo -------------------------------
const planner = await new Promise<DbConnection>((res, rej) => DbConnection.builder().withUri('wss://maincloud.spacetimedb.com').withDatabaseName(DB).onConnect(c => res(c)).onConnectError((_c, e) => rej(e)).build());
await new Promise<void>((res, rej) => planner.subscriptionBuilder().onApplied(() => res()).onError((c: any) => rej(new Error(c?.event?.message))).subscribe([
  'SELECT * FROM session', 'SELECT * FROM participant', 'SELECT * FROM scene_object', 'SELECT * FROM shot_version', 'SELECT * FROM channel_link', 'SELECT * FROM checkin', 'SELECT * FROM preview_job', 'SELECT * FROM message', 'SELECT * FROM photo', 'SELECT * FROM my_sessions']));
const title = `Photon e2e ${Date.now().toString(36)}`;
await planner.reducers.createSession({ spotId: 'nyc_dumbo', title, name: 'Ben' });
const s = (await until(() => [...planner.db.session.iter()].find(x => x.title === title)))!;
const sid = s.id;
const q = cameraQuat(MARK.heading, 0, 0);
await planner.reducers.addSceneObject({ sessionId: sid, kind: 'camera', assetId: '', name: 'Shot camera', x: MARK.x, y: MARK.y, z: 1.6, ...q, scale: 1, color: '', intensity: 0, lightType: '', params: 'shot=1;f35=35', visible: true });
await planner.reducers.addSceneObject({ sessionId: sid, kind: 'model', assetId: 'bicycle', name: 'Red bike', x: 2, y: 9, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, scale: 1, color: '#c0392b', intensity: 0, lightType: '', params: '', visible: true });
const photoBytes = readFileSync(join(REPO, 'design/assets/dumbo-photo-d0481.jpg'));
const up: any = await (await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: photoBytes })).json();
await planner.reducers.addPhoto({ sessionId: sid, spotId: '', url: up.url, thumb: up.thumb, width: up.width, height: up.height, pinLat: undefined, pinLon: undefined, exifF35: 35, source: 'web' });
const photo = (await until(() => [...planner.db.photo.iter()].find(p => p.sessionId === sid)))!;
check('planner set: shot camera at the mark, a red bike and a photo', !!photo, `session ${s.code}`);

const reply = async (spaceId: string, after: number, re: RegExp, ms = 60_000) => until(() => photon.sentTo(spaceId).slice(after).find(m => re.test(textOf(m.content))), ms);
const links = () => [...planner.db.channelLink.iter()].filter(l => l.sessionId === sid);

// ---- 1. one live set, everyone on their own channel ----------------------------------------------------------------
const maya = photon.inbound({ platform: 'imessage', handle: '+14695550101', text: `JOIN ${s.code}`, displayName: 'Maya' });
const joined = await reply(maya.spaceId, 0, /You're in/);
check('iMessage: "JOIN code" puts Maya in the set and links her channel', !!joined && links().some(l => l.channel === 'imessage' && l.verified), textOf(joined?.content));

const inv = async (name: string, channel: string, address: string) => (await fetch(`${BASE}/api/photon/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: s.code, name, channel, address, by: 'Ben' }) })).json() as any;
const jun = await inv('Jun', 'email', 'jun@example.com');
const junSpace = photon.spaceOf('email', 'jun@example.com');
check('studio invite by email: outbound-first space and the invite with a scout link', jun.delivered && !!junSpace && /\/s\/\w+\?inv=/.test(textOf(photon.sentTo(junSpace!.id)[0]?.content)), jun.note);
const theo = await inv('Theo', 'whatsapp', '+1 469 555 0133');
const theoSpace = photon.spaceOf('whatsapp_business', '+14695550133');
check('studio invite on WhatsApp Business: delivered to a new space', theo.delivered && !!theoSpace, theo.note);
const sam = await inv('Sam', 'telegram', '@sam_tg');
check('Telegram invite: a bot cannot speak first, so the inviter gets a t.me deep link', !sam.delivered && sam.shareText === `https://t.me/ShotMatchSetBot?start=${s.code}`, sam.note);
const samIn = photon.inbound({ platform: 'telegram', handle: 'sam_tg', text: `/start ${s.code}`, displayName: 'Sam' });
check('Telegram: /start code from the deep link joins the set', !!(await reply(samIn.spaceId, 0, /You're in/)) && links().filter(l => l.channel === 'telegram').length === 1);
const imsgInvite = await inv('Ana', 'imessage', '+14695550155');
check('iMessage invite: the shared line cannot text first, so Ana gets a JOIN text to forward', !imsgInvite.delivered && /JOIN [A-Z2-9]{6}/.test(imsgInvite.shareText ?? ''), imsgInvite.note);
const n0 = photon.sentTo(maya.spaceId).length;
photon.inbound({ platform: 'imessage', handle: '+14695550101', text: 'add Priya +1 469 555 0144 on SMS' });
const priyaAck = await reply(maya.spaceId, n0, /Invited Priya on SMS/);
const priyaSpace = photon.spaceOf('sms', '+14695550144');
check('a text invite from iMessage: "add Priya ... on SMS"', !!priyaAck && !!priyaSpace && photon.sentTo(priyaSpace!.id).length === 1, textOf(priyaAck?.content));

// A render in the studio fans out to all five people, each in their channel's form, as version v1.
const marks = { maya: photon.sentTo(maya.spaceId).length, jun: photon.sentTo(junSpace!.id).length, theo: photon.sentTo(theoSpace!.id).length, sam: photon.sentTo(samIn.spaceId).length, priya: photon.sentTo(priyaSpace!.id).length };
await planner.reducers.requestPreview({ sessionId: sid, photoId: photo.id, instruction: 'warm golden hour light', f35: 35, people: 0, sunAzimuth: undefined, sunAltitude: undefined });
const v1 = await until(() => [...planner.db.shotVersion.iter()].find(v => v.sessionId === sid && v.label === 'v1'), 240_000);
await until(() => photon.sentTo(priyaSpace!.id).length > marks.priya && photon.sentTo(samIn.spaceId).length > marks.sam + 1, 60_000);
const got = (sp: string, from: number) => photon.sentTo(sp).slice(from);
const mayaV1 = got(maya.spaceId, marks.maya), junV1 = got(junSpace!.id, marks.jun), theoV1 = got(theoSpace!.id, marks.theo), samV1 = got(samIn.spaceId, marks.sam), priyaV1 = got(priyaSpace!.id, marks.priya);
check('render recorded as version v1', !!v1 && !!v1.imageUrl, v1?.imageUrl);
check('iMessage gets the render image plus one line', mayaV1[0]?.content.type === 'attachment' && /^v1: .*Reply to this to change it/.test(textOf(mayaV1[1]?.content)), textOf(mayaV1[1]?.content));
check('email gets one designed message: Markdown body, the image attached, a subject', junV1[0]?.content.type === 'group' && junV1[0].content.parts[0].format === 'markdown' && junV1[0].content.parts.some((p: any) => p.type === 'attachment') && /^Tessera v1/.test(junV1[0].email?.subject ?? ''), junV1[0]?.email?.subject);
check('WhatsApp gets the image, then the line with the live set link', theoV1[0]?.content.type === 'attachment' && /v1: .*\/p\//.test(textOf(theoV1[1]?.content)));
check('Telegram gets an album of lens options (exact crops) with a caption', samV1[0]?.content.type === 'group' && samV1[0].content.parts.length === 3 && /35 mm, 50 mm, 85 mm/.test(textOf(samV1[0].content)), textOf(samV1[0]?.content));
check('SMS gets text plus a link to the image', priyaV1.length === 1 && /^Tessera v1: .* See it: http/.test(textOf(priyaV1[0].content)), textOf(priyaV1[0]?.content));
check('outbound messages are mirrored into the session', [...planner.db.message.iter()].filter(m => m.sessionId === sid && m.direction === 'out').length >= 8);

// ---- 4. the thread is the version tree: reply to v1 forks the set -------------------------------------------------
const bike0 = [...planner.db.sceneObject.iter()].find(o => o.sessionId === sid && o.name === 'Red bike')!;
const mayaV1Text = mayaV1[1];
const n1 = photon.sentTo(maya.spaceId).length, j1 = photon.sentTo(junSpace!.id).length;
const fork = photon.inbound({ platform: 'imessage', handle: '+14695550101', text: 'move the red bike to the left side of the frame', parentMessageId: mayaV1Text.id });
const forkReply = await reply(maya.spaceId, n1, /^v1\.1 \(from v1\)/, 300_000);
const v11 = [...planner.db.shotVersion.iter()].find(v => v.sessionId === sid && v.label === 'v1.1');
const bike1 = [...planner.db.sceneObject.iter()].find(o => o.id === bike0.id)!;
check('reply to v1 forks: v1.1 under v1, the bike moved, a threaded render back', !!forkReply && v11?.parentVersionId === v1!.id && !!v11?.imageUrl && forkReply.parentMessageId === fork.messageId && bike1.x !== bike0.x,
  `${textOf(forkReply?.content)} | bike x ${bike0.x.toFixed(1)} -> ${bike1.x.toFixed(1)}`);
const forkImg = photon.sentTo(maya.spaceId).slice(n1).filter(m => m.content.type === 'attachment').length;
check('the fork reply carries the image once; the others get v1.1 by fan-out', forkImg === 1 && !!(await until(() => photon.sentTo(junSpace!.id).slice(j1).find(m => /v1\.1/.test(textOf(m.content))), 30_000)));
const n2 = photon.sentTo(maya.spaceId).length;
photon.inbound({ platform: 'imessage', handle: '+14695550101', text: 'versions' });
const tree = await reply(maya.spaceId, n2, /└ v1\.1/);
check('"versions" lists the tree', !!tree && /^v1 · /.test(textOf(tree.content)), textOf(tree?.content));

// ---- 3. check in by photo -----------------------------------------------------------------------------------------
const n3 = photon.sentTo(maya.spaceId).length;
photon.inbound({ platform: 'imessage', handle: '+14695550101', image: photoBytes });
const ci = await reply(maya.spaceId, n3, /east of the mark/, 120_000);
const ciRow = [...planner.db.checkin.iter()].find(c => c.sessionId === sid);
check('check-in photo: solved against the mark, correction texted back', !!ci && /3\.2 m east of the mark and facing 14 degrees too far left/.test(textOf(ci.content)), textOf(ci?.content));
check('check-in is a row with the position for the set marker', !!ciRow && Math.abs(ciRow.x - 3.2) < 0.2 && ciRow.verdict === 'close' && ciRow.name === 'Maya', `x ${ciRow?.x.toFixed(2)}, ${ciRow?.verdict}`);

// ---- photo of an object becomes a prop -------------------------------------------------------------------------
const lamp = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768"><rect width="768" height="768" fill="#f2f0eb"/><rect x="364" y="300" width="40" height="330" fill="#2b2b2b"/><ellipse cx="384" cy="640" rx="130" ry="26" fill="#2b2b2b"/><path d="M250 300 L518 300 L460 150 L308 150 Z" fill="#e8b04a"/></svg>`)).jpeg().toBuffer();
const n4 = photon.sentTo(maya.spaceId).length, objs = [...planner.db.sceneObject.iter()].filter(o => o.sessionId === sid).length;
photon.inbound({ platform: 'imessage', handle: '+14695550101', image: lamp, text: 'add this lamp to the set' });
const ack = await reply(maya.spaceId, n4, /^Turning .* into a 3D prop/, 60_000);
check('object photo: classified as an object and acknowledged at once', !!ack, textOf(ack?.content));
const propDone = reply(maya.spaceId, n4, /^Added .* to the set|couldn't turn/, 420_000); // TRELLIS runs while the voice steps go on

// ---- 2. call the set: guidance from the live phone pose, edits by voice, framing after hang-up -------------------
const theoJoin = await new Promise<DbConnection>((res, rej) => DbConnection.builder().withUri('wss://maincloud.spacetimedb.com').withDatabaseName(DB).onConnect(c => res(c)).onConnectError((_c, e) => rej(e)).build());
await new Promise<void>(res => theoJoin.subscriptionBuilder().onApplied(() => res()).subscribe(['SELECT * FROM participant']));
await theoJoin.reducers.joinSession({ code: s.code, name: 'Theo', role: 'scout' });
const theoP = (await until(() => [...theoJoin.db.participant.iter()].find(p => p.sessionId === sid && p.identity.toHexString() === theoJoin.identity!.toHexString())))!;
const token = /inv=([\w-]+)/.exec(textOf(photon.sentTo(theoSpace!.id)[0].content))![1];
const claimed: any = await (await fetch(`${BASE}/api/photon/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, participantId: String(theoP.id) }) })).json();
check('invite link claimed: Theo\'s WhatsApp link now points at his scout page participant', claimed.ok && links().some(l => l.channel === 'whatsapp' && l.participantId === theoP.id), claimed.note);
const at12 = llOf(spot, 0, -12);
await theoJoin.reducers.pushDevicePose({ sessionId: sid, lat: at12.lat, lon: at12.lon, accuracyM: 4, heading: 26 });
await sleep(1500);
const tool = async (name: string, args: object) => (await fetch(`${BASE}/api/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shotmatch-tool-secret': toolSecret }, body: JSON.stringify({ caller: '+14695550133', ...args }) })).json() as any;
console.log('crew view of the set:', JSON.stringify(await (await fetch(`${BASE}/api/photon/people?code=${s.code}`)).json()));
const g = await tool('guide_me', {});
check('voice guide_me: one turn-by-turn instruction from Theo\'s live phone', g.say === 'Turn left 26 degrees, then walk 12 m north.', g.say);
const xBefore = [...planner.db.sceneObject.iter()].find(o => o.id === bike0.id)!.x;
const e = await tool('edit_set', { instruction: 'move the red bike to the right side of the frame' });
const bike2 = await until(() => { const b = [...planner.db.sceneObject.iter()].find(o => o.id === bike0.id); return b && Math.abs(b.x - xBefore) > 0.5 ? b : undefined; }, 30_000);
check('voice edit_set: the set changes live for the planner', !!bike2, `${e.say} | bike x ${xBefore.toFixed(1)} -> ${bike2?.x.toFixed(1)}`);
const t0 = photon.sentTo(theoSpace!.id).length;
photon.callEnded('+14695550133');
const framing = await until(() => photon.sentTo(theoSpace!.id).slice(t0).find(m => /After your call/.test(textOf(m.content))), 30_000);
check('call.ended: the final framing and latest render go to Theo\'s WhatsApp', !!framing && photon.sentTo(theoSpace!.id).slice(t0).some(m => m.content.type === 'attachment'), textOf(framing?.content));

// ---- 5. messages at the moment of the shot, on the channel that allows it ---------------------------------------
await inv('Maya', 'email', 'maya@example.com'); // Maya's second channel
const at300 = llOf(spot, 0, -300);
await theoJoin.reducers.pushDevicePose({ sessionId: sid, lat: at300.lat, lon: at300.lon, accuracyM: 5, heading: 0 });
photon.refuse.set(maya.spaceId, 'SHARED_LINE_INBOUND_REQUIRED'); // the shared line refuses a late message
const mayaMail = () => photon.spaceOf('email', 'maya@example.com');
const before = { mail: photon.sentTo(mayaMail()!.id).length, theo: photon.sentTo(theoSpace!.id).length };
await planner.reducers.scheduleReminder({ sessionId: sid, atMicros: BigInt(Date.now() + 4000) * 1000n, text: 'Golden hour starts in 20 min.' });
const theoAlert = await until(() => photon.sentTo(theoSpace!.id).slice(before.theo).find(m => /Golden hour/.test(textOf(m.content))), 60_000);
const mayaAlert = await until(() => photon.sentTo(mayaMail()!.id).slice(before.mail).find(m => /Golden hour/.test(textOf(m.content))), 30_000);
check('alert with live distance: "You\'re 300 m away, about 4 min on foot."', !!theoAlert && /You're 300 m away, about 4 min on foot\./.test(textOf(theoAlert.content)), textOf(theoAlert?.content));
check('iMessage refused the late alert, so Maya got it by email', !!mayaAlert && !photon.sentTo(maya.spaceId).some(m => /Golden hour/.test(textOf(m.content))), textOf(mayaAlert?.content));
photon.refuse.delete(maya.spaceId);

const prop = await propDone;
check('photo of an object becomes a 3D prop in the set (TRELLIS)', !!prop && /^Added/.test(textOf(prop.content)) && [...planner.db.sceneObject.iter()].filter(o => o.sessionId === sid).length > objs, textOf(prop?.content));

await planner.reducers.deleteSession({ sessionId: sid }).catch(() => {});
await stop();
