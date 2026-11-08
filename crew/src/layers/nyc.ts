// NYC extras from NYC Open Data (Socrata, no key): what would block or change a shot on the block.
// Film permits (Mayor's Office of Media and Entertainment), permitted events and parades (Street Activity Permit Office),
// DOT street closures for construction, DOB sidewalk sheds, scaffolds and construction fences, and the city's building
// footprints with roof heights (shadow casters) and street centrelines (to map "X between A and B").
import { cached, getJson, TTL, at4 } from './cache.ts';
import { bufferLine, circle, metres, nearestOnLine, streetKey, toLonLat, toXY, type LonLat, type XY } from './geom.ts';
import { fc, dateIn, fmtIn, zonedToDate, type Feature, type LayerOut, type Place, type Source } from './types.ts';

const S = 'https://data.cityofnewyork.us/resource';
const NY = 'America/New_York';
const LICENSE = 'NYC Open Data, free to use (NYC Open Data terms of use)';

export const inNYC = (p: { lat: number; lon: number }) => p.lat > 40.49 && p.lat < 40.92 && p.lon > -74.27 && p.lon < -73.68;

const soql = (id: string, params: Record<string, string>) => `${S}/${id}.json?${new URLSearchParams(params).toString()}`;
const nyDate = (s?: string) => (s ? zonedToDate(s, NY) : null);

export interface Street { key: string; name: string; lines: LonLat[][] }
export interface Footprint { bin: string; name: string; h: number; ring: LonLat[]; year: number | null }

/** Street centrelines within `r` m, grouped by normalised name. */
export async function nycStreets(p: Place, r = 800): Promise<Street[]> {
  const got = await cached(`nyc-streets-${at4(p.lat, p.lon)}-${r}`, TTL.permits, () => getJson(soql('inkn-q76z', {
    $where: `within_circle(the_geom, ${p.lat}, ${p.lon}, ${r})`, $select: 'full_street_name,the_geom', $limit: '5000',
  })));
  const by = new Map<string, Street>();
  for (const row of got.data as any[]) {
    const name = String(row.full_street_name ?? '').trim();
    if (!name || !row.the_geom) continue;
    const key = streetKey(name);
    const s = by.get(key) ?? { key, name, lines: [] };
    s.lines.push(...(row.the_geom.type === 'MultiLineString' ? row.the_geom.coordinates : [row.the_geom.coordinates]));
    by.set(key, s);
  }
  return [...by.values()];
}

/** Building footprints with roof heights (feet in the data, metres here) within `r` m. */
export async function nycFootprints(p: Place, r = 350): Promise<{ list: Footprint[]; fetchedAt: number; stale: boolean; error?: string }> {
  const got = await cached(`nyc-buildings-${at4(p.lat, p.lon)}-${r}`, TTL.osm, () => getJson(soql('5zhs-2jue', {
    $where: `within_circle(the_geom, ${p.lat}, ${p.lon}, ${r})`, $select: 'bin,name,height_roof,construction_year,the_geom', $limit: '5000',
  })));
  const list = (got.data as any[]).filter(b => b.the_geom?.coordinates?.length && Number(b.height_roof) > 0).map(b => ({
    bin: String(b.bin ?? ''), name: String(b.name ?? ''), h: Math.round(Number(b.height_roof) * 0.3048 * 10) / 10,
    ring: (b.the_geom.type === 'MultiPolygon' ? b.the_geom.coordinates[0][0] : b.the_geom.coordinates[0]) as LonLat[],
    year: Number(b.construction_year) || null,
  }));
  return { list, fetchedAt: got.fetchedAt, stale: got.stale, error: got.error };
}

/** "WASHINGTON STREET between FRONT STREET and WATER STREET, FRONT STREET between ..." as [on, from, to] triples. */
export function parseSegments(text: string): [string, string, string][] {
  return text.split(/,\s*/).map(s => /^\s*(.+?)\s+between\s+(.+?)\s+and\s+(.+?)\s*$/i.exec(s)).filter((m): m is RegExpExecArray => !!m).map(m => [m[1], m[2], m[3]]);
}

