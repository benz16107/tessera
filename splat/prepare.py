#!/usr/bin/env python3
"""Turn a spot's COLMAP model into a Gaussian-splat training input, in the model's georegistered ENU frame.

  solver/.venv/bin/python splat/prepare.py nyc_dumbo     # writes data/splats/<spot>/input/{images,sparse}

With spots/<spot>/geometry.json present (splat/street_geometry.py), only cameras in the street corridor are kept:
within 25 m across and 120 m along the street, at street level. The first DUMBO run used all 127 views; the far
ones (across the river, on the bridge) blew gsplat's scene scale up to 395 m and the street came out mush.

The model is moved into ENU metres (x_enu = s M x + T from model/georef.json, origin = georef origin), so the
trained splat needs no transform beyond the shift to the spot's own origin. Images are undistorted to PINHOLE
(SIMPLE_RADIAL in the model) and capped at 1600 px, the size the splat trains at.
"""
import json, shutil, sys
from pathlib import Path
import numpy as np
import pycolmap

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parent.parent
spot = sys.argv[1]
src = ROOT / 'spots' / spot
out = ROOT / 'data' / 'splats' / spot
g = json.load(open(src / 'model' / 'georef.json'))
rec = pycolmap.Reconstruction(src / 'model')
pid = next(iter(rec.points3D))
want = g['scale'] * np.array(g['M']) @ rec.points3D[pid].xyz + np.array(g['T'])
rec.transform(pycolmap.Sim3d(g['scale'], pycolmap.Rotation3d(np.array(g['M'])), np.array(g['T']).reshape(3, 1)))
assert np.allclose(rec.points3D[pid].xyz, want, atol=1e-6), 'Sim3d did not match x_enu = s M x + T'
enu = out / 'model_enu'
shutil.rmtree(enu, ignore_errors=True); enu.mkdir(parents=True)
geo_f = src / 'geometry.json'
if geo_f.exists():
    from street_geometry import Enu  # same flat ENU as the solver
    gm = json.load(open(geo_f))
    meta = json.load(open(src / 'spot.json'))
    off = np.r_[Enu(meta['lat'], meta['lon']).en(*g['origin']), 0.0]
    c = np.array(gm['street']['centre']); hd = np.radians(gm['street']['heading_deg'])
    dirn = np.array([np.sin(hd), np.cos(hd)]); across = np.array([dirn[1], -dirn[0]])
    drop = []
    for im in rec.images.values():
        C = im.projection_center() + off
        u, v = (C[:2] - c[:2]) @ dirn, (C[:2] - c[:2]) @ across
        if not (abs(v) < 25 and abs(u) < 120 and abs(C[2] - 1.5) < 10):
            drop.append(im.frame_id)
    for f in set(drop):
        rec.deregister_frame(f)
    print('street corridor keeps', rec.num_reg_images(), 'of', rec.num_images(), 'cameras')
rec.write(enu)
opt = pycolmap.UndistortCameraOptions(); opt.max_image_size = 1600
shutil.rmtree(out / 'input', ignore_errors=True)
pycolmap.undistort_images(out / 'input', enu, src / 'sfm' / 'images', image_names=[im.name for im in rec.images.values() if im.has_pose], undistort_options=opt)  # sfm/images: the copies the model was built from
for junk in ('stereo', 'run-colmap-geometric.sh', 'run-colmap-photometric.sh'):
    p = out / 'input' / junk
    shutil.rmtree(p) if p.is_dir() else p.unlink(missing_ok=True)
print('wrote', out / 'input', rec.num_reg_images(), 'images')
