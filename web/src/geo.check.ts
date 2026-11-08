// Self-check for geo.ts: `node src/geo.check.ts` (Node 22 strips the types).
import assert from 'node:assert/strict';
import { frustumFor, compassWord, phoneZoom, bearing, metersBetween, angleDiff, sunRelation, sunAt } from './geo.ts';

const near = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const deg = (r: number) => (r * 180) / Math.PI;

// 36x24 full frame at 50 mm: hfov 39.6, vfov 27.0. Landscape uses hfov, portrait vfov... of the long side.
const land = frustumFor(50, 3600, 2400);
near(deg(land.hfov), 39.6, 0.1);
near(deg(land.vfov), 27.0, 0.1);
assert.equal(land.fov, land.hfov);
const port = frustumFor(50, 2400, 3600);
assert.equal(port.fov, port.vfov);
near(deg(port.fov), 39.6, 0.1);

assert.equal(compassWord(0), 'N');
assert.equal(compassWord(359), 'N');
assert.equal(compassWord(225), 'SW');
assert.equal(phoneZoom(48).text, '2.0x on an iPhone main camera');
assert.equal(phoneZoom(13).text, '0.5x ultrawide');
assert.equal(phoneZoom(24).text, '1x on an iPhone main camera');

near(bearing(40.7, -74, 40.71, -74), 0, 0.01);
near(bearing(40.7, -74, 40.7, -73.99), 90, 0.1);
near(metersBetween(40.7, -74, 40.701, -74), 111.2, 0.5);
assert.equal(angleDiff(10, 350), 20);
assert.equal(angleDiff(350, 10), -20);

assert.equal(sunRelation(90, 10, 90, 40), 'in frame');
assert.equal(sunRelation(270, 10, 90, 40), 'behind you');
assert.equal(sunRelation(45, 10, 90, 40), 'from your left');
// Noon in Dallas in November: the sun is south and well up.
const s = sunAt(new Date('2026-11-08T18:00:00Z'), 32.99, -96.75);
near(s.azimuth, 180, 25);
assert.ok(s.altitude > 30);
console.log('geo ok');
