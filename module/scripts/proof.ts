// End-to-end proof of the SpacetimeDB features against a live database (default: the scratch database shotmatch-scratch).
// Two fresh anonymous identities (Maya and Jun) and one crew identity:
//   row-level security, the session_card view, per-user and anonymous views, presence, set events (never stored),
//   scene history with undo and restore, the live sun schedule, the render row, sharing to shotmatch-library through
//   the outbox (onResult), the HTTP routes, the signed ElevenLabs webhook, and the Nemotron title procedure.
// Run: node scripts/proof.ts [db]    (crew steps need the owner's CLI login to set a crew code)
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { Identity, Timestamp } from 'spacetimedb';
import { DbConnection, type EventContext } from './module_bindings/index.ts';

const DB = process.argv[2] ?? 'shotmatch-scratch';
// registerCrew would take the crew role from the real worker, so crew steps run only on scratch databases.
const PROD = DB === 'shotmatch';
const reqId = randomBytes(6).toString('hex');
const HOST = 'wss://maincloud.spacetimedb.com';
const HTTP = `https://maincloud.spacetimedb.com/v1/database/${DB}/route`;
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push([name, ok, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | null | false, ms = 15_000): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return undefined; await sleep(100); }
}
const cli = (...args: string[]) => execFileSync('spacetime', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function connect(label: string): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder().withUri(HOST).withDatabaseName(DB)
      .onConnect(c => { console.log(`${label} connected as ${c.identity!.toHexString().slice(0, 12)}…`); resolve(c); })
      .onConnectError((_c, e) => reject(e)).build();
  });
}
const subscribe = (c: DbConnection, q: string[]) => new Promise<void>((res, rej) =>
  c.subscriptionBuilder().onApplied(() => res()).onError((ctx: any) => rej(new Error(ctx?.event?.message ?? 'subscription error'))).subscribe(q));

const SESSION_Q = ['SELECT * FROM session', 'SELECT * FROM participant', 'SELECT * FROM scene_object', 'SELECT * FROM scene_change',
  'SELECT * FROM presence', 'SELECT * FROM set_event', 'SELECT * FROM activity', 'SELECT * FROM preview_job', 'SELECT * FROM sun_clock',
  'SELECT * FROM toast', 'SELECT * FROM my_sessions', 'SELECT * FROM my_scene_locks', 'SELECT * FROM live_sessions', 'SELECT * FROM prop_library',
  'SELECT * FROM shot_library', 'SELECT * FROM spot_library', 'SELECT * FROM agent_step', 'SELECT * FROM shot_version',
  'SELECT * FROM channel_link', 'SELECT * FROM checkin', 'SELECT * FROM layer_toggle', 'SELECT * FROM layer_snapshot'];
const OBJ = { kind: 'model', assetId: 'bicycle', name: 'Red bike', x: 1, y: 2, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, scale: 1, color: '#c33', intensity: 0, lightType: '', params: '', visible: true };

const maya = await connect('Maya'), jun = await connect('Jun');
const seenByJun: string[] = [];
await subscribe(maya, SESSION_Q);
await subscribe(jun, SESSION_Q);
jun.db.setEvent.onInsert((_c: EventContext, e) => seenByJun.push(`${e.kind}:${e.name}`));

// 1. Maya makes a session; Jun, not a participant, sees none of it.
await maya.reducers.createSession({ spotId: 'nyc_dumbo', title: 'New shoot', name: 'Maya' });
const s = await until(() => [...maya.db.mySessions.iter()][0]);
check('my_sessions view returns the new session to its owner', !!s, s?.code);
if (!s) process.exit(1);
await maya.reducers.addSceneObject({ sessionId: s.id, ...OBJ });
const obj = await until(() => [...maya.db.sceneObject.iter()].find(o => o.sessionId === s.id));
await maya.reducers.setLayerToggle({ sessionId: s.id, layer: 'weather', on: true });
await sleep(800);
const leak = [...jun.db.session.iter()].some(x => x.id === s.id) || [...jun.db.sceneObject.iter()].some(o => o.sessionId === s.id)
  || [...jun.db.participant.iter()].some(p => p.sessionId === s.id) || [...jun.db.sceneChange.iter()].some(c => c.sessionId === s.id)
  || [...jun.db.layerToggle.iter()].some(c => c.sessionId === s.id);
