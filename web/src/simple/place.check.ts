// Self-check for decidePlace (anywhere.md cases 1 to 3): npx tsx src/simple/place.check.ts (from web/).
import assert from 'node:assert/strict';
import { decidePlace, type Located } from './lib.ts';

const loc = (o: Partial<Located>): Located => ({ place: '', lat: null, lon: null, confidence: 'low', reason: '', headingDeg: null, source: 'nemotron', nearestSpot: null, ...o });
const noGps = { nearestSpot: null, gpsLat: null, gpsLon: null };

// The example photo names its spot.
assert.deepEqual(decidePlace(noGps, null, 'nyc_dumbo', 'nyc_dumbo'), { kind: 'spot', spotId: 'nyc_dumbo' });
// GPS inside DUMBO: solve.
assert.deepEqual(decidePlace({ nearestSpot: 'nyc_dumbo', gpsLat: 40.7032, gpsLon: -73.9896 }, null, 'nyc_dumbo'), { kind: 'spot', spotId: 'nyc_dumbo' });
// Case 1: Clifton Hill GPS, far from every spot: a pin at the GPS, named by the geocoder.
assert.deepEqual(decidePlace({ nearestSpot: null, gpsLat: 43.0912, gpsLon: -79.0745 }, loc({ place: 'Clifton Hill, Niagara Falls', lat: 43.0912, lon: -79.0745, confidence: 'high', source: 'gps' }), 'nyc_dumbo'),
  { kind: 'pin', lat: 43.0912, lon: -79.0745, place: 'Clifton Hill, Niagara Falls', guessed: false });
// Case 1 even when the locate call failed: the GPS alone makes the pin.
assert.equal(decidePlace({ nearestSpot: null, gpsLat: 43.0912, gpsLon: -79.0745 }, null, 'nyc_dumbo').kind, 'pin');
// Case 2: no GPS, a confident guess: a pin, marked as a guess.
assert.deepEqual(decidePlace(noGps, loc({ place: 'Eiffel Tower, Paris', lat: 48.8584, lon: 2.2945, confidence: 'high' }), 'nyc_dumbo'),
  { kind: 'pin', lat: 48.8584, lon: 2.2945, place: 'Eiffel Tower, Paris', guessed: true });
// Case 2: the guess is DUMBO: solve.
assert.deepEqual(decidePlace(noGps, loc({ place: 'Washington St', lat: 40.7032, lon: -73.9896, confidence: 'high', nearestSpot: 'nyc_dumbo' }), 'nyc_dumbo'), { kind: 'spot', spotId: 'nyc_dumbo' });
// Unsure, or a name the map couldn't find: solve as before.
assert.deepEqual(decidePlace(noGps, loc({ place: 'somewhere', lat: 10, lon: 10, confidence: 'low' }), 'nyc_dumbo'), { kind: 'spot', spotId: 'nyc_dumbo' });
assert.deepEqual(decidePlace(noGps, loc({ place: 'a cafe', confidence: 'medium' }), 'nyc_dumbo'), { kind: 'spot', spotId: 'nyc_dumbo' });
assert.deepEqual(decidePlace(noGps, null, 'nyc_dumbo'), { kind: 'spot', spotId: 'nyc_dumbo' });
console.log('place.check: 9 of 9 pass');
