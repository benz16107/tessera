// Self-check for placeShoot's writes and rename rule, with stubbed reducers: npx tsx src/simple/place.shoot.check.mts (from web/).
import assert from 'node:assert/strict';
import { placeShoot } from './place.ts';
import type { SceneObject } from '../module_bindings/types.ts';

globalThis.fetch = (async () => ({ json: async () => ({ elevation: [12] }) })) as unknown as typeof fetch; // Open-Meteo stub
const cam = (place?: string) => ({ id: 1n, x: 30, y: -4, z: 1.6, qx: 0, qy: 0, qz: 0, qw: 1, params: `shot=1;approx=1${place ? `;place=${place}` : ''}` }) as unknown as SceneObject;
async function run(title: string, shotRow: SceneObject | undefined, name?: string) {
  const log: string[] = [];
  const out = await placeShoot({
    sessionId: 7n, title, shotRow,
    setObject: (_r, s) => log.push(`cam ${s.x},${s.y},${s.z} ${s.params}`),
    setSessionSpot: async a => { log.push(`spot ${a.spotId}`); },
    renameSession: async a => { log.push(`rename ${a.title}`); },
  }, 55.88279, -4.35158, 'search', undefined, name);
  return { out, log };
}

// Untitled: renamed, Cam A snapped to the new pin with its label, then the pin moves.
let r = await run('Untitled shoot', cam(), 'Scotstoun, Glasgow, Scotland');
assert.equal(r.out, 'Scotstoun, Glasgow');
assert.deepEqual(r.log, ['rename Scotstoun, Glasgow', 'cam 0,0,1.6 shot=1;approx=1;placed=search;place=Scotstoun, Glasgow', 'spot geo:55.882790,-4.351580,12.0']);
// The title is the last placement's name: it follows the place.
r = await run('Washington Street, New York', cam('Washington Street, New York'), 'Scotstoun, Glasgow');
assert.equal(r.log[0], 'rename Scotstoun, Glasgow');
// A title someone typed stays.
r = await run('Ben and Maya at dusk', cam('Washington Street, New York'), 'Scotstoun, Glasgow');
assert.ok(!r.log.some(l => l.startsWith('rename')));
// A guess-titled shoot whose Cam A recorded no name (older shoots, or one opened only in Studio): the title follows.
r = await run('Eiffel Tower, Paris', cam(), 'Palace of Fine Arts, 3301, Lyon Street, San Francisco');
assert.equal(r.log[0], 'rename Palace of Fine Arts, Lyon Street');
// The C7P8FC flow: the drop recorded place=<title> on Cam A, so a Search elsewhere renames.
r = await run('Eiffel Tower, Paris', cam('Eiffel Tower, Paris'), 'Palace of Fine Arts, San Francisco');
assert.equal(r.log[0], 'rename Palace of Fine Arts, San Francisco');
// No name (an exact spot): no rename, and the old place name is cleared from Cam A.
r = await run('Untitled shoot', cam('Old Place'), undefined);
assert.ok(!r.log.some(l => l.startsWith('rename')));
assert.equal(r.log[0], 'cam 0,0,1.6 shot=1;approx=1;placed=search');
// No Cam A yet: only the pin moves, and the title follows (nothing recorded says a person typed it).
r = await run('Untitled shoot', undefined, 'Scotstoun, Glasgow');
assert.deepEqual(r.log, ['rename Scotstoun, Glasgow', 'spot geo:55.882790,-4.351580,12.0']);
r = await run('Eiffel Tower, Paris', undefined, 'Scotstoun, Glasgow');
assert.equal(r.log[0], 'rename Scotstoun, Glasgow');
console.log('place.shoot.check: 8 of 8 pass');