/** Where two named streets meet: the closest approach between their centrelines, if under 25 m. */
function meet(o: Place, a: Street, b: Street): XY | null {
  let best: { d: number; q: XY } | null = null;
  for (const la of a.lines) {
    const xa = la.map(c => toXY(o, c));
    for (const lb of b.lines) for (const c of lb) {
      const n = nearestOnLine(toXY(o, c), xa);
      if (!best || n.d < best.d) best = n;
    }
  }
  return best && best.d < 25 ? best.q : null;
}

/** The block of `on` between `from` and `to`, as a straight line between the two corners. */
export function locateBlock(o: Place, streets: Street[], on: string, from: string, to: string): LonLat[] | null {
  const find = (n: string) => streets.find(s => s.key === streetKey(n));
  const s = find(on), a = find(from), b = find(to);
  if (!s || !a || !b) return null;
  const pa = meet(o, s, a), pb = meet(o, s, b);
  // shortcut: a straight line corner to corner; blocks that bend would need the centreline between the corners.
  return pa && pb ? [toLonLat(o, pa), toLonLat(o, pb)] : null;
}

const near = (o: Place, line: LonLat[], r: number) => line.some(c => metres(o, { lon: c[0], lat: c[1] }) < r);
/** Metres from the spot to the nearest point of a block line. */
const lineMetres = (o: Place, line: LonLat[]) => Math.round(nearestOnLine([0, 0], line.map(c => toXY(o, c))).d);