check('RLS: a non-participant sees no session, participant, object or history rows', !leak && !!obj,
  `Jun sees ${jun.db.session.count()} sessions, ${jun.db.sceneObject.count()} objects`);

// 2. The code is the capability: session_card(code) shows Jun the card, then joinSession opens the rows.
await subscribe(jun, [`SELECT * FROM session_card('${s.code}')`]);
const card = await until(() => [...jun.db.sessionCard.iter()].find(c => c.code === s.code));
check('session_card(code) view: the code shows the card to anyone', !!card, card ? `"${card.title}", ${card.objects} object(s), ${card.online} online` : '');
await jun.reducers.joinSession({ code: s.code, name: 'Jun', role: 'planner' });
const junSees = await until(() => [...jun.db.sceneObject.iter()].find(o => o.sessionId === s.id));
const tog = await until(() => [...jun.db.layerToggle.iter()].find(x => x.sessionId === s.id && x.layer === 'weather' && x.on));
check('layer_toggle: Maya\'s weather layer reaches Jun once he joins; layer_snapshot is public', !!tog && [...jun.db.layerSnapshot.iter()].some(x => x.spotId === 'nyc_dumbo'), `${jun.db.layerSnapshot.count()} snapshots visible`);
check('RLS: after joining, Jun sees the session and its objects', !!junSees && [...jun.db.session.iter()].some(x => x.id === s.id),
  `${[...jun.db.participant.iter()].filter(p => p.sessionId === s.id).length} participants visible`);

// 2a. Naming an untitled shoot: any member while it is untitled, then only the owner.
await jun.reducers.renameSession({ sessionId: s.id, title: 'Palace of Fine Arts, San Francisco' });
const renamed = await until(() => maya.db.session.id.find(s.id)?.title === 'Palace of Fine Arts, San Francisco' || undefined);
let renameErr = '';
await jun.reducers.renameSession({ sessionId: s.id, title: 'Something else' }).catch(e => { renameErr = String(e?.message ?? e); });
check('renameSession: a member names an untitled shoot, then only the owner can rename it', !!renamed && /only the owner/.test(renameErr), renameErr);
await maya.reducers.renameSession({ sessionId: s.id, title: 'New shoot' }); // back to a default so the Nemotron title check below still runs

// 2b. A scout never heartbeats: joining and pushing poses keep them in presence.
const scout = await connect('Theo (scout)');
await scout.reducers.joinSession({ code: s.code, name: 'Theo', role: 'scout' });
await scout.reducers.pushDevicePose({ sessionId: s.id, lat: 40.7033, lon: -73.9894, accuracyM: 5, heading: 10 });
const scoutPres = await until(() => [...jun.db.presence.iter()].find(p => p.sessionId === s.id && p.name === 'Theo'));
check('a scout appears in presence from joining and pushing poses (no heartbeat)', scoutPres?.status === 'active', scoutPres ? `${scoutPres.name} ${scoutPres.status}` : 'missing');
scout.disconnect();

// 3. Presence and set events.
await maya.reducers.heartbeat({ sessionId: s.id, focusObjectId: obj!.id });
const pres = await until(() => [...jun.db.presence.iter()].find(p => p.name === 'Maya'));
check('presence: Maya\'s heartbeat reaches Jun with her color and selection', !!pres, pres ? `${pres.status}, ${pres.color}, object ${pres.focusObjectId}` : '');
const live = await until(() => [...jun.db.liveSessions.iter()].find(l => l.sessionId === s.id && l.online >= 2));
check('live_sessions anonymous view counts people online', !!live, live ? `${live.online} online, ${live.planners} planners` : '');
await maya.reducers.sendSetEvent({ sessionId: s.id, kind: 'ping', x: 1, y: 2, z: 0.5, tx: 0, ty: 0, tz: 0, objectId: obj!.id, target: undefined });
await maya.reducers.sendSetEvent({ sessionId: s.id, kind: 'cursor', x: 3, y: 1, z: 0, tx: 0, ty: 0, tz: 0, objectId: 0n, target: undefined });
await maya.reducers.sendSetEvent({ sessionId: s.id, kind: 'follow', x: 0, y: -8, z: 1.7, tx: 1, ty: 2, tz: 0.5, objectId: 0n, target: undefined });
await until(() => seenByJun.length >= 3, 5000);
check('set_event (event table): Jun receives Maya\'s ping, cursor and follow request', seenByJun.length >= 3, seenByJun.join(', '));
const burst = await Promise.allSettled(Array.from({ length: 12 }, () => maya.reducers.sendSetEvent({ sessionId: s.id, kind: 'ping', x: 1, y: 1, z: 0, tx: 0, ty: 0, tz: 0, objectId: 0n, target: undefined })));
const limited = burst.filter(r => r.status === 'rejected' && /rate_limited/.test(String((r as PromiseRejectedResult).reason?.message ?? r.reason))).length;
check('official Rate Limit submodule: a 12-ping burst is cut to the 8-per-10 s quota', limited >= 4, `${12 - limited} allowed, ${limited} rate-limited`);
const stored = cli('sql', '--server', 'maincloud', DB, 'SELECT COUNT(*) AS n FROM set_event');
check('set_event rows are never stored', /\b0\b/.test(stored.split('\n').slice(-2).join(' ')), stored.trim().split('\n').pop()?.trim());

