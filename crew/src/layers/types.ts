// GeoJSON as the layers send it: WGS84 [lon, lat], one FeatureCollection per layer, with display properties the 3D set,
// the 2D map and the AI read the same way.
import type { LonLat } from './geom.ts';

export type Geometry =
  | { type: 'Point'; coordinates: LonLat }
  | { type: 'LineString'; coordinates: LonLat[] }
  | { type: 'Polygon'; coordinates: LonLat[][] }
  | { type: 'MultiPolygon'; coordinates: LonLat[][][] };

export interface Props {
  layer: string;
  kind: string; // e.g. 'nws_alert', 'film_permit', 'sidewalk_shed', 'building', 'cafe', 'photo'
  label: string; // short, for a map label or a 3D tag
  detail?: string;
  start?: string; // ISO times when the feature is time-bound
  end?: string;
  active?: boolean; // in force now or within the next three days
  severity?: 'info' | 'minor' | 'moderate' | 'severe';
  height_m?: number;
  heading?: number;
  url?: string;
  [k: string]: unknown;
}

export interface Feature { type: 'Feature'; geometry: Geometry | null; properties: Props }
export interface FC { type: 'FeatureCollection'; features: Feature[] }
export const fc = (features: Feature[]): FC => ({ type: 'FeatureCollection', features });

export interface Place { id: string; name: string; lat: number; lon: number; radiusM: number; zone: string }

/** What one source contributed: shown on the credits list and in the response's `sources`. */
export interface Source { layer: string; name: string; url: string; license: string; fetchedAt: number | null; stale?: boolean; error?: string }

export interface LayerOut<S = unknown> { geojson: FC; summary: S; sources: Source[] }

/** A local date-time string in a time zone (Socrata's "2026-11-07T07:00:00.000", NOAA's "2026-11-08 05:59") as a UTC Date. */
export function zonedToDate(local: string, zone: string): Date {
  const guess = Date.parse(local.replace(' ', 'T').replace(/\.\d+$/, '') + 'Z');
  const off = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  const first = guess - off(guess);
  return new Date(guess - off(first)); // second pass settles a time next to a DST change
}

export const fmtIn = (zone: string) => (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(d);
export const dayIn = (zone: string) => (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(d);
export const dateIn = (zone: string) => (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric' }).format(d);
