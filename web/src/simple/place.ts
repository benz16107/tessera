// Moving a free-location shoot's pin (anywhere2.md), shared by Simple's clue panel and Studio's Change place. Kept out of
// lib.ts because the scene helpers bring three.js, and the drop page imports lib.ts.
import type { SceneObject } from '../module_bindings/types.ts';
import { parseParams, stateOf, withParams, type ObjState } from '../studio/scene/objects.ts';
import { geoSpotId, groundHeight, placeLabel, type PlacedBy } from './lib.ts';

export { placeLabel };

const UNTITLED = ['', 'Untitled shoot', 'New shoot']; // the module's own list: any member may rename these

export interface PlaceShootCtx {
  sessionId: bigint;
  title: string; // the session's current title
  shotRow: SceneObject | undefined; // Cam A, when it exists
  setObject: (row: SceneObject, s: ObjState, tag?: string) => void;
  setSessionSpot: (a: { sessionId: bigint; spotId: string }) => Promise<unknown>;
  renameSession: (a: { sessionId: bigint; title: string }) => Promise<unknown>;
}


/** Moves the shoot's pin for everyone and records how it was placed. Returns the place label written to Cam A. */
export async function placeShoot(c: PlaceShootCtx, lat: number, lon: number, by: PlacedBy, radiusM?: number, name?: string) {
  const place = placeLabel(name);
  // The title follows the place while it is untitled, still the last placement's name, or no placement name was ever
  // recorded (the title then came from the drop or a guess, not a person). A title differing from a recorded name stays.
  const prev = c.shotRow ? parseParams(c.shotRow.params).place : undefined;
  if (place && place !== c.title && (UNTITLED.includes(c.title) || !prev || c.title === prev))
    c.renameSession({ sessionId: c.sessionId, title: place }).catch(() => {}); // the module refuses non-owners once the shoot is named
  // Cam A's label and name go before the pin moves, so no screen pairs the new mark with the old place's name.
  const patch = { placed: by, area: by === 'area' && radiusM ? Math.round(radiusM) : '', approx: 1, place: place ?? '', aimnote: '' }; // a moved pin drops the example's facing note
  if (c.shotRow) c.setObject(c.shotRow, withParams({ ...stateOf(c.shotRow), x: 0, y: 0, z: 1.6 }, patch));
  await c.setSessionSpot({ sessionId: c.sessionId, spotId: geoSpotId(lat, lon, await groundHeight(lat, lon)) });
  return place;
}