// 4. Scene history: a drag folds into one entry; Jun undoes Maya's edit; restore time-travels the set.
await maya.reducers.lockSceneObject({ id: obj!.id, lock: true });
const locks = await until(() => [...maya.db.mySceneLocks.iter()].find(o => o.id === obj!.id));
check('my_scene_locks view shows the object Maya holds', !!locks);
let jErr = '';
await jun.reducers.updateSceneObject({ id: obj!.id, sessionId: s.id, ...OBJ, x: 9 }).catch(e => { jErr = String(e?.message ?? e); });
check('gizmo lock: Jun cannot move the object Maya holds', /someone else/.test(jErr), jErr);
for (const x of [1.5, 2, 2.5, 3]) { await maya.reducers.updateSceneObject({ id: obj!.id, sessionId: s.id, ...OBJ, x }); await sleep(100); }
await maya.reducers.lockSceneObject({ id: obj!.id, lock: false });
await sleep(500);
const changes = () => [...jun.db.sceneChange.iter()].filter(c => c.sessionId === s.id).sort((a, b) => Number(a.id - b.id));
const ups = changes().filter(c => c.action === 'update');
check('scene_change: a 4-step drag is one history entry with before and after', ups.length === 1 && JSON.parse(ups[0].before).x === 1 && JSON.parse(ups[0].after).x === 3,
  ups[0] ? `x ${JSON.parse(ups[0].before).x} -> ${JSON.parse(ups[0].after).x} by ${ups[0].byName}` : `${ups.length} entries`);
await jun.reducers.undoSceneChange({ changeId: ups[0].id });
const undone = await until(() => maya.db.sceneObject.id.find(obj!.id)?.x === 1 && maya.db.sceneObject.id.find(obj!.id));
check('undo by anyone: Jun undoes Maya\'s drag, the bike is back at x=1', !!undone);
const addId = changes().find(c => c.action === 'add')!.id;
await maya.reducers.restoreSceneTo({ sessionId: s.id, changeId: 0n });
const empty = await until(() => !maya.db.sceneObject.id.find(obj!.id), 5000);
await maya.reducers.restoreSceneTo({ sessionId: s.id, changeId: addId });
const back = await until(() => maya.db.sceneObject.id.find(obj!.id));
check('restoreSceneTo: empty set at change 0, bike back at its add', !!empty && !!back, `${changes().length} history rows, last: ${changes().at(-1)?.action}`);

// 4b. One shot camera per session, even when every tab races to make it, and restore leaves it alone.
const CAM = { ...OBJ, kind: 'camera', assetId: '', name: 'Cam A', x: 0, y: -10, z: 1.6 };
await Promise.all([maya, jun].flatMap((c, i) => [0, 1].map(k => c.reducers.addSceneObject({ sessionId: s.id, ...CAM, params: `uid=race${i}${k};shot=1` }))));
await sleep(800);
const cams = () => [...maya.db.sceneObject.iter()].filter(o => o.sessionId === s.id && o.kind === 'camera');
check('four racing "Cam A" adds from two people make one shot camera', cams().length === 1, `${cams().length} camera(s)`);
await maya.reducers.restoreSceneTo({ sessionId: s.id, changeId: 0n });
await sleep(800);
check('restore to the start keeps the shot camera', cams().length === 1 && ![...maya.db.sceneObject.iter()].some(o => o.id === obj!.id), `${cams().length} camera(s), bike ${maya.db.sceneObject.id.find(obj!.id) ? 'still there' : 'gone'}`);
await maya.reducers.restoreSceneTo({ sessionId: s.id, changeId: addId });
await until(() => maya.db.sceneObject.id.find(obj!.id));

