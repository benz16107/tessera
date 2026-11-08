// Pure helpers shared by the HTTP server, the job loop and the agent. Tested in test/geo.test.ts.

export function metres(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180, x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r), y = (bLat - aLat) * r;
  return Math.hypot(x, y) * 6_371_000;
}

/** Degrees clockwise from north, from a to b. */
export function bearing(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180, x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r), y = (bLat - aLat) * r;
  return (Math.atan2(x, y) / r + 360) % 360;
}

type SpotLike = { id: string; lat: number; lon: number; radius_m: number };

/** The closest spot whose centre is within radius_m + 300 m of the point, else null. */
export function nearestSpot<S extends SpotLike>(spots: S[], lat: number, lon: number): S | null {
  let best: S | null = null, bestD = Infinity;
  for (const s of spots) {
    const d = metres(lat, lon, s.lat, s.lon);
    if (d <= s.radius_m + 300 && d < bestD) { best = s; bestD = d; }
  }
  return best;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export const compassWord = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** iPhone zoom for a 35 mm-equivalent focal length: the main camera is 24 mm = 1x. */
export function zoomWords(f35: number): string {
  if (f35 < 18) return '0.5x (ultrawide)';
  const z = Math.round((f35 / 24) * 10) / 10;
  return `${z}x`;
}

/** Centre crop that turns a photo shot at fromF35 into toF35. Null when toF35 is not longer (a wider lens needs outpainting). */
export function cropForF35(w: number, h: number, fromF35: number, toF35: number) {
  if (!(toF35 > fromF35)) return null;
  const k = fromF35 / toF35, width = Math.max(1, Math.round(w * k)), height = Math.max(1, Math.round(h * k));
  return { left: Math.floor((w - width) / 2), top: Math.floor((h - height) / 2), width, height };
}

/** Signed angle of the sun relative to where the camera points, in (-180, 180]; negative is left. */
export const relativeAngle = (sunAz: number, heading: number) => {
  const d = (((sunAz - heading) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
};

export function lightWords(sunAz: number, sunAlt: number, heading: number): string {
  if (sunAlt < -6) return 'night, city lights, dark sky';
  if (sunAlt < 0) return 'blue hour: deep blue twilight sky, no direct sunlight, lights coming on';
  const rel = relativeAngle(sunAz, heading), a = Math.abs(rel);
  const side = a < 45 ? 'in front of the camera, backlit scene' : a > 135 ? 'behind the camera, front-lit scene'
    : rel < 0 ? 'from the left' : 'from the right';
  const tone = sunAlt < 8 ? 'warm low golden sun' : sunAlt < 25 ? 'low afternoon sun with long shadows' : 'bright high sun';
  return `${tone} ${side}`;
}

type PoseLike = { lat: number; lon: number; heading: number; f35: number };

/** People placed in the scene, described relative to the camera: which third of the frame, and how near. Out-of-frame people are skipped. */
export function placementWords(people: { lat: number; lon: number }[], cam: PoseLike, w: number, h: number): string[] {
  const fpx = (cam.f35 * Math.hypot(w, h)) / 43.2666, halfH = Math.atan(w / (2 * fpx));
  const out: string[] = [];
  for (const p of people) {
    const d = metres(cam.lat, cam.lon, p.lat, p.lon);
    const rel = (relativeAngle(bearing(cam.lat, cam.lon, p.lat, p.lon), cam.heading) * Math.PI) / 180;
    if (Math.abs(rel) >= halfH || d < 0.5) continue;
    const x = Math.tan(rel) / Math.tan(halfH); // -1 left edge .. 1 right edge
    const third = x < -1 / 3 ? 'in the left third' : x > 1 / 3 ? 'in the right third' : 'in the centre';
    const near = d < 12 ? `near the camera, about ${Math.round(d)} m away` : d < 40 ? `in the middle distance, about ${Math.round(d)} m away` : `far away, about ${Math.round(d / 5) * 5} m`;
    out.push(`one person ${third}, ${near}`);
  }
  return out;
}
