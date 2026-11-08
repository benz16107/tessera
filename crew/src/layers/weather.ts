// Weather for the shot: Open-Meteo's hourly forecast (no key, CC BY 4.0) and its air-quality model (CAMS) for haze.
import SunCalc from 'suncalc';
import { cached, getJson, TTL, at4 } from './cache.ts';
import { colorChance, hazeReading, type ColorChance, type Haze } from './score.ts';
import { fc, type LayerOut, type Place, type Source } from './types.ts';

export interface Hour {
  t: string; cloud: number; low: number; mid: number; high: number; visKm: number; rainPct: number; rainMm: number;
  windMph: number; gustMph: number; windDir: number; tempF: number; rh: number; code: number; pm25: number | null; aod: number | null;
}
export interface SunEvent { kind: 'sunrise' | 'sunset'; t: string; hour: string; chance: ColorChance }
export interface WeatherSummary { hours: Hour[]; events: SunEvent[]; now: Hour | null; haze: Haze | null; sky: string }

const VARS = 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,relative_humidity_2m,weather_code';

/** WMO weather codes, in words a photographer cares about. */
export function skyWords(code: number) {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code >= 85 && code <= 86) return 'snow showers';
  if (code >= 95) return 'thunderstorms';
  return 'unsettled';
}

export const nearestHour = (hours: Hour[], at: Date) =>
  hours.reduce<Hour | null>((b, h) => (!b || Math.abs(Date.parse(h.t) - at.getTime()) < Math.abs(Date.parse(b.t) - at.getTime()) ? h : b), null);

export async function weatherLayer(p: Place, at: Date): Promise<LayerOut<WeatherSummary>> {
  const q = `latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}&timezone=GMT&past_days=1&forecast_days=3`;
  const fUrl = `https://api.open-meteo.com/v1/forecast?${q}&hourly=${VARS}&wind_speed_unit=mph&temperature_unit=fahrenheit`;
  const aUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=pm2_5,aerosol_optical_depth`;
  const [f, a] = await Promise.all([
    cached(`weather-${at4(p.lat, p.lon)}`, TTL.weather, () => getJson(fUrl)),
    cached(`air-${at4(p.lat, p.lon)}`, TTL.weather, () => getJson(aUrl)).catch(e => ({ data: null, fetchedAt: 0, stale: true, error: (e as Error).message })),
  ]);
  const h = f.data.hourly, aq = a.data?.hourly;
  const aqAt = new Map<string, number>((aq?.time ?? []).map((t: string, i: number) => [t, i]));
  const hours: Hour[] = h.time.map((t: string, i: number) => {
    const j = aqAt.get(t);
    return {
      t: `${t}:00Z`, cloud: h.cloud_cover[i], low: h.cloud_cover_low[i], mid: h.cloud_cover_mid[i], high: h.cloud_cover_high[i],
      visKm: Math.round((h.visibility[i] ?? 0) / 100) / 10, rainPct: h.precipitation_probability[i] ?? 0, rainMm: h.precipitation[i] ?? 0,
      windMph: Math.round(h.wind_speed_10m[i]), gustMph: Math.round(h.wind_gusts_10m[i] ?? 0), windDir: h.wind_direction_10m[i],
      tempF: Math.round(h.temperature_2m[i]), rh: h.relative_humidity_2m[i], code: h.weather_code[i],
      pm25: j !== undefined ? aq.pm2_5[j] : null, aod: j !== undefined ? aq.aerosol_optical_depth[j] : null,
    };
  });
  // Colour chance at each sunrise and sunset the forecast covers, scored at the nearest hour.
  const events: SunEvent[] = [];
  const first = Date.parse(hours[0]?.t ?? ''), last = Date.parse(hours.at(-1)?.t ?? '');
  for (let d = first; d <= last + 86_400_000; d += 86_400_000) {
    const tt = SunCalc.getTimes(new Date(d + 12 * 3_600_000), p.lat, p.lon);
    for (const [kind, t] of [['sunrise', tt.sunrise], ['sunset', tt.sunset]] as const) {
      if (isNaN(t.getTime()) || t.getTime() < first || t.getTime() > last || events.some(e => e.kind === kind && Math.abs(Date.parse(e.t) - t.getTime()) < 3_600_000)) continue;
      const hr = nearestHour(hours, t)!;
      events.push({ kind, t: t.toISOString(), hour: hr.t, chance: colorChance({ low: hr.low, mid: hr.mid, high: hr.high, precip: hr.rainPct, aod: hr.aod ?? 0 }) });
    }
  }
  events.sort((x, y) => Date.parse(x.t) - Date.parse(y.t));
  const now = nearestHour(hours, at);
  const haze = now ? hazeReading(now.pm25, now.aod) : null;
  const sources: Source[] = [
    { layer: 'weather', name: 'Open-Meteo forecast', url: 'https://open-meteo.com/', license: 'CC BY 4.0', fetchedAt: f.fetchedAt, stale: f.stale, error: f.error },
    { layer: 'weather', name: 'Open-Meteo air quality (CAMS)', url: 'https://open-meteo.com/en/docs/air-quality-api', license: 'CC BY 4.0; CAMS data from Copernicus', fetchedAt: a.fetchedAt || null, stale: a.stale, error: a.error },
  ];
  const geojson = fc(now ? [{
    type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { layer: 'weather', kind: 'forecast', label: `${now.tempF}°F, ${skyWords(now.code)}, wind ${now.windMph} mph`, detail: `cloud low ${now.low}% mid ${now.mid}% high ${now.high}%, visibility ${now.visKm} km`, start: now.t },
  }] : []);
  return { geojson, summary: { hours, events, now, haze, sky: now ? skyWords(now.code) : '' }, sources };
}