// 4c. An automatic place title can be renamed by any member; a typed one stays the owner's.
const cam = cams()[0];
await maya.reducers.updateSceneObject({ id: cam.id, sessionId: s.id, ...CAM, params: `${cam.params};placed=search;place=Eiffel Tower, Paris` });
await maya.reducers.renameSession({ sessionId: s.id, title: 'Eiffel Tower, Paris' });
let autoErr = '';
await jun.reducers.renameSession({ sessionId: s.id, title: 'Arc de Triomphe, Paris' }).catch(e => { autoErr = String(e?.message ?? e); });
const moved = await until(() => maya.db.session.id.find(s.id)?.title === 'Arc de Triomphe, Paris' || undefined, 5000);
await maya.reducers.renameSession({ sessionId: s.id, title: 'Our anniversary shoot' });
let typedErr = '';
await jun.reducers.renameSession({ sessionId: s.id, title: 'Somewhere else' }).catch(e => { typedErr = String(e?.message ?? e); });
check('renameSession: a member may replace the automatic place title, not a typed one', !!moved && !autoErr && /only the owner/.test(typedErr), autoErr || typedErr);
await maya.reducers.renameSession({ sessionId: s.id, title: 'New shoot' }); // back to a default for the Nemotron check

// 5. Live sun: a per-session schedule moves session.planTime.
await maya.reducers.setSunClock({ sessionId: s.id, rate: 600 });
const t0 = maya.db.session.id.find(s.id)?.planTime?.microsSinceUnixEpoch ?? 0n;
await sleep(3200);
const t1 = maya.db.session.id.find(s.id)?.planTime?.microsSinceUnixEpoch ?? 0n;
await maya.reducers.setSunClock({ sessionId: s.id, rate: 0 });
const movedMin = Number(t1 - t0) / 60e6;
await maya.reducers.setSunClock({ sessionId: s.id, rate: 1 });
await until(() => [...maya.db.sunClock.iter()].some(c => c.sessionId === s.id));
await maya.reducers.setPlanTime({ sessionId: s.id, at: new Timestamp(BigInt(Date.UTC(2026, 10, 8, 21, 30)) * 1000n) });
const liveOff = await until(() => ![...maya.db.sunClock.iter()].some(c => c.sessionId === s.id) || undefined, 5000);
await sleep(2500);
const kept = maya.db.session.id.find(s.id)?.planTime?.toDate().toISOString();
check('a manual time turns Live sun off and stays put', !!liveOff && kept === '2026-11-08T21:30:00.000Z', kept);
check('sun_clock schedule: 600x time-lapse advances the set clock', movedMin >= 15 && movedMin <= 45, `${movedMin.toFixed(1)} set minutes in 3.2 s`);