/** Film permits (365 days, newest first) and permitted events (next 7 days) on blocks within 800 m, as block areas. */
export async function filmLayer(p: Place, at: Date, streets: Street[], borough: string | null): Promise<LayerOut<{ active: number; history: number; newestRecord: string | null; note: string }>> {
  const fmt = fmtIn(NY), day = dateIn(NY);
  const nearStreets = streets.map(s => ({ s, d: Math.min(...s.lines.flatMap(l => l.map(c => metres(p, { lon: c[0], lat: c[1] })))) }))
    .filter(x => x.d < 300 && /\b(ST|AVE|PL|PLZ|BLVD|RD|DR|LN|CT|TER|HTS)\b/.test(x.s.key)).sort((a, b) => a.d - b.d).slice(0, 10).map(x => x.s);
  const likes = nearStreets.map(s => `upper(parkingheld) like '%${s.key.replace(/\s+(ST|AVE|PL|PLZ|BLVD|RD|DR|LN|CT|TER|HTS)$/, '').replace(/'/g, "''").replace(/\s+/g, '%')}%BETWEEN%'`);
  const since = new Date(at.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  const film = likes.length ? await cached(`nyc-film-${at4(p.lat, p.lon)}`, TTL.permits, () => getJson(soql('tg4x-b46p', {
    $where: `startdatetime > '${since}'${borough ? ` AND borough='${borough}'` : ''} AND (${likes.join(' OR ')})`, $order: 'startdatetime DESC', $limit: '1000',
  }), { timeoutMs: 40_000 })) : null;
  const newest = await cached('nyc-film-newest', TTL.permits, () => getJson(soql('tg4x-b46p', { $select: 'max(startdatetime) as m' })));
  const evLikes = likes.map(l => l.replace('parkingheld', 'event_location'));
  const weekOut = new Date(at.getTime() + 7 * 86_400_000).toISOString().slice(0, 19);
  const nowS = new Date(Math.min(at.getTime(), Date.now())).toISOString().slice(0, 19);
  const events = evLikes.length ? await cached(`nyc-events-${at4(p.lat, p.lon)}`, TTL.permits, () => getJson(soql('tvpp-9vvx', {
    $where: `end_date_time > '${nowS}' AND start_date_time < '${weekOut}' AND event_type not in ('Sport - Youth','Sport - Adult')${borough ? ` AND event_borough='${borough}'` : ''} AND (${evLikes.join(' OR ')})`, $limit: '200',
  }), { timeoutMs: 40_000 })).catch(e => ({ data: [], fetchedAt: 0, stale: true, error: (e as Error).message })) : null;

  const feats: Feature[] = [];
  const blocks = new Map<string, { line: LonLat[]; label: string; items: { start: Date; end: Date; what: string; kind: string }[] }>();
  const add = (text: string, item: { start: Date; end: Date; what: string; kind: string }) => {
    for (const [on, from, to] of parseSegments(text)) {
      const line = locateBlock(p, streets, on, from, to);
      if (!line || !near(p, line, 800)) continue;
      const k = [streetKey(on), ...[streetKey(from), streetKey(to)].sort()].join('|');
      const label = `${titleCase(on)} between ${titleCase(from)} and ${titleCase(to)}`;
      const b = blocks.get(k) ?? { line, label, items: [] };
      b.items.push(item);
      blocks.set(k, b);
    }
  };
  for (const r of (film?.data ?? []) as any[]) {
    const start = nyDate(r.startdatetime), end = nyDate(r.enddatetime);
    if (start && end) add(String(r.parkingheld ?? ''), { start, end, what: [r.category, r.subcategoryname].filter((x: string) => x && x !== 'Not Applicable').join(', ') || 'film shoot', kind: 'film_permit' });
  }
  for (const r of (events?.data ?? []) as any[]) {
    const start = nyDate(r.start_date_time), end = nyDate(r.end_date_time);
    if (start && end) add(String(r.event_location ?? ''), { start, end, what: `${r.event_type}: ${r.event_name}${r.street_closure_type && r.street_closure_type !== 'N/A' ? ` (${r.street_closure_type})` : ''}`, kind: 'event_permit' });
  }
  // "Nov 8 7:00 AM to 11:00 AM", or "Oct 28 8:00 AM to Nov 15 10:00 PM" when it runs over days.
  const span = (a: Date, b: Date) => (day(a) === day(b) ? `${day(a)} ${fmt(a)} to ${fmt(b)}` : `${day(a)} ${fmt(a)} to ${day(b)} ${fmt(b)}`);
  let active = 0, history = 0;
  const soon = at.getTime() + 3 * 86_400_000;
  for (const b of blocks.values()) {
    const live = b.items.filter(i => i.end.getTime() >= Math.min(at.getTime(), Date.now()) && i.start.getTime() <= soon).sort((x, y) => x.start.getTime() - y.start.getTime());
    const past = b.items.filter(i => i.kind === 'film_permit' && !live.includes(i));
    const polys = bufferLine(b.line, 8);
    if (live.length) {
      active++;
      const i = live[0];
      feats.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polys.map(q => [q]) }, properties: {
        layer: 'film', kind: i.kind, label: `${i.kind === 'film_permit' ? 'Film crew' : i.what.split(':')[0]} ${span(i.start, i.end)}`,
        detail: `${b.label}: ${i.what}${live.length > 1 ? ` (+${live.length - 1} more)` : ''}`, start: i.start.toISOString(), end: i.end.toISOString(), active: true, severity: 'moderate', block: b.label, m: lineMetres(p, b.line) } });
    } else if (past.length) {
      history++;
      const last = past.reduce((x, y) => (x.start > y.start ? x : y));
      feats.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polys.map(q => [q]) }, properties: {
        layer: 'film', kind: 'film_history', label: `${past.length} film permit${past.length > 1 ? 's' : ''} in the last year`,
        detail: `${b.label}: last ${day(last.start)}${last.start.getFullYear() !== at.getFullYear() ? ` ${last.start.getFullYear()}` : ''} (${last.what})`, start: last.start.toISOString(), active: false, severity: 'info', count: past.length, block: b.label, m: lineMetres(p, b.line) } });
    }
  }
  const newestRecord = newest.data?.[0]?.m ?? null;
  const note = newestRecord ? `NYC publishes film permits with a lag; the newest record starts ${day(nyDate(newestRecord)!)}.` : '';
  const sources: Source[] = [
    { layer: 'film', name: "NYC film permits (Mayor's Office of Media and Entertainment)", url: 'https://data.cityofnewyork.us/d/tg4x-b46p', license: LICENSE, fetchedAt: film?.fetchedAt ?? null, stale: film?.stale, error: film?.error },
    { layer: 'film', name: 'NYC permitted events (Street Activity Permit Office)', url: 'https://data.cityofnewyork.us/d/tvpp-9vvx', license: LICENSE, fetchedAt: events?.fetchedAt || null, stale: events?.stale, error: events?.error },
  ];
  return { geojson: fc(feats), summary: { active, history, newestRecord, note }, sources };
}

