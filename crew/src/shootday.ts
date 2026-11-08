// Builds a shoot-day route for a session and solves the visit order with NVIDIA cuOpt (hosted).
import SunCalc from 'suncalc';
import { conn, logStep } from './stdb.ts';
import { secret } from './config.ts';
import { localPath } from './images.ts';
import { similar, spotPhoto, type Hit } from './similar.ts';
import { sunWindows } from './sun.ts';
import { relativeAngle } from './geo.ts';
import { CUOPT_URL, chooseLight, cuoptPayload, readRoute, type Viewpoint } from './route.ts';

/** Up to n photos, best score first, each pointing at least 30 degrees away from those already picked. */
export function diverse(hits: Hit[], n: number, taken: number[]): Hit[] {
  const out: Hit[] = [];
  for (const h of hits) {
    if (out.length >= n) break;
    if ([...taken, ...out.map(o => o.pose.heading)].every(t => Math.abs(relativeAngle(h.pose.heading, t)) >= 30)) out.push(h);
  }
  return out;
}

export async function planShootDay(sessionId: bigint, shots?: string[]) {
  const photos = [...conn.db.photo.sessionId.filter(sessionId)].sort((a, b) => Number(b.id - a.id));
  const photo = photos.find(p => { const r = conn.db.solveResult.photoId.find(p.id); return r && r.confidence !== 'none'; });
  if (!photo) throw new Error('this session has no placed photo yet');
  const r = conn.db.solveResult.photoId.find(photo.id)!, spotId = conn.db.solveJob.id.find(r.jobId)?.spotId ?? '';
  const base: Viewpoint = { name: 'your shot', lat: r.pose.lat, lon: r.pose.lon, heading: r.pose.heading, f35: r.pose.f35 };

  let picks: Hit[];
  if (shots?.length) {
    picks = (await Promise.all(shots.slice(0, 5).map(s => { const [sp, f] = s.includes('/') ? s.split('/') : [spotId, s]; return spotPhoto(sp, f); })))
      .filter((h): h is Hit => !!h);
  } else {
    const path = localPath(photo.url);
    picks = path ? diverse(await similar({ imagePath: path, spot: spotId || undefined, k: 200 }), 5, [base.heading]) : [];
  }
  const views: Viewpoint[] = [base, ...picks.map(h => ({ name: h.file, lat: h.pose.lat, lon: h.pose.lon, heading: h.pose.heading, f35: h.pose.f35, credit: h.credit, url: h.url }))];

  // The shoot happens in the period of the plan time if one is set, else the next golden hour at the solved shot.
  const session = conn.db.session.id.find(sessionId);
  const anchor = session?.planTime ? new Date(Number(session.planTime.microsSinceUnixEpoch / 1000n)) : sunWindows(base.lat, base.lon, base.heading).golden?.start ?? new Date();
  const period = anchor < SunCalc.getTimes(anchor, base.lat, base.lon).solarNoon ? 'morning' : 'evening';
  const stops = views.map(v => chooseLight(v, anchor, period));
  const t0 = new Date(Math.min(...stops.map(s => s.window[0].getTime())) - 30 * 60_000);

  const key = secret('nvidia_key');
  if (!key) throw new Error('cuOpt needs the NVIDIA key');
  // Each attempt is a real cuOpt solve. When the windows cannot all be met, the lowest-ranked viewpoint is left out and
  // cuOpt solves again; the reply names what was left out.
  const dropped: string[] = [];
  for (;;) {
    const t0 = new Date(Math.min(...stops.map(s => s.window[0].getTime())) - 30 * 60_000);
    const started = Date.now();
    const res = await fetch(CUOPT_URL, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(cuoptPayload(stops, t0)), signal: AbortSignal.timeout(60_000),
    }).catch(e => { throw new Error(`cuOpt unreachable: ${e.message}`); });
    const resp: any = await res.json().catch(() => ({}));
    const args = `${stops.length} viewpoints, ${period}, 10 min per shot, walking 1.3 m/s`;
    if (!res.ok) {
      await logStep(sessionId, 'cuopt_route', args, `error: HTTP ${res.status}`, Date.now() - started);
      throw new Error(`cuOpt HTTP ${res.status}: ${JSON.stringify(resp).slice(0, 200)}`);
    }
    if (resp?.response?.solver_infeasible_response && stops.length > 1) {
      const out = stops.pop()!;
      dropped.push(out.name);
      await logStep(sessionId, 'cuopt_route', args, `infeasible; leaving out ${out.name} and solving again`, Date.now() - started);
      continue;
    }
    try {
      const route = readRoute(resp, stops, t0, base.lat, base.lon);
      route.dropped.push(...dropped);
      await logStep(sessionId, 'cuopt_route', args,
        `${route.stops.map(s => `${s.order}. ${s.name} ${s.arrive}`).join('; ')}${route.dropped.length ? `; won't fit: ${route.dropped.join(', ')}` : ''}`, Date.now() - started);
      return { period, date: anchor.toISOString().slice(0, 10), walk_speed_mps: 1.3, minutes_per_shot: 10, solver: 'NVIDIA cuOpt', ...route };
    } catch (e) {
      await logStep(sessionId, 'cuopt_route', args, `error: ${(e as Error).message}`, Date.now() - started);
      throw e;
    }
  }
}