// 6. Crew identity: owner sets a code, a third client registers, sees every session, joins as crew.
let shot: { shareCode: string } | undefined;
let crew!: DbConnection;
if (!PROD) {
const code = randomBytes(12).toString('hex');
cli('call', '--server', 'maincloud', DB, 'set_crew_code', JSON.stringify(code));
crew = await connect('crew');
await crew.reducers.registerCrew({ code });
await subscribe(crew, ['SELECT * FROM session', 'SELECT * FROM preview_job', 'SELECT * FROM solve_job']);
check('RLS: the crew identity sees every session', [...crew.db.session.iter()].some(x => x.id === s.id), `${crew.db.session.count()} sessions`);
await crew.reducers.joinSessionAsCrew({ sessionId: s.id, name: 'ShotMatch' });
check('joinSessionAsCrew: crew is a participant', !!(await until(() => [...maya.db.participant.iter()].find(p => p.sessionId === s.id && p.role === 'crew'))));

// 7. Render row (preview_job kind=render) and sharing through the inter-database outbox.
await crew.reducers.startRender({ sessionId: s.id, photoId: 0n, requestId: reqId, instruction: 'golden hour, two friends', f35: 35, people: 2, sunAzimuth: undefined, sunAltitude: undefined });
const job = await until(() => [...crew.db.previewJob.iter()].find(j => j.requestId === reqId));
check('startRender: a running preview_job with kind=render, found by requestId', job?.kind === 'render' && job.state === 'running');
await crew.reducers.finishPreview({ jobId: job!.id, ok: true, imageUrl: '/preview/proof.jpg', error: '' });
await maya.reducers.moveCamera({ sessionId: s.id, pose: { lat: 40.7033, lon: -73.9894, alt: 1.6, heading: 4, pitch: 2, roll: 0, f35: 53 } });
await maya.reducers.shareShot({ sessionId: s.id, previewJobId: job!.id });
shot = await until(() => [...jun.db.shotLibrary.iter()].find(x => x.sessionId === s.id), 30_000);
check('IDC: shareShot -> publish_shot_outbox -> shotmatch-library -> onResult -> shot_library view', !!shot, shot?.shareCode);
const lib = cli('sql', '--server', 'maincloud', 'shotmatch-library', `SELECT share_code, title FROM shot WHERE share_code = '${shot?.shareCode}'`);
check('the shot row exists in the shotmatch-library database', !!shot && lib.includes(shot.shareCode));
const propUrl = `https://example.com/proof-${reqId}.glb`;
await maya.reducers.addSceneObject({ sessionId: s.id, ...OBJ, kind: 'prop_generated', assetId: propUrl, name: 'Proof lantern', params: 'prompt=a brass lantern' });
const prop = await until(() => [...jun.db.propLibrary.iter()].find(p => p.assetUrl === propUrl), 30_000);
check('IDC: a generated prop lands in every session\'s prop_library', !!prop, prop?.name);

// 7b. Photon tables: a thread as a version tree over scene history, channel links, check-ins.
const sid = s.id, bike = obj!.id;
const V = () => [...jun.db.shotVersion.iter()].filter(v => v.sessionId === sid).sort((a, b) => Number(a.id - b.id));
await crew.reducers.recordShotVersion({ sessionId: sid, parentVersionId: undefined, label: '', externalMessageId: 'msg_1', channel: 'imessage', imageUrl: '/preview/v1.jpg', sceneChangeId: undefined });
const v1 = await until(() => V().find(v => v.label === 'v1'));
await maya.reducers.updateSceneObject({ id: bike, sessionId: sid, ...OBJ, x: 7 });
await sleep(2200); // past the 2 s drag fold, so v2 is its own history entry
await crew.reducers.recordShotVersion({ sessionId: sid, parentVersionId: v1!.id, label: '', externalMessageId: 'msg_2', channel: 'imessage', imageUrl: '/preview/v2.jpg', sceneChangeId: undefined });
const v2 = await until(() => V().find(v => v.label === 'v2'));
check('recordShotVersion: v1 then v2, each pinned to a scene_change id', !!v1 && !!v2 && v2.sceneChangeId > v1.sceneChangeId, `v1@${v1?.sceneChangeId} v2@${v2?.sceneChangeId}`);
await jun.reducers.restoreToVersion({ versionId: v1!.id, channel: 'imessage', externalMessageId: 'msg_3' });
const fork = await until(() => V().find(v => v.label === 'v1.1'));
const bikeX = await until(() => maya.db.sceneObject.id.find(bike)?.x === 1 || undefined);
await crew.reducers.updateShotVersion({ id: fork!.id, imageUrl: '/preview/v1.1.jpg', sceneChangeId: undefined });
const forkImg = await until(() => jun.db.shotVersion.id.find(fork!.id)?.imageUrl === '/preview/v1.1.jpg' || undefined);
check('updateShotVersion: the fork gets its render later, scene change kept', !!forkImg && jun.db.shotVersion.id.find(fork!.id)?.sceneChangeId === fork!.sceneChangeId);
check('restoreToVersion forks: set back to v1, new branch v1.1 under v1', !!fork && fork.parentVersionId === v1!.id && !!bikeX, fork ? `${fork.label} parent ${fork.parentVersionId}` : '');
await maya.reducers.addChannelLink({ sessionId: sid, channel: 'imessage', address: '+15555550100', participantId: undefined, name: undefined });
await crew.reducers.addChannelLink({ sessionId: sid, channel: 'whatsapp', address: '+15555550199', participantId: 0n, name: 'Theo' });
const inv = await until(() => [...jun.db.channelLink.iter()].find(l => l.sessionId === sid && l.channel === 'whatsapp'));
check('channel_link invite: the crew links Theo before he has an identity (participantId 0)', inv?.participantId === 0n && inv.name === 'Theo' && inv.identity.isEqual(Identity.zero()));
const junP = [...jun.db.participant.iter()].find(p => p.sessionId === sid && p.name === 'Jun')!;
await crew.reducers.addChannelLink({ sessionId: sid, channel: 'whatsapp', address: '+15555550199', participantId: junP.id, name: undefined });
const claimed = await until(() => { const l = jun.db.channelLink.id.find(inv!.id); return l && l.participantId === junP.id ? l : undefined; });
check('channel_link invite claimed: same row gets the real participant, name kept', !!claimed && claimed.name === 'Theo' && claimed.identity.isEqual(jun.identity!));
const link = await until(() => [...jun.db.channelLink.iter()].find(l => l.sessionId === sid));
await crew.reducers.markChannelVerified({ id: link!.id, verified: true });
const verified = await until(() => jun.db.channelLink.id.find(link!.id)?.verified || undefined);
check('channel_link: Maya links iMessage, the crew verifies it, Jun (a member) sees it', !!verified);
const toastsJun: string[] = [];
jun.db.toast.onInsert((_c, x) => toastsJun.push(x.text));
const mayaP = [...jun.db.participant.iter()].find(p => p.sessionId === sid && p.name === 'Maya')!;
await crew.reducers.recordCheckin({ sessionId: sid, participantId: mayaP.id, photoId: 0n, distanceM: 2.4, headingErrDeg: -6, verdict: 'on the mark', x: 1.5, y: -3, heading: 8, imageUrl: '/photo/ck.jpg', name: undefined });
await crew.reducers.recordCheckin({ sessionId: sid, participantId: 0n, photoId: 0n, distanceM: 9, headingErrDeg: 20, verdict: 'too far left', x: -6, y: 1, heading: 30, imageUrl: undefined, name: 'Theo' });
const theo = await until(() => [...jun.db.checkin.iter()].find(c => c.sessionId === sid && c.name === 'Theo'));
await until(() => toastsJun.some(t => t.startsWith('Theo checked in')), 5000);
check('recordCheckin by name for a text-only scout (participantId 0), with position', !!theo && theo.x === -6 && toastsJun.some(t => t.startsWith('Theo checked in')));
const ck = await until(() => [...jun.db.checkin.iter()].find(c => c.sessionId === sid));
await until(() => toastsJun.some(t => t.includes('checked in')), 5000);
check('recordCheckin: row plus a toast to every member', !!ck && toastsJun.some(t => t.includes('checked in')), toastsJun.find(t => t.includes('checked in')));
} else console.log('skip  crew, render, share, prop and Photon steps on production');

