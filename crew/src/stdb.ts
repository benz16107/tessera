import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DbConnection, tables } from './module_bindings/index.ts';
import { DB_NAME, SECRETS, SPACETIME_HOST, loadSpots, secret } from './config.ts';

let resolveReady: () => void;
/** Resolves once the crew identity is registered and the first subscription has been applied. */
export const ready = new Promise<void>(r => (resolveReady = r));
let registered = false, applied = false;
const check = () => { if (registered && applied) resolveReady(); };

const spotSig = new Map<string, string>();
/** Upserts every spot.json under spots/ whose contents changed since the last call. */
export async function syncSpots() {
  for (const s of loadSpots()) {
    const row = { id: s.id, name: s.name, lat: s.lat, lon: s.lon, radiusM: s.radius_m, cameras: s.cameras ?? 0, modelVersion: String(s.model_version ?? '') };
    const sig = JSON.stringify(row);
    if (spotSig.get(s.id) === sig) continue;
    if (![row.lat, row.lon, row.radiusM].every(Number.isFinite)) {
      console.log(`spot ${s.id}: spot.json has no lat/lon/radius_m yet (model still building?); will retry`);
      spotSig.set(s.id, sig); // say it once per change of the file
      continue;
    }
    try { await conn.reducers.upsertSpot(row); spotSig.set(s.id, sig); console.log(`spot ${s.id} upserted`); }
    catch (e) { console.warn(`upsertSpot ${s.id}: ${(e as Error).message}`); }
  }
}

export const conn: DbConnection = DbConnection.builder()
  .withUri(SPACETIME_HOST)
  .withDatabaseName(DB_NAME)
  .withToken(secret('crew_token') ?? undefined)
  .withAutomaticReconnect()
  .onConnect(async (c, identity, token) => {
    mkdirSync(SECRETS, { recursive: true });
    writeFileSync(join(SECRETS, 'crew_token'), token, { mode: 0o600 });
    console.log(`connected to ${DB_NAME} as ${identity.toHexString().slice(0, 16)}…`);
    const code = secret('crew_code');
    if (!code) { console.error('no ~/.config/shotmatch/crew_code; cannot become the crew identity'); return; }
    try { await c.reducers.registerCrew({ code }); } catch (e) { console.error(`registerCrew failed: ${(e as Error).message}`); return; }
    registered = true; check();
    spotSig.clear();
    await syncSpots();
  })
  .onDisconnect((_ctx, err, next, delay) => console.warn(`disconnected${err ? `: ${err.message}` : ''}${next !== undefined ? `; retry ${next} in ${delay} ms` : ''}`))
  .onConnectError((_ctx, err) => console.error(`connect error: ${err.message}`))
  .build();

conn.subscriptionBuilder()
  .onApplied(() => { applied = true; check(); })
  .onError(ctx => console.error(`subscription error: ${(ctx as any).event?.message ?? 'unknown'}`))
  .subscribe([tables.solveJob, tables.previewJob, tables.solveResult, tables.spot, tables.photo, tables.session, tables.devicePose, tables.camera, tables.person, tables.outbox, tables.reminder,
    tables.sceneObject, tables.shotSettings, tables.message, tables.participant,
    tables.channelLink, tables.shotVersion, tables.checkin, tables.sceneChange, tables.toast]);

/** Polls the client cache until fn returns a value, or throws after timeoutMs. */
export async function until<T>(fn: () => T | undefined | null | false, timeoutMs: number, what: string): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 400));
  }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
/** One row in agent_step. Never throws: a trace write must not break the job it describes. */
export async function logStep(sessionId: bigint, tool: string, args: string, result: string, ms: number) {
  console.log(`[${sessionId}] ${tool}(${clip(args, 120)}) -> ${clip(result, 160)} ${ms} ms`);
  try { await conn.reducers.logAgentStep({ sessionId, tool, args: clip(args, 1900), result: clip(result, 3900), ms: Math.round(ms) }); }
  catch (e) { console.warn(`logAgentStep: ${(e as Error).message}`); }
}

/** Runs fn as a logged step; the summary function turns its value into the result text. */
export async function step<T>(sessionId: bigint, tool: string, args: string, fn: () => Promise<T>, summary: (v: T) => string): Promise<T> {
  const t0 = Date.now();
  try {
    const v = await fn();
    await logStep(sessionId, tool, args, summary(v), Date.now() - t0);
    return v;
  } catch (e) {
    await logStep(sessionId, tool, args, `error: ${(e as Error).message}`, Date.now() - t0);
    throw e;
  }
}