/** DOT street closures for construction (by block and by intersection), in force now or within three days. */
export async function closuresLayer(p: Place, at: Date): Promise<LayerOut<{ count: number }>> {
  const day = dateIn(NY), now = new Date(Math.min(at.getTime(), Date.now())).toISOString().slice(0, 10);
  const where = `within_circle(the_geom, ${p.lat}, ${p.lon}, 600) AND work_end_date >= '${now}'`;
  const [blk, isx] = await Promise.all([
    cached(`nyc-closures-${at4(p.lat, p.lon)}`, TTL.permits, () => getJson(soql('i6b5-j7bu', { $where: where, $limit: '500' }))),
    cached(`nyc-closures-x-${at4(p.lat, p.lon)}`, TTL.permits, () => getJson(soql('478a-yykk', { $where: where, $limit: '200' }))).catch(e => ({ data: [], fetchedAt: 0, stale: true, error: (e as Error).message })),
  ]);
  const soon = at.getTime() + 3 * 86_400_000;
  const feats: Feature[] = [];
  const seen = new Set<string>();
  for (const r of [...blk.data, ...isx.data] as any[]) {
    const start = nyDate(r.work_start_date), end = nyDate(r.work_end_date);
    if (!start || !end || start.getTime() > soon || !r.the_geom) continue;
    const k = `${r.onstreetname}|${r.fromstreetname}|${r.tostreetname ?? ''}|${r.work_start_date}|${r.purpose}`;
    const lines: LonLat[][] = r.the_geom.type === 'MultiLineString' ? r.the_geom.coordinates : r.the_geom.type === 'LineString' ? [r.the_geom.coordinates] : [];
    const polys = r.the_geom.type === 'Point' ? [circle(r.the_geom.coordinates, 12)] : lines.flatMap(l => bufferLine(l, 6));
    if (!polys.length) continue;
    const where2 = r.tostreetname ? `${titleCase(r.onstreetname)}, ${titleCase(r.fromstreetname)} to ${titleCase(r.tostreetname)}` : `${titleCase(r.onstreetname)} at ${titleCase(r.fromstreetname)}`;
    const old = seen.has(k) ? feats.find(f => f.properties.key === k) : null;
    if (old && old.geometry?.type === 'MultiPolygon') { old.geometry.coordinates.push(...polys.map(q => [q])); continue; }
    seen.add(k);
    feats.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polys.map(q => [q]) }, properties: {
      layer: 'closures', kind: 'street_closure', label: `${titleCase(r.onstreetname)} closed until ${day(end)}`, detail: `${where2}: ${sentence(r.purpose)}`,
      start: start.toISOString(), end: end.toISOString(), active: true, severity: 'moderate', key: k, m: Math.min(...polys.flat().map(c => Math.round(metres(p, { lon: c[0], lat: c[1] })))) } });
  }
  return {
    geojson: fc(feats), summary: { count: feats.length },
    sources: [{ layer: 'closures', name: 'NYC DOT street closures for construction', url: 'https://data.cityofnewyork.us/d/i6b5-j7bu', license: LICENSE, fetchedAt: blk.fetchedAt, stale: blk.stale, error: blk.error }],
  };
}

const SCAFFOLD = ['Sidewalk Shed', 'Supported Scaffold', 'Suspended Scaffold', 'Construction Fence'];