// 8. HTTP handlers.
const h = await (await fetch(`${HTTP}/health`)).json();
check('GET /health', h.ok === true, JSON.stringify(h));
const sj = shot ? await fetch(`${HTTP}/shot?code=${shot.shareCode}`) : null;
const sjBody = sj ? await sj.json() : null;
if (shot) check('GET /shot?code=<share code> returns public JSON', sj?.status === 200 && sjBody?.camera?.f35mm === 53, sjBody ? `${sjBody.title}, ${sjBody.camera.f35mm} mm` : '');
check('GET /shot with an unknown code is 404', (await fetch(`${HTTP}/shot?code=ZZZZZZZZ`)).status === 404);
const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
if (secret) {
  const body = JSON.stringify({ type: 'post_call_transcription', data: { conversation_id: `conv_proof_${reqId}`, transcript: [
    { role: 'agent', message: 'Hi, this is the ShotMatch guide.' }, { role: 'user', message: 'Where do I stand for the bridge shot?' }],
    metadata: { call_duration_secs: 42 }, conversation_initiation_client_data: { dynamic_variables: { session_code: s.code } } } });
  const ts = Math.floor(Date.now() / 1000);
  const sig = `t=${ts},v0=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
  const bad = await fetch(`${HTTP}/hooks/elevenlabs`, { method: 'POST', body, headers: { 'elevenlabs-signature': sig.replace(/.$/, c => (c === '0' ? '1' : '0')) } });
  check('POST /hooks/elevenlabs rejects a bad signature', bad.status === 401);
  const ok = await fetch(`${HTTP}/hooks/elevenlabs`, { method: 'POST', body, headers: { 'elevenlabs-signature': sig } });
  const okBody = await ok.json();
  await subscribe(jun, ['SELECT * FROM message']);
  const msgs = await until(() => [...jun.db.message.iter()].filter(m => m.sessionId === s.id && m.channel === 'voice').length >= 2 || undefined);
  check('POST /hooks/elevenlabs with a valid signature writes the transcript rows', ok.status === 200 && !!msgs, JSON.stringify(okBody));
  const again = await (await fetch(`${HTTP}/hooks/elevenlabs`, { method: 'POST', body, headers: { 'elevenlabs-signature': sig } })).json();
  check('webhook retry is a no-op (keyed by conversation_id)', again.duplicate === true);
  // A real phone call carries no session code: the caller's number is matched against channel_link.
  const phone = `+1555${String(Date.now()).slice(-7)}`;
  await maya.reducers.addChannelLink({ sessionId: s.id, channel: 'voice', address: phone, participantId: undefined, name: undefined });
  await sleep(500);
  const body2 = JSON.stringify({ type: 'post_call_transcription', data: { conversation_id: `conv_phone_${reqId}`, transcript: [{ role: 'user', message: 'Calling from my phone.' }],
    conversation_initiation_client_data: { dynamic_variables: { system__caller_id: phone.replace('+1', '') } } } });
  const sig2 = `t=${ts},v0=${createHmac('sha256', secret).update(`${ts}.${body2}`).digest('hex')}`;
  const byPhone = await (await fetch(`${HTTP}/hooks/elevenlabs`, { method: 'POST', body: body2, headers: { 'elevenlabs-signature': sig2 } })).json();
  check('webhook finds the session from the caller\'s number (channel_link)', byPhone.session === s.code, JSON.stringify(byPhone));
} else console.log('skip  webhook (set ELEVENLABS_WEBHOOK_SECRET to test it)');

if (!PROD) {
// 9. Procedure with outbound HTTP: crew finishes a solve, the schedule runs title_session, Nemotron names the shoot.
cli('call', '--server', 'maincloud', DB, '--', 'upsert_spot', '"nyc_dumbo"', '"Manhattan Bridge from Washington Street, DUMBO"', '40.7033', '-73.9894', '150', '127', '"proof"');
await maya.reducers.addPhoto({ sessionId: s.id, spotId: 'nyc_dumbo', url: '/photo/proof.jpg', thumb: '', width: 1280, height: 960, pinLat: undefined, pinLon: undefined, exifF35: undefined, source: 'web' });
const sj2 = await until(() => [...crew.db.solveJob.iter()].find(j => j.sessionId === s.id && j.state === 'queued'));
await crew.reducers.claimJob({ jobId: sj2!.id });
await crew.reducers.finishJob({ jobId: sj2!.id, ok: true, error: '', pose: { lat: 40.7033, lon: -73.9894, alt: 1.6, heading: 4, pitch: 2, roll: 0, f35: 53 }, inliers: 1690, confidence: 'solid', reason: 'proof', lensReadF35: undefined, secs: 1 });
const titled = await until(() => { const x = maya.db.session.id.find(s.id); return x && x.title !== 'New shoot' ? x : undefined; }, 30_000);
const stepRow = [...maya.db.agentStep.iter()].find(a => a.sessionId === s.id && a.tool.startsWith('nemotron_lightning'));
check('title_session procedure: Nemotron 3.5 Lightning titled the shoot from inside the database', !!titled, titled ? `"${titled.title}", ${stepRow?.ms ?? '?'} ms` : stepRow?.result);
}

// Clean up the scratch session.
await maya.reducers.deleteSession({ sessionId: s.id }).catch(() => {});
const failed = results.filter(r => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `; failed: ${failed.map(f => f[0]).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
