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
