// Dev-only screenshot fixture (?fixture in the URL on the Vite dev server): one placed DUMBO test photo.
// Never shipped: callers gate on import.meta.env.DEV, so the production build drops it.
import { Identity, Timestamp } from 'spacetimedb';
import type { Photo, SolveJob, SolveResult, Spot } from './module_bindings/types.ts';

export const fixtureOn = () => import.meta.env.DEV && new URLSearchParams(location.search).has('fixture');

export function fixtureRows(sessionId: bigint) {
  const now = Timestamp.fromDate(new Date());
  const spot: Spot = { id: 'nyc_dumbo', name: 'Manhattan Bridge from Washington St, DUMBO', lat: 40.70325, lon: -73.98955, radiusM: 150, cameras: 128, modelVersion: 'fixture' };
  const url = FIXTURE_IMG;
  const photo: Photo = { id: 9_000_001n, sessionId, owner: Identity.zero(), url, thumb: url, width: 1280, height: 1707, pinLat: undefined, pinLon: undefined, exifF35: 52, source: 'web', createdAt: now };
  const job: SolveJob = { id: 9_000_001n, photoId: photo.id, sessionId, spotId: spot.id, state: 'done', progress: 'done', worker: undefined, leaseUntil: undefined, attempts: 1, error: '', createdAt: now };
  const result: SolveResult = {
    photoId: photo.id, sessionId, jobId: job.id, inliers: 1527, confidence: 'solid', reason: '1527 matches, 4 m from a mapped camera',
    pose: { lat: 40.703158, lon: -73.9896, alt: 1.6, heading: 14, pitch: 9, roll: 0, f35: 52 }, lensReadF35: 50, secs: 14.8, createdAt: now,
  };
  return { spot, photo, job, result };
}

const FIXTURE_IMG = import.meta.env.DEV ? `/@fs${__REPO_ROOT__}/spots/nyc_dumbo/test/d0481.jpg` : '';
