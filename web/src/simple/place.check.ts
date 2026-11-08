// Self-check for decidePlace (anywhere.md cases 1 to 3, anywhere2.md rule 1): npx tsx src/simple/place.check.ts (from web/).
import assert from 'node:assert/strict';
import { decidePlace, evidenceLine, placeLabel, type Located } from './lib.ts';

const loc = (o: Partial<Located>): Located => ({ place: '', lat: null, lon: null, confidence: 'low', reason: '', headingDeg: null, source: 'nemotron', nearestSpot: null, ...o });
const noGps = { nearestSpot: null, gpsLat: null, gpsLon: null };

// The example photo names its spot.
assert.deepEqual(decidePlace(noGps, null, 'nyc_dumbo'), { kind: 'spot', spotId: 'nyc_dumbo' });
// GPS inside DUMBO: solve.
assert.deepEqual(decidePlace({ nearestSpot: 'nyc_dumbo', gpsLat: 40.7032, gpsLon: -73.9896 }, null), { kind: 'spot', spotId: 'nyc_dumbo' });
// Case 1: Clifton Hill GPS, far from every spot: a pin at the GPS, named by the geocoder.
assert.deepEqual(decidePlace({ nearestSpot: null, gpsLat: 43.0912, gpsLon: -79.0745 }, loc({ place: 'Clifton Hill, Niagara Falls', lat: 43.0912, lon: -79.0745, confidence: 'high', source: 'gps' })),
  { kind: 'pin', lat: 43.0912, lon: -79.0745, place: 'Clifton Hill, Niagara Falls', guessed: false });
// Case 1 even when the locate call failed: the GPS alone makes the pin.
assert.equal(decidePlace({ nearestSpot: null, gpsLat: 43.0912, gpsLon: -79.0745 }, null).kind, 'pin');
// Case 2: no GPS, a confident guess: a pin, marked as a guess.
assert.deepEqual(decidePlace(noGps, loc({ place: 'Eiffel Tower, Paris', lat: 48.8584, lon: 2.2945, confidence: 'high' })),
  { kind: 'pin', lat: 48.8584, lon: 2.2945, place: 'Eiffel Tower, Paris', guessed: true });
// Case 2: the guess is DUMBO: solve.
assert.deepEqual(decidePlace(noGps, loc({ place: 'Washington St', lat: 40.7032, lon: -73.9896, confidence: 'high', nearestSpot: 'nyc_dumbo' })), { kind: 'spot', spotId: 'nyc_dumbo' });
// Medium is only a suggestion on the clue screen; low, a name the map couldn't find, or no answer: the clue panel too.
assert.deepEqual(decidePlace(noGps, loc({ place: 'Paris', lat: 48.8566, lon: 2.3522, confidence: 'medium' })), { kind: 'clue' });
assert.deepEqual(decidePlace(noGps, loc({ place: 'somewhere', lat: 10, lon: 10, confidence: 'low' })), { kind: 'clue' });
assert.deepEqual(decidePlace(noGps, loc({ place: 'a cafe', confidence: 'medium' })), { kind: 'clue' });
assert.deepEqual(decidePlace(noGps, null), { kind: 'clue' });
// The evidence line names signs first, then landmarks, and is empty for vague evidence.
assert.equal(evidenceLine([{ type: 'sign', text: 'Travelodge' }, { type: 'sign', text: 'Ruby Tuesday' }, { type: 'other', text: 'crowds at night' }]), 'From the signs: Travelodge and Ruby Tuesday.');
assert.equal(evidenceLine([{ type: 'landmark', text: 'the Palace of Fine Arts rotunda.' }]), 'From the landmark: the Palace of Fine Arts rotunda.');
assert.equal(evidenceLine([{ type: 'other', text: 'night sky' }]), '');
assert.equal(evidenceLine(undefined), '');
// Place labels: the first two parts that aren't only a number, no ';' or '=' (Cam A's params syntax), idempotent.
assert.equal(placeLabel('Palace of Fine Arts, 3301, Lyon Street, Marina District, San Francisco, California, 94123, United States'), 'Palace of Fine Arts, Lyon Street');
assert.equal(placeLabel('Clifton Hill, Niagara Falls, Ontario, Canada'), 'Clifton Hill, Niagara Falls');
assert.equal(placeLabel('12-14, Rue de Rivoli, Paris'), 'Rue de Rivoli, Paris');
assert.equal(placeLabel(placeLabel('Eiffel Tower, Paris, France')), 'Eiffel Tower, Paris');
assert.equal(placeLabel('a=b;c'), 'a b c');
assert.equal(placeLabel(''), undefined);
console.log('place.check: 20 of 20 pass');
