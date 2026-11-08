// Self-check for describeMark against the DUMBO corners: npx tsx src/simple/street.check.ts (from web/).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { offset } from '../geo.ts';

import { describeMark } from './street.ts';

const s = JSON.parse(readFileSync(new URL('../../../spots/nyc_dumbo/streets.json', import.meta.url), 'utf8'));

// The solved DUMBO mark sits 1.7 m from the Water St corner.
assert.equal(describeMark(s, 40.703195, -73.989598), 'Washington St at Water St');
// 25 m south of Water St along Washington St (the block to Front St is 75 m).
const south = offset(40.7032012, -73.98958, 182, 25);
assert.equal(describeMark(s, south.lat, south.lon), 'Washington St, 25 m south of Water St');
// 40 m east of the corner, off Washington St: named as a corner, not a block.
const east = offset(40.7032012, -73.98958, 90, 40);
assert.equal(describeMark(s, east.lat, east.lon), '40 m east of Washington St and Water St');
// Far away: no street words.
assert.equal(describeMark(s, 40.71, -73.98), null);
console.log('street.check: 4 of 4 pass');
