import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropForF35, zoomWords, compassWord, nearestSpot, relativeAngle, lightWords } from '../src/geo.ts';

test('crop from 24 mm to 48 mm keeps the centre half', () => {
  assert.deepEqual(cropForF35(4000, 3000, 24, 48), { left: 1000, top: 750, width: 2000, height: 1500 });
  assert.equal(cropForF35(4000, 3000, 50, 35), null);
  assert.equal(cropForF35(4000, 3000, 50, 50), null);
});

test('zoom words use 24 mm as 1x and 0.5x below 18 mm', () => {
  assert.equal(zoomWords(24), '1x');
  assert.equal(zoomWords(72), '3x');
  assert.equal(zoomWords(50), '2.1x');
  assert.equal(zoomWords(13), '0.5x (ultrawide)');
});

test('compass words wrap around north', () => {
  assert.equal(compassWord(0), 'north');
  assert.equal(compassWord(359), 'north');
  assert.equal(compassWord(-90), 'west');
  assert.equal(compassWord(130), 'southeast');
  assert.equal(compassWord(225), 'southwest');
});

test('nearestSpot uses radius + 300 m and picks the closest', () => {
  const spots = [
    { id: 'nyc_dumbo', lat: 40.7033, lon: -73.9894, radius_m: 150 },
    { id: 'utd_x', lat: 32.9857, lon: -96.7502, radius_m: 100 },
  ];
  assert.equal(nearestSpot(spots, 40.7040, -73.9890)?.id, 'nyc_dumbo');
  assert.equal(nearestSpot(spots, 40.7033 + 0.0040, -73.9894)?.id, 'nyc_dumbo'); // ~445 m < 450
  assert.equal(nearestSpot(spots, 40.7033 + 0.0045, -73.9894), null); // ~500 m
  assert.equal(nearestSpot([], 0, 0), null);
});

test('sun relative to heading', () => {
  assert.equal(relativeAngle(270, 0), -90);
  assert.equal(relativeAngle(10, 350), 20);
  assert.match(lightWords(270, 4, 0), /golden.*from the left/);
  assert.match(lightWords(180, 30, 0), /behind the camera/);
  assert.match(lightWords(0, -3, 0), /blue hour/);
});

import { sunWindows } from '../src/sun.ts';
test('sun windows at DUMBO in November come in order and are in the future', () => {
  const now = new Date('2026-11-07T18:00:00Z');
  const w = sunWindows(40.7033, -73.9894, 330, now);
  assert.ok(w.golden && w.blue);
  assert.ok(w.golden.end > now && w.blue.end > now);
  // Evening sun is in the southwest; a camera pointing northwest (330) has it to its left, not behind.
  assert.ok(w.golden.sunAz > 200 && w.golden.sunAz < 260);
});

import { answerText, matchSpotByName, parseFollowUp } from '../src/words.ts';
test('follow-up parsing', () => {
  assert.deepEqual(parseFollowUp('make it 85mm'), { f35: 85, people: 0, light: undefined });
  assert.deepEqual(parseFollowUp('add two people at sunset'), { f35: undefined, people: 2, light: 'golden hour' });
  assert.equal(parseFollowUp('what about blue hour?').light, 'blue hour');
});

test('spot names match loosely', () => {
  const spots = [{ id: 'nyc_dumbo', name: 'Manhattan Bridge from Washington St, DUMBO' }, { id: 'utd_plinth', name: 'UTD Plinth' }];
  assert.equal(matchSpotByName('this is in dumbo brooklyn', spots)?.id, 'nyc_dumbo');
  assert.equal(matchSpotByName('the plinth at utd', spots)?.id, 'utd_plinth');
  assert.equal(matchSpotByName('paris', spots), undefined);
});

test('answer text names the spot, mark, heading, lens and zoom', () => {
  const spot = { id: 'nyc_dumbo', name: 'DUMBO', lat: 40.7033, lon: -73.9894, radiusM: 150, cameras: 128, modelVersion: '1' };
  const r: any = { confidence: 'solid', reason: '1527 matches, 4 m from a mapped camera', lensReadF35: 30,
    pose: { lat: 40.70300, lon: -73.98960, alt: 1.6, heading: 315, pitch: 12, roll: 0, f35: 48 } };
  const t = answerText(spot, r);
  assert.match(t, /Solid: DUMBO/);
  assert.match(t, /Stand at 40\.70300, -73\.98960, about \d+ m south/);
  assert.match(t, /Face northwest \(315°\), tilted up 12°/);
  assert.match(t, /48 mm equivalent, about 2x on an iPhone/);
  assert.match(t, /Next good light: .*golden hour/);
  assert.match(answerText(spot, { ...r, confidence: 'none', reason: '78 matches' }), /Couldn't place this photo at DUMBO\. 78 matches\..*30 mm/);
});

import { placementWords } from '../src/geo.ts';
test('placed people become thirds and distances relative to the camera', () => {
  const cam = { lat: 40.7, lon: -74, heading: 0, f35: 26 }; // facing north
  const dLat = (m: number) => m / 111_195, dLon = (m: number) => m / (111_195 * Math.cos((40.7 * Math.PI) / 180));
  const words = placementWords([
    { lat: 40.7 + dLat(10), lon: -74 - dLon(4) },   // 10 m ahead, 4 m left
    { lat: 40.7 + dLat(30), lon: -74 },             // straight ahead
    { lat: 40.7 + dLat(60), lon: -74 + dLon(20) },  // far right
    { lat: 40.7 - dLat(10), lon: -74 },             // behind the camera
  ], cam, 4000, 3000);
  assert.equal(words.length, 3);
  assert.match(words[0], /left third, near the camera, about 11 m/);
  assert.match(words[1], /centre, in the middle distance/);
  assert.match(words[2], /right third, far away/);
});

import { solverRange, FINE_TUNED } from '../src/models.ts';
test('only a user hint or the fine-tuned lens model narrows the solver', () => {
  assert.deepEqual(solverRange(80, null), [60, 106.4]);
  assert.deepEqual(solverRange(undefined, { f35: 50, source: FINE_TUNED }), [30, 80]);
  assert.equal(solverRange(undefined, { f35: 28, source: 'nvidia/nemotron-3.5-super-vl-120b-a12b' }), undefined);
});

import { walkWords, spokenPlan } from '../src/words.ts';
test('walk and spoken words', () => {
  const dLat = (m: number) => m / 111_195;
  assert.equal(walkWords(40.7, -74, 0, 40.7 + dLat(3), -74, 300), "You're on the mark. Now face northwest.");
  assert.match(walkWords(40.7, -74, 90, 40.7 + dLat(30), -74, 0), /^Walk about 30 metres north\. Turn left about 90 degrees\.$/);
  assert.match(walkWords(40.7, -74, 5, 40.7 + dLat(120), -74, 0), /120 metres north\. It is straight ahead\./);
  const spot = { id: 's', name: 'DUMBO', lat: 40.7, lon: -74, radiusM: 100, cameras: 1, modelVersion: '' };
  const r: any = { confidence: 'solid', reason: '', pose: { lat: 40.7 - dLat(40), lon: -74, alt: 0, heading: 0, pitch: 0, roll: 0, f35: 50 } };
  assert.equal(spokenPlan(spot, r), 'The mark is about 40 metres south of the centre of DUMBO. Face north and zoom to 2.1x.');
});
