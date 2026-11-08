import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuoptPayload, readRoute, chooseLight, SERVICE_MIN, type Stop } from '../src/route.ts';

const t0 = new Date('2026-11-08T21:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const stops: Stop[] = [
  { name: 'solved shot', lat: 40.70319, lon: -73.9896, heading: 4, f35: 53, light: 'golden hour', window: [at(30), at(70)] },
  { name: 'pier', lat: 40.70519, lon: -73.99121, heading: 120, f35: 24, light: 'blue hour', window: [at(70), at(100)] },
];

test('cuOpt payload: walking-minute matrix, windows that leave room for the shot, one walker with no return trip', () => {
  const p = cuoptPayload(stops, t0);
  const m = p.cost_matrix_data.data['0'];
  assert.equal(m[0][0], 0);
  assert.equal(m[0][1], m[1][0]);
  assert.ok(m[0][1] > 3 && m[0][1] < 4, `~260 m at 1.3 m/s is ~3.3 min, got ${m[0][1]}`);
  assert.deepEqual(p.travel_time_matrix_data.data['0'], m);
  assert.deepEqual(p.task_data.task_locations, [0, 1]);
  assert.deepEqual(p.task_data.task_time_windows, [[30, 70 - SERVICE_MIN], [70, 100 - SERVICE_MIN]]);
  assert.deepEqual(p.task_data.service_times, [SERVICE_MIN, SERVICE_MIN]);
  assert.deepEqual(p.fleet_data, { vehicle_locations: [[0, 0]], vehicle_time_windows: [[0, 160]], drop_return_trips: [true] });
});

test('reading the route back, and refusing a failed solve', () => {
  const resp = { response: { solver_response: { status: 0, solution_cost: 3.3, dropped_tasks: { task_index: [] },
    vehicle_data: { '0': { task_id: ['Depot', '0', '1'], route: [0, 0, 1], arrival_stamp: [0, 30, 70] } } } } };
  const r = readRoute(resp, stops, t0, 40.7, -74);
  assert.deepEqual(r.stops.map(s => [s.order, s.name, s.walk_min]), [[1, 'solved shot', 0], [2, 'pier', 3]]);
  assert.throws(() => readRoute({ response: { solver_response: { status: 1 } } }, stops, t0, 40.7, -74), /no route/);
});

test('a view into the evening sun gets blue hour', () => {
  const day = new Date('2026-11-08T17:00:00Z');
  assert.match(chooseLight({ name: 'w', lat: 40.7, lon: -74, heading: 240, f35: 24 }, day, 'evening').light, /^blue hour/);
  assert.match(chooseLight({ name: 'e', lat: 40.7, lon: -74, heading: 60, f35: 24 }, day, 'evening').light, /sun behind you/);
});
