import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateGps, locatePhoto, readGuess, type Deps } from '../src/locate.ts';

const deps = (reply: string, hits: Record<string, { lat: number; lon: number; name: string } | null>, asked: string[] = []): Deps => ({
  ask: async () => reply,
  geocode: async q => { asked.push(q); return hits[q] ?? null; },
  reverse: async (lat, lon) => ({ lat, lon, name: 'Clifton Hill, Niagara Falls, Ontario, Canada' }),
});
const clock = () => { let t = 0; return () => (t += 50); };

test('a named place is geocoded; coordinates come from the geocoder, not the model', async () => {
  const reply = '```json\n{"place": "Clifton Hill, Niagara Falls", "query": "Clifton Hill, Niagara Falls, Ontario, Canada", "confidence": "high", "reason": "A Ruby Tuesday sign on the Clifton Hill strip.", "heading_deg": null, "lat": 1, "lon": 2}\n```';
  const r = await locatePhoto('img', deps(reply, { 'Clifton Hill, Niagara Falls, Ontario, Canada': { lat: 43.0912, lon: -79.0745, name: 'Clifton Hill' } }), clock());
  assert.equal(r.lat, 43.0912); assert.equal(r.lon, -79.0745);
  assert.equal(r.confidence, 'high'); assert.equal(r.source, 'nemotron'); assert.equal(r.nearestSpot, null);
  assert.equal(r.place, 'Clifton Hill, Niagara Falls');
});

test('no map match means no coordinates and low confidence; the plain place name is tried second', async () => {
  const asked: string[] = [];
  const r = await locatePhoto('img', deps('{"place": "Atlantis", "query": "Atlantis, Ocean", "confidence": "high", "reason": "x"}', {}, asked), clock());
  assert.deepEqual(asked, ['Atlantis, Ocean', 'Atlantis']);
  assert.equal(r.lat, null); assert.equal(r.confidence, 'low'); assert.match(r.reason, /No map match/);
});

test('a guess at DUMBO reports the mapped spot so the client solves as today', async () => {
  const r = await locatePhoto('img', deps('{"place": "Manhattan Bridge from Washington St", "query": "Washington Street, Brooklyn", "confidence": "high", "reason": "the bridge"}',
    { 'Washington Street, Brooklyn': { lat: 40.70319, lon: -73.9896, name: 'Washington Street' } }), clock());
  assert.equal(r.nearestSpot, 'nyc_dumbo');
});

test('garbled or unsure replies are low confidence', () => {
  assert.equal(readGuess('I am not sure').confidence, 'low');
  assert.equal(readGuess('{"place": "", "confidence": "high"}').confidence, 'low');
  assert.equal(readGuess('{"place": "Paris", "confidence": "certain"}').confidence, 'low');
  assert.equal(readGuess('{"place": "Paris", "confidence": "medium", "heading_deg": 370}').headingDeg, 10);
});

test('GPS photos keep their own coordinates and get a place name', async () => {
  const r = await locateGps(43.0912, -79.0745, deps('', {}), clock());
  assert.deepEqual([r.lat, r.lon, r.confidence, r.source], [43.0912, -79.0745, 'high', 'gps']);
  assert.match(r.place, /Clifton Hill/);
});

test('an area hint reaches the prompt and bounds the geocoding; matches outside the circle are refused', async () => {
  const area = { lat: 43.08, lon: -79.07, radiusM: 5000 };
  const prompts: (string | undefined)[] = [], areas: unknown[] = [];
  const reply = '{"place": "Ruby Tuesday, Clifton Hill", "query": "Ruby Tuesday Clifton Hill Niagara Falls", "confidence": "medium", "reason": "a Ruby Tuesday sign"}';
  const mk = (hit: { lat: number; lon: number; name: string } | null): Deps => ({
    ask: async (_img, hint) => { prompts.push(hint); return reply; },
    geocode: async (_q, a) => { areas.push(a); return hit; },
    reverse: async () => ({ lat: 43.08, lon: -79.07, name: 'Niagara Falls, Ontario, Canada' }),
  });
  const inside = await locatePhoto('img', mk({ lat: 43.0914, lon: -79.0749, name: 'Ruby Tuesday' }), clock(), { area, text: 'by the falls' });
  assert.match(prompts[0]!, /within about 5 km of Niagara Falls, Ontario, Canada/);
  assert.match(prompts[0]!, /by the falls/);
  assert.deepEqual(areas[0], area, 'the geocoder is bounded to the area');
  assert.deepEqual([inside.lat, inside.lon, inside.confidence], [43.0914, -79.0749, 'medium']);
  // A Ruby Tuesday in Toronto is outside the circle: the pin goes to the centre instead.
  const outside = await locatePhoto('img', mk({ lat: 43.65, lon: -79.38, name: 'Ruby Tuesday Toronto' }), clock(), { area });
  assert.deepEqual([outside.lat, outside.lon, outside.confidence, outside.place], [43.08, -79.07, 'area', 'Niagara Falls, Ontario, Canada']);
  assert.deepEqual(outside.area, area);
  assert.match(outside.reason, /centre/);
});

test('without an area nothing changes: a miss has no coordinates', async () => {
  const r = await locatePhoto('img', deps('{"place": "Somewhere", "query": "Somewhere", "confidence": "high", "reason": "x"}', {}), clock(), { text: 'Lisbon' });
  assert.deepEqual([r.lat, r.confidence, r.area], [null, 'low', null]);
});

test('with an area, a model failure still answers with the centre', async () => {
  const area = { lat: 37.77, lon: -122.44, radiusM: 8000 };
  const failing: Deps = { ask: async () => { throw new Error('timeout'); }, geocode: async () => null, reverse: async () => ({ lat: 37.77, lon: -122.44, name: 'San Francisco' }) };
  const r = await locatePhoto('img', failing, clock(), { area });
  assert.deepEqual([r.lat, r.lon, r.confidence, r.place], [37.77, -122.44, 'area', 'San Francisco']);
  await assert.rejects(locatePhoto('img', failing, clock()), /timeout/, 'without an area the error reaches the route (503)');
});
