// Shoot-day route: the session's solved shot plus a few similar viewpoints, each with a light window,
// visited in an order cuOpt picks (time windows, walking times at 1.3 m/s, 10 min per shot).
import SunCalc from 'suncalc';
import { metres, compassWord } from './geo.ts';
import { relativeAngle } from './geo.ts';
import { sunAt, fmtTime } from './sun.ts';

export const WALK_MS = 1.3, SERVICE_MIN = 10;
const PAD_MS = 15 * 60_000;
export const CUOPT_URL = 'https://optimize.api.nvidia.com/v1/nvidia/cuopt';

export type Viewpoint = { name: string; lat: number; lon: number; heading: number; f35: number; credit?: string; url?: string };
export type Stop = Viewpoint & { light: string; window: [Date, Date] };

/** Golden and blue hour for one period (the morning or evening of `day`) at a place. */
export function periodWindows(lat: number, lon: number, day: Date, period: 'morning' | 'evening') {
  const t = SunCalc.getTimes(day, lat, lon);
  return period === 'evening'
    ? { golden: [t.goldenHour, t.sunset] as [Date, Date], blue: [t.sunset, t.dusk] as [Date, Date] }
    : { blue: [t.dawn, t.sunrise] as [Date, Date], golden: [t.sunrise, t.goldenHourEnd] as [Date, Date] };
}

/** Front-lit or side-lit views get golden hour; views into the sun get blue hour, when the sky is even and lights come on. */
export function chooseLight(v: Viewpoint, day: Date, period: 'morning' | 'evening'): Stop {
  const w = periodWindows(v.lat, v.lon, day, period);
  const mid = new Date((w.golden[0].getTime() + w.golden[1].getTime()) / 2);
  const rel = relativeAngle(sunAt(mid, v.lat, v.lon).az, v.heading);
  // The light stays usable a little either side of the window, so each window gets 15 minutes of slack.
  const pad = (x: [Date, Date]): [Date, Date] => [new Date(x[0].getTime() - PAD_MS), new Date(x[1].getTime() + PAD_MS)];
  if (Math.abs(rel) < 60) return { ...v, light: 'blue hour (golden-hour sun would be in frame)', window: pad(w.blue) };
  return { ...v, light: Math.abs(rel) > 120 ? 'golden hour, sun behind you' : `golden hour, sun from the ${rel < 0 ? 'left' : 'right'}`, window: pad(w.golden) };
}

/** Walking minutes between every pair of stops. */
export const walkMatrix = (stops: { lat: number; lon: number }[]) =>
  stops.map(a => stops.map(b => Math.round((metres(a.lat, a.lon, b.lat, b.lon) / WALK_MS / 60) * 10) / 10));

/** cuOpt routing payload, in minutes from t0. Location 0 is the first stop, where the walker starts; no return trip. */
export function cuoptPayload(stops: Stop[], t0: Date) {
  const m = (d: Date) => Math.max(0, Math.round((d.getTime() - t0.getTime()) / 60_000));
  const matrix = walkMatrix(stops);
  const horizon = Math.max(...stops.map(s => m(s.window[1]))) + 60;
  return {
    cost_matrix_data: { data: { '0': matrix } },
    travel_time_matrix_data: { data: { '0': matrix } },
    fleet_data: { vehicle_locations: [[0, 0]], vehicle_time_windows: [[0, horizon]], drop_return_trips: [true] },
    // a shot inside its window needs the start of the window to leave SERVICE_MIN before it closes
    task_data: {
      task_locations: stops.map((_, i) => i),
      task_time_windows: stops.map(s => [m(s.window[0]), Math.max(m(s.window[0]), m(s.window[1]) - SERVICE_MIN)]),
      service_times: stops.map(() => SERVICE_MIN),
    },
    solver_config: { time_limit: 2 },
  };
}

export type RouteStop = { order: number; name: string; lat: number; lon: number; heading: number; face: string; f35: number; arrive: string; light: string; walk_min: number; credit?: string; url?: string };

/** Reads cuOpt's answer back into ordered stops. Throws when cuOpt reports no solution. */
export function readRoute(resp: any, stops: Stop[], t0: Date, lat: number, lon: number) {
  const sr = resp?.response?.solver_response;
  if (!sr || sr.status !== 0) throw new Error(`cuOpt found no route: ${JSON.stringify(resp?.response ?? resp).slice(0, 200)}`);
  const v = sr.vehicle_data['0'], matrix = walkMatrix(stops);
  const out: RouteStop[] = [];
  let prev = 0;
  v.task_id.forEach((id: string, i: number) => {
    if (id === 'Depot' || id === 'Break') return;
    const s = stops[Number(id)];
    out.push({
      order: out.length + 1, name: s.name, lat: s.lat, lon: s.lon, heading: Math.round(s.heading), face: compassWord(s.heading), f35: Math.round(s.f35),
      arrive: fmtTime(new Date(t0.getTime() + v.arrival_stamp[i] * 60_000), lat, lon), light: s.light,
      walk_min: Math.round(matrix[prev][v.route[i]]), credit: s.credit, url: s.url,
    });
    prev = v.route[i];
  });
  const dropped = (sr.dropped_tasks?.task_index ?? []).map((i: number) => stops[i].name);
  return { stops: out, dropped, cost_min: sr.solution_cost };
}
