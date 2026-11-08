// Load test: N headless clients join one session and each drags its own object at RATE Hz for SECS seconds, the way
// the studio's gizmo does (lock, updateSceneObject per frame, unlock). Measures, from this machine to Maincloud:
//   round trip: reducer call until the server acknowledges the committed transaction (the promise resolves)
//   fan-out: reducer call until a *different* client sees the row change in its subscription
// All clients run in one process, so both use the same clock. Run: node scripts/loadtest.ts [db] [clients] [hz] [secs]
import { DbConnection } from './module_bindings/index.ts';

const DB = process.argv[2] ?? 'shotmatch';
const N = Number(process.argv[3] ?? 3), RATE = Number(process.argv[4] ?? 10), SECS = Number(process.argv[5] ?? 30);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const connect = () => new Promise<DbConnection>((res, rej) => DbConnection.builder().withUri('wss://maincloud.spacetimedb.com').withDatabaseName(DB)
  .onConnect(c => res(c)).onConnectError((_c, e) => rej(e)).build());
const sub = (c: DbConnection, q: string[]) => new Promise<void>((res, rej) => c.subscriptionBuilder().onApplied(() => res()).onError((x: any) => rej(new Error(x?.event?.message))).subscribe(q));
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const OBJ = { kind: 'model', assetId: 'cube', name: '', x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, scale: 1, color: '#888', intensity: 0, lightType: '', params: '', visible: true };

const clients = await Promise.all(Array.from({ length: N }, connect));
const [host] = clients;
await host.reducers.createSession({ spotId: 'nyc_dumbo', title: `load test ${new Date().toISOString().slice(11, 19)}`, name: 'load-0' });
await sub(host, ['SELECT * FROM my_sessions']);
for (let i = 0; i < 100 && !host.db.mySessions.count(); i++) await sleep(100);
const s = [...host.db.mySessions.iter()].sort((a, b) => Number(b.id - a.id))[0];
for (const [i, c] of clients.entries()) if (i) await c.reducers.joinSession({ code: s.code, name: `load-${i}`, role: 'planner' });
await Promise.all(clients.map(c => sub(c, [`SELECT * FROM scene_object WHERE session_id = ${s.id}`])));

// One object per client.
const ids: bigint[] = [];
for (const [i, c] of clients.entries()) {
  await c.reducers.addSceneObject({ sessionId: s.id, ...OBJ, name: `cube-${i}`, x: i * 2 });
  for (let k = 0; k < 100 && !ids[i]; k++) { ids[i] = [...c.db.sceneObject.iter()].find(o => o.name === `cube-${i}`)?.id as bigint; await sleep(50); }
  await c.reducers.lockSceneObject({ id: ids[i], lock: true });
}

// sent[objectIndex][seq] = send time; the x coordinate encodes seq so observers can match updates exactly.
const sent: Map<number, number>[] = clients.map(() => new Map());
const rtt: number[] = [], fanout: number[] = [];
let errors = 0, done = 0;
for (const [obsIdx, c] of clients.entries())
  c.db.sceneObject.onUpdate((_ctx, _old, row) => {
    const owner = ids.indexOf(row.id);
    if (owner < 0 || owner === obsIdx) return;
    const seq = Math.round((row.x - owner * 2) * 1000);
    const t0 = sent[owner].get(seq);
    if (t0 !== undefined) fanout.push(performance.now() - t0);
  });

const total = RATE * SECS;
const start = performance.now();
await Promise.all(clients.map(async (c, i) => {
  for (let seq = 1; seq <= total; seq++) {
    const due = start + (seq * 1000) / RATE;
    const wait = due - performance.now();
    if (wait > 0) await sleep(wait);
    const t0 = performance.now();
    sent[i].set(seq, t0);
    c.reducers.updateSceneObject({ id: ids[i], sessionId: s.id, ...OBJ, name: `cube-${i}`, x: i * 2 + seq / 1000, y: Math.sin(seq / 10) })
      .then(() => { rtt.push(performance.now() - t0); done++; })
      .catch(() => { errors++; });
  }
}));
await sleep(3000);
const wall = (performance.now() - start) / 1000;
for (const [i, c] of clients.entries()) await c.reducers.lockSceneObject({ id: ids[i], lock: false }).catch(() => {});
const history = await new Promise<number>(res => host.subscriptionBuilder().onApplied(() => res([...host.db.sceneChange.iter()].filter(x => x.sessionId === s.id).length)).subscribe([`SELECT * FROM scene_change WHERE session_id = ${s.id}`]));

const f = (x: number) => x.toFixed(0).padStart(4);
console.log(`\n${DB} on Maincloud: ${N} clients x ${RATE} Hz x ${SECS} s = ${N * total} updateSceneObject calls (${(N * total / SECS).toFixed(0)}/s sent)`);
console.log(`committed ${done}, failed ${errors}, wall ${wall.toFixed(1)} s, throughput ${(done / wall).toFixed(1)} tx/s`);
console.log(`round trip (call -> commit ack), ms:   p50 ${f(pct(rtt, 50))}  p95 ${f(pct(rtt, 95))}  p99 ${f(pct(rtt, 99))}  max ${f(Math.max(...rtt))}`);
console.log(`fan-out (call -> other client sees it), ms: p50 ${f(pct(fanout, 50))}  p95 ${f(pct(fanout, 95))}  p99 ${f(pct(fanout, 99))}  (${fanout.length} deliveries, expected ${N * (N - 1) * total})`);
console.log(`scene history rows for ${N * total} edits: ${history} (drags fold into one entry each)`);
await host.reducers.deleteSession({ sessionId: s.id }).catch(e => console.log('cleanup failed:', e?.message));
process.exit(errors ? 1 : 0);
