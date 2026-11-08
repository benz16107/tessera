#!/usr/bin/env python3
"""Camera poses for the Difix3D pass on a street splat, from Cam A (the demo shot camera) and geometry.json.

  solver/.venv/bin/python splat/difix_views.py nyc_dumbo   # writes data/splats/<spot>/difix_targets.json and compare_*.json

Targets: where a Studio visitor looks from. Around Cam A, 7 m left to 9 m right (kept 1.5 m off each facade), 3 m behind
to 5 m ahead, at photo height and 2 m higher, aimed up the street or turned 45 degrees toward each wall.
Compare views (before/after): Studio's default World camera (web/src/studio/Studio.tsx startCam: 3 m behind Cam A,
0.3 m up, aimed 12 m ahead at 1 m above the ground, 50 degree vertical FOV), the same spot turned to the right-hand
wall, and 8 m to the side.
"""
import json, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'solver'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from geometry import Enu, R_from_hpr  # noqa: E402
from render_view import pose  # noqa: E402

CAM_A = dict(lat=40.70319494655987, lon=-73.98959795473623, alt=1.04, heading=3.75, pitch=3.07, roll=0.9)
spot = sys.argv[1] if len(sys.argv) > 1 else 'nyc_dumbo'
sd, out = ROOT / 'spots' / spot, ROOT / 'data' / 'splats' / spot
meta, geo = json.load(open(sd / 'spot.json')), json.load(open(sd / 'geometry.json'))
enu = Enu(meta['lat'], meta['lon'])
a = np.r_[enu.en(CAM_A['lat'], CAM_A['lon']), CAM_A['alt']]  # Cam A in the spot frame
h = np.radians(CAM_A['heading']); fwd, right = np.array([np.sin(h), np.cos(h)]), np.array([np.cos(h), -np.sin(h)])
gn, gd = np.array(geo['ground']['plane']['normal']), geo['ground']['plane']['d']
gz = lambda x, y: (gd - gn[0] * x - gn[1] * y) / gn[2]


def inside_street(p):
    return all(np.array(f['plane']['normal'])[:2] @ p[:2] - f['plane']['d'] > 1.5 for f in geo['facades'])


def cam(p, heading, pitch, f35, w, h_):
    lat, lon = enu.latlon(p[0], p[1])
    return pose(spot, lat, lon, p[2], heading, pitch, 0.0, f35, w, h_)


targets = []
for dx in (-7, -3.5, 0, 4, 9):
    for dy in (-3, 5):
        for up in (0.0, 2.0):
            p = np.r_[a[:2] + dx * right + dy * fwd, a[2] + up]
            if not inside_street(p):
                continue
            for turn in (0, -45, 45):
                c = cam(p, CAM_A['heading'] + turn, 3.0, 26, 1227, 920)
                V = np.array(c['viewmat'])
                c2w = np.linalg.inv(V)
                assert np.allclose(c2w[:3, 3], c['center'], atol=1e-6)
                targets.append(c2w.tolist())
json.dump(targets, open(out / 'difix_targets.json', 'w'))

# compare views, 1440 x 900 at Studio's 50 degree vertical FOV
W, H = 1440, 900
f35 = (H / 2) / np.tan(np.radians(25)) * 43.267 / np.hypot(W, H)
world = np.r_[a[:2] - 3 * fwd, a[2] + 0.3]
tgt = np.r_[a[:2] + 12 * fwd, 0.0]; tgt[2] = gz(*tgt[:2]) + 1
d = tgt - world
heading = float(np.degrees(np.arctan2(d[0], d[1])) % 360); pitch = float(np.degrees(np.arctan2(d[2], np.hypot(*d[:2]))))
side = np.r_[a[:2] + 8 * right, a[2]]
views = {'world': cam(world, heading, pitch, f35, W, H), 'rightwall': cam(world, heading + 50, pitch, f35, W, H),
         'side8m': cam(side, CAM_A['heading'], CAM_A['pitch'], f35, W, H)}
assert inside_street(side) and inside_street(world)
for k, v in views.items():
    json.dump(v, open(out / f'compare_{k}.json', 'w'))
print(len(targets), 'targets; compare views', {k: [round(x, 2) for x in v['center']] for k, v in views.items()},
      f'world heading {heading:.1f} pitch {pitch:.1f}, f35 {f35:.1f}')
