"""Solver HTTP service on 127.0.0.1:8791 (CONTRACTS.md): `.venv/bin/python server.py`."""
import json
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import h5py
import numpy as np
import pycolmap
import torch
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse, StreamingResponse
from PIL import Image, ImageOps
from pydantic import BaseModel

from geometry import Enu, f35_from_fpx, fpx_from_f35, hpr_from_R, solve_pose
from matching import Models, normalize

SPOTS_DIR = Path(__file__).resolve().parent.parent / 'spots'
TOP_K = 20
MIN_INLIERS = 200  # uncalibrated: the DUMBO failure had 78, the weakest good result 336
FAR_M = 40
F35_DEFAULT = (10.0, 300.0)
CAMERA_HEIGHT = 1.5


class Spot:
    """A spot's model, georegistration, retrieval descriptors and local features, held in memory."""

    def __init__(self, spot_dir):
        model = spot_dir / 'model'
        self.id = spot_dir.name
        rec = pycolmap.Reconstruction(model)
        geo = json.load(open(model / 'georef.json'))
        self.enu = Enu(*geo['origin'])
        s, M, T = geo['scale'], np.array(geo['M']), np.array(geo['T'])
        regs = sorted((im for im in rec.images.values() if im.has_pose), key=lambda im: im.name)
        self.names = [im.name for im in regs]
        pids = sorted(rec.points3D)
        self.xyz = np.array([rec.points3D[p].xyz for p in pids]) @ (s * M).T + T
        row = {p: i for i, p in enumerate(pids)}
        # per image: model point row for each keypoint, -1 where the keypoint has no 3D point
        self.kp_point = [np.array([row[p.point3D_id] if p.has_point3D() else -1 for p in im.points2D]) for im in regs]
        self.centers = np.array([s * M @ im.projection_center() + T for im in regs])
        with h5py.File(model / 'global.h5', 'r') as f:
            self.gdesc = np.stack([f[n]['global_descriptor'][()] for n in self.names]).astype(np.float32)
        with h5py.File(model / 'local.h5', 'r') as f:
            self.local = [dict(keypoints=f[n]['keypoints'][()].astype(np.float32),
                               descriptors=torch.from_numpy(f[n]['descriptors'][()].astype(np.float32)),
                               size=f[n]['image_size'][()]) for n in self.names]

    def ground_z(self, C):
        """Local ground height: registered cameras within 30 m (else the 5 nearest) were held about 1.5 m up."""
        d = np.linalg.norm(self.centers[:, :2] - C[:2], axis=1)
        near = d < 30 if (d < 30).sum() >= 3 else np.argsort(d)[:5]
        return float(np.median(self.centers[near, 2])) - CAMERA_HEIGHT


def blank(**kw):
    r = dict(ok=True, error='', lat=0.0, lon=0.0, alt=0.0, heading=0.0, pitch=0.0, roll=0.0, f35=0.0, fpx=0.0,
             width=0, height=0, inliers=0, confidence='none', reason='', nearest_camera_m=0.0, secs=0.0)
    r.update(kw)
    return r