/** DOB permits for sidewalk sheds, scaffolds and construction fences within 400 m, drawn on the building they wrap. */
export async function constructionLayer(p: Place, at: Date, footprints: Footprint[]): Promise<LayerOut<{ count: number; nearest: string | null }>> {
  const day = dateIn(NY), now = new Date(Math.min(at.getTime(), Date.now())).toISOString().slice(0, 10);
  const dLat = 400 / 111_320, dLon = 400 / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  const got = await cached(`nyc-dob-${at4(p.lat, p.lon)}`, TTL.permits, () => getJson(soql('rbx6-tga4', {
    $where: `latitude::number between ${p.lat - dLat} and ${p.lat + dLat} AND longitude::number between ${p.lon - dLon} and ${p.lon + dLon} AND expired_date >= '${now}' AND work_type in (${SCAFFOLD.map(w => `'${w}'`).join(',')})`,
    $select: 'house_no,street_name,work_type,issued_date,expired_date,latitude,longitude,bin,job_description,permit_status', $limit: '1000',
  }), { timeoutMs: 40_000 }));
  const byBin = new Map(footprints.map(f => [f.bin, f]));
  const sites = new Map<string, { addr: string; bin: string; lat: number; lon: number; types: Set<string>; until: Date; from: Date }>();
  for (const r of got.data as any[]) {
    const lat = Number(r.latitude), lon = Number(r.longitude), until = nyDate(r.expired_date), from = nyDate(r.issued_date);
    if (!Number.isFinite(lat) || !until || !from || from.getTime() > at.getTime() + 3 * 86_400_000) continue;
    const addr = `${r.house_no} ${titleCase(r.street_name)}`;
    const s = sites.get(addr) ?? { addr, bin: String(r.bin ?? ''), lat, lon, types: new Set<string>(), until, from };
    s.types.add(r.work_type);
    if (until > s.until) s.until = until;
    sites.set(addr, s);
  }
  const feats: Feature[] = [...sites.values()].map(s => {
    const f = byBin.get(s.bin);
    const kinds = [...s.types].sort((a, b) => SCAFFOLD.indexOf(a) - SCAFFOLD.indexOf(b));
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [f ? f.ring : circle([s.lon, s.lat], 8)] }, properties: {
      layer: 'construction', kind: kinds[0].toLowerCase().replace(/ /g, '_'), label: `${sentence(kinds.join(' and '))} at ${s.addr}`,
      detail: `DOB permit until ${day(s.until)}`, addr: s.addr,
      start: s.from.toISOString(), end: s.until.toISOString(), active: true, severity: kinds[0] === 'Construction Fence' ? 'minor' : 'moderate', height_m: f?.h, m: Math.round(metres(p, s)),
    } } satisfies Feature;
  }).sort((a, b) => Number(a.properties.m) - Number(b.properties.m));
  return {
    geojson: fc(feats), summary: { count: feats.length, nearest: feats[0] ? `${feats[0].properties.label} (${feats[0].properties.m} m)` : null },
    sources: [{ layer: 'construction', name: 'NYC DOB NOW approved permits', url: 'https://data.cityofnewyork.us/d/rbx6-tga4', license: LICENSE, fetchedAt: got.fetchedAt, stale: got.stale, error: got.error }],
  };
}

export const NYC_BUILDINGS_SOURCE = (fetchedAt: number | null, stale?: boolean, error?: string): Source => ({
  layer: 'buildings', name: 'NYC building footprints with roof heights (DoITT)', url: 'https://data.cityofnewyork.us/d/5zhs-2jue', license: LICENSE, fetchedAt, stale, error,
});

const KEEP_UPPER = new Set(['NYC', 'DOT', 'BQE', 'FDR', 'II', 'III']);
export const titleCase = (s: string) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  .replace(/\b([a-z])([a-z]*)/g, (_, a: string, b: string) => (KEEP_UPPER.has((a + b).toUpperCase()) ? (a + b).toUpperCase() : a.toUpperCase() + b))
  .replace(/\b(\d+) (Street|Avenue)\b/g, (_, n: string, t: string) => `${n}${ordinal(+n)} ${t}`);
const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
const sentence = (s: string) => { const t = String(s ?? '').trim().toLowerCase(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };

/** The borough a footprint's BIN starts with (1 Manhattan ... 5 Staten Island), as the permit datasets spell it. */
export const boroughOf = (bin: string | undefined) => ({ '1': 'Manhattan', '2': 'Bronx', '3': 'Brooklyn', '4': 'Queens', '5': 'Staten Island' } as Record<string, string>)[String(bin ?? '')[0]] ?? null;
