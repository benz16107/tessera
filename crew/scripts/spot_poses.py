"""Read-only: print the georegistered pose of every registered training image in a spot model as JSON.
Runs with the solver's venv (pycolmap) and reuses solver/geometry.py; writes nothing.
Usage: solver/.venv/bin/python crew/scripts/spot_poses.py spots/nyc_dumbo
"""
import json, sys
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(repo / 'solver'))
import numpy as np, pycolmap  # noqa: E402
from geometry import Enu, hpr_from_R, f35_from_fpx  # noqa: E402

model = Path(sys.argv[1]) / 'model'
rec = pycolmap.Reconstruction(model)
geo = json.load(open(model / 'georef.json'))
enu, s, M, T = Enu(*geo['origin']), geo['scale'], np.array(geo['M']), np.array(geo['T'])
out = {}
for im in rec.images.values():
    if not im.has_pose:
        continue
    cam = rec.cameras[im.camera_id]
    R = im.cam_from_world().rotation.matrix() @ M.T  # rows are the camera axes in east/north/up
    C = s * M @ im.projection_center() + T
    h, p, r = hpr_from_R(R)
    lat, lon = enu.latlon(C[0], C[1])
    out[im.name] = dict(lat=round(lat, 7), lon=round(lon, 7), heading=round(h, 1), pitch=round(p, 1), roll=round(r, 1),
                        f35=round(float(f35_from_fpx(cam.params[0], cam.width, cam.height)), 1))
json.dump(out, sys.stdout)