def solve(spot, models, photo_path, f35_range=None, exif_f35=None):
    """Yields {'progress': str} dicts, then one {'result': {...}} dict."""
    t0 = time.time()
    try:
        with Image.open(photo_path) as im:
            W, H = ImageOps.exif_transpose(im).size
    except (OSError, ValueError) as e:
        yield {'result': blank(ok=False, error=f'cannot read photo: {e}')}
        return
    yield {'progress': 'reading the photo'}
    with tempfile.TemporaryDirectory() as tmp:
        q = Path(tmp) / 'q.jpg'
        normalize(photo_path, q)
        gdesc, feats = models.features(q)
    w, h = (int(v) for v in feats['size'])
    top = np.argsort(-(spot.gdesc @ gdesc))[:TOP_K]
    yield {'progress': f'matching {len(top)} nearby photos'}
    x2d, X3d, seen = [], [], set()
    kq = feats['keypoints'] + 0.5  # COLMAP puts pixel centres at +0.5, as hloc does on import
    for j in top:
        for iq, idb in models.match(feats, spot.local[j]):
            row = spot.kp_point[j][idb]
            if row < 0 or (iq, row) in seen:
                continue
            seen.add((iq, row))
            x2d.append(kq[iq])
            X3d.append(spot.xyz[row])
    yield {'progress': f'solving the camera from {len(x2d)} matches'}
    lo35, hi35 = f35_range or F35_DEFAULT
    extra = [fpx_from_f35(exif_f35, w, h)] if exif_f35 and lo35 <= exif_f35 <= hi35 else []
    sol = solve_pose(np.array(x2d).reshape(-1, 2), np.array(X3d).reshape(-1, 3), w, h,
                     fpx_from_f35(lo35, w, h), fpx_from_f35(hi35, w, h), extra_f=extra)
    secs = round(time.time() - t0, 1)
    if sol is None:
        yield {'result': blank(width=W, height=H, reason=f'only {len(x2d)} matches to the model', secs=secs)}
        return
    C, n = sol['C'], sol['n_in']
    heading, pitch, roll = hpr_from_R(sol['R'])
    f35 = float(f35_from_fpx(sol['f'], w, h))
    near = float(np.min(np.linalg.norm(spot.centers[:, :2] - C[:2], axis=1)))
    lat, lon = spot.enu.latlon(C[0], C[1])
    if n < MIN_INLIERS:
        conf, reason = 'none', f'only {n} matches, {MIN_INLIERS} needed'
    elif near > FAR_M:
        conf, reason = 'check', f'{n} matches, but {near:.0f} m from any mapped camera'
    elif f35_range and not lo35 <= f35 <= hi35:
        conf, reason = 'check', f'{n} matches, but the {f35:.0f} mm lens is outside {lo35:.0f}-{hi35:.0f} mm'
    else:
        conf, reason = 'solid', f'{n} matches, {near:.0f} m from a mapped camera'
    yield {'result': blank(lat=lat, lon=lon, alt=round(float(C[2]) - spot.ground_z(C), 2), heading=round(heading, 2),
                           pitch=round(pitch, 2), roll=round(roll, 2), f35=round(f35, 2),
                           fpx=round(float(fpx_from_f35(f35, W, H)), 1), width=W, height=H, inliers=n,
                           confidence=conf, reason=reason, nearest_camera_m=round(near, 1), secs=secs)}


def load_spots():
    return {d.parent.parent.name: Spot(d.parent.parent) for d in sorted(SPOTS_DIR.glob('*/model/georef.json'))}


STATE = {}
LOCK = threading.Lock()  # one solve at a time; torch already uses every core


@asynccontextmanager
async def lifespan(app):
    STATE['models'] = Models()
    STATE['spots'] = load_spots()
    print('spots loaded:', ', '.join(STATE['spots']) or 'none', flush=True)
    yield


app = FastAPI(lifespan=lifespan)


class SolveRequest(BaseModel):
    photo_path: str
    spot_id: str
    f35_range: tuple[float, float] | None = None
    exif_f35: float | None = None


@app.post('/solve')
def post_solve(req: SolveRequest):
    def lines():
        spot = STATE['spots'].get(req.spot_id)
        if spot is None:
            yield json.dumps({'result': blank(ok=False, error=f'spot {req.spot_id} is not loaded')}) + '\n'
            return
        if not Path(req.photo_path).is_file():
            yield json.dumps({'result': blank(ok=False, error=f'no file at {req.photo_path}')}) + '\n'
            return
        if LOCK.locked():
            yield json.dumps({'progress': 'waiting for another solve'}) + '\n'
        with LOCK:
            try:
                for item in solve(spot, STATE['models'], req.photo_path, req.f35_range, req.exif_f35):
                    yield json.dumps(item) + '\n'
            except Exception as e:  # the client always gets a final line
                yield json.dumps({'result': blank(ok=False, error=f'solver error: {e}')}) + '\n'

    return StreamingResponse(lines(), media_type='application/x-ndjson')


@app.get('/spots')
def get_spots():
    return sorted(STATE['spots'])


@app.get('/health', response_class=PlainTextResponse)
def health():
    return 'ok'


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(app, host='127.0.0.1', port=8791)
