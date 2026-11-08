// The geodata layers' rules: colour chance, haze, building shadow, the local projection, permit parsing and time zones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorChance, hazeReading, shadowAt, shadowBands, shadowReadout, type Caster } from '../src/layers/score.ts';
import { toXY, toLonLat, metres, bufferLine, streetKey, pointInRing } from '../src/layers/geom.ts';
import { parseSegments } from '../src/layers/nyc.ts';
import { zonedToDate } from '../src/layers/types.ts';
import { osmHeight } from '../src/layers/osm.ts';
import { meanHeading } from '../src/layers/photographers.ts';
import { localMidnight, phaseName } from '../src/layers/sky.ts';

test('colour chance: clear sky is poor, a broken mid deck with no low cloud is good, low cloud blocks it', () => {
  assert.deepEqual([colorChance({ low: 0, mid: 0, high: 0 }).score, colorChance({ low: 0, mid: 0, high: 0 }).label], [20, 'poor']);
  const good = colorChance({ low: 5, mid: 40, high: 20 });
  assert.equal(good.score, 100);
  assert.equal(good.label, 'good');
  assert.ok(colorChance({ low: 85, mid: 40, high: 20 }).score <= 10, 'a low deck blocks the light');
  const overcast = colorChance({ low: 0, mid: 100, high: 100 });
  assert.equal(overcast.score, 45);
  assert.equal(overcast.label, 'fair');
  assert.equal(colorChance({ low: 0, mid: 40, high: 0, precip: 80 }).score, 70, 'rain likely takes 30% off');
  assert.ok(colorChance({ low: 0, mid: 40, high: 0, aod: 0.8 }).score < 75, 'thick haze mutes it');
});

test('haze follows the EPA PM2.5 breakpoints and aerosol optical depth', () => {
  assert.equal(hazeReading(4, 0.04).label, 'clear air');
  assert.equal(hazeReading(20, 0.1).label, 'light haze');
  assert.equal(hazeReading(5, 0.45).label, 'hazy');
  assert.equal(hazeReading(140, 0.2).label, 'heavy haze');
  assert.match(hazeReading(12, null).detail, /EPA moderate/);
});

// A 20 m building, 10 m by 10 m, whose north face is 10 m south of the probe at (0, 0).
const box: Caster = { ring: [[-5, -10], [5, -10], [5, -20], [-5, -20], [-5, -10]], h: 20, name: 'Box' };

test('building shadow: blocked when the roof is above the sun ray where it enters the footprint', () => {
  assert.equal(shadowAt([0, 0], [box], 180, 45)?.name, 'Box', 'sun due south at 45 degrees: ray is 10 m up at the face, roof is 20 m');
  assert.equal(shadowAt([0, 0], [box], 180, 70), null, 'at 70 degrees the ray clears 27 m there');
  assert.equal(shadowAt([0, 0], [box], 0, 20), null, 'sun from the north');
  assert.equal(shadowAt([0, 0], [box], 90, 10), null, 'sun from the east misses the box');
  assert.equal(shadowAt([0, 0], [box], 180, -2), null, 'no building shadow at night');
  assert.equal(shadowAt([0, -15], [box], 180, 10), null, 'a probe inside a footprint is ignored');
});

test('shadow bands and the readout', () => {
  const t0 = new Date('2026-11-08T12:00:00Z');
  // A sun that climbs from 5 to 65 degrees due south over an hour and stays up.
  const sun = (t: Date) => ({ az: 180, alt: 5 + ((t.getTime() - t0.getTime()) / 3_600_000) * 60 });
  const bands = shadowBands([0, 0], [box], t0, new Date(t0.getTime() + 3_600_000), sun, 5);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].start.getTime(), t0.getTime());
  // In shadow while 10 m * tan(alt) < 20 m, so alt < 63.4 degrees: through minute 58 (sampled every 5 min, last at 55).
  assert.equal((bands[0].end.getTime() - t0.getTime()) / 60_000, 55);
  const fmt = (d: Date) => d.toISOString().slice(11, 16);
  assert.equal(shadowReadout(bands, t0, new Date(t0.getTime() + 10 * 3_600_000), fmt), 'in shadow until 12:55, then sunlit');
  assert.equal(shadowReadout([], t0, t0, fmt), 'in sun from sunrise to sunset');
});

test('local projection matches the haversine distance and round-trips', () => {
  const o = { lat: 40.7035215, lon: -73.9896683 };
  const p: [number, number] = [-73.9849, 40.7062];
  const [x, y] = toXY(o, p);
  assert.ok(Math.abs(Math.hypot(x, y) - metres(o, { lon: p[0], lat: p[1] })) < 0.5, 'within 0.5 m over 500 m');
  const back = toLonLat(o, [x, y]);
  assert.ok(Math.abs(back[0] - p[0]) < 1e-9 && Math.abs(back[1] - p[1]) < 1e-9);
  assert.ok(x > 0 && y > 0, 'east is +x, north is +y');
});

test('a buffered street segment is a rectangle twice the half width across', () => {
  const o = { lat: 40.7, lon: -74 };
  const line = [toLonLat(o, [0, 0]), toLonLat(o, [0, 100])];
  const [q] = bufferLine(line, 6);
  const xy = q.map(c => toXY(o, c));
  const xs = xy.map(v => v[0]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 12) < 0.01);
  assert.ok(pointInRing([0, 50], xy) && !pointInRing([7, 50], xy));
});

test('permit text parses into blocks and street names normalise across NYC and OSM spellings', () => {
  assert.deepEqual(parseSegments('WASHINGTON STREET between FRONT STREET and WATER STREET,  FRONT STREET between WASHINGTON STREET and MAIN STREET'), [
    ['WASHINGTON STREET', 'FRONT STREET', 'WATER STREET'], ['FRONT STREET', 'WASHINGTON STREET', 'MAIN STREET'],
  ]);
  assert.deepEqual(parseSegments('Korean War Veterans Plaza: Korean War Veterans Plaza , 252 WESTMINSTER ROAD'), []);
  assert.equal(streetKey('WEST   11 STREET'), streetKey('West 11th Street'));
  assert.equal(streetKey('CADMAN PLAZA WEST'), 'CADMAN PLZ W');
  assert.equal(streetKey('Old Fulton Street'), streetKey('OLD   FULTON ST'));
});

test('local times in New York become the right UTC instants across the DST change', () => {
  assert.equal(zonedToDate('2026-11-08T07:00:00.000', 'America/New_York').toISOString(), '2026-11-08T12:00:00.000Z');
  assert.equal(zonedToDate('2026-07-01 07:00', 'America/New_York').toISOString(), '2026-07-01T11:00:00.000Z');
  assert.equal(localMidnight(new Date('2026-11-08T03:30:00Z'), 'America/New_York').toISOString(), '2026-11-07T05:00:00.000Z');
});

test('OSM heights, mean headings and moon phases', () => {
  assert.deepEqual(osmHeight({ height: '36.2' }), { h: 36.2, estimated: false });
  assert.deepEqual(osmHeight({ 'building:levels': '4' }), { h: 12, estimated: false });
  assert.deepEqual(osmHeight({}), { h: 9, estimated: true });
  assert.ok(Math.abs(meanHeading([350, 10]) - 0) < 1e-9 || Math.abs(meanHeading([350, 10]) - 360) < 1e-9, 'wraps through north');
  assert.equal(phaseName(0.5), 'full moon');
  assert.equal(phaseName(0.98), 'new moon');
});
