#!/usr/bin/env python3
"""Simple occluder and shadow-catcher geometry for a street spot, from its COLMAP model, in the spot's ENU frame.

  solver/.venv/bin/python splat/street_geometry.py nyc_dumbo     # writes spots/<spot>/geometry.json

Frame: metres east (x), north (y), up (z) from spot.json lat/lon, the same frame as the module's scene_object rows.
It finds the street axis from the ground-level cameras, then RANSAC fits the ground (points below camera height) and
one vertical facade on each side of the street. Facades come out as one plane plus the stretches along the street
where it has points (gaps are cross streets or missing data), each stretch a quad from the ground to the roofline.
"""
import json, sys
from pathlib import Path
import numpy as np
import pycolmap

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'solver'))
from geometry import Enu  # noqa: E402

rng = np.random.default_rng(0)


def ransac(fit, resid, X, n, thresh, iters=4000, ok=lambda m: True):
    best, best_in = None, None
    for _ in range(iters):
        m = fit(X[rng.choice(len(X), n, replace=False)])
        if m is None or not ok(m):
            continue
        inl = np.abs(resid(m, X)) < thresh
        if best_in is None or inl.sum() > best_in.sum():
            best, best_in = m, inl
    m = fit(X[best_in])  # least-squares refit on the inliers
    inl = np.abs(resid(m, X)) < thresh
    return m, inl


def lstsq_plane(X):  # z = a u + b v + c
    A = np.c_[X[:, 0], X[:, 1], np.ones(len(X))]
    return np.linalg.lstsq(A, X[:, 2], rcond=None)[0]


def lstsq_line(X):  # v = a + b u
    A = np.c_[np.ones(len(X)), X[:, 0]]
    return np.linalg.lstsq(A, X[:, 1], rcond=None)[0]


def main(spot):
    sd = ROOT / 'spots' / spot
    geo = json.load(open(sd / 'model' / 'georef.json'))
    meta = json.load(open(sd / 'spot.json'))
    s, M, T = geo['scale'], np.array(geo['M']), np.array(geo['T'])
    off = np.r_[Enu(meta['lat'], meta['lon']).en(*geo['origin']), 0.0]  # georef origin in the spot frame
    rec = pycolmap.Reconstruction(sd / 'model')
    pts = list(rec.points3D.values())
    P = np.array([p.xyz for p in pts]) @ (s * M).T + T + off
    good = (np.array([p.error for p in pts]) < 2.0) & (np.array([p.track.length() for p in pts]) >= 3)
    C = np.array([s * M @ im.projection_center() + T for im in rec.images.values() if im.has_pose]) + off

    # street axis: principal direction of the ground-level cameras near the densest line of cameras
    med = np.median(C[:, 0])
    st = (np.abs(C[:, 0] - med) < 25) & (np.abs(C[:, 2] - 1.5) < 4)
    c0 = C[st].mean(0)
    d = np.linalg.svd(C[st, :2] - c0[:2])[2][0]
    d = d if d[1] >= 0 else -d
    n = np.array([d[1], -d[0]])  # across the street, pointing to the right of d
    to_uv = lambda X: np.c_[(X[:, :2] - c0[:2]) @ d, (X[:, :2] - c0[:2]) @ n, X[:, 2]]
    Q, Qc = to_uv(P[good]), to_uv(C[st])
    u_lo, u_hi = Qc[:, 0].min() - 15, Qc[:, 0].max() + 40
    along = (Q[:, 0] > u_lo) & (Q[:, 0] < u_hi)

    # facades: a vertical plane on each side, within 15 degrees of the street direction
    facades = []
    for side, sel in (('left', (Q[:, 1] < -2) & (Q[:, 1] > -30)), ('right', (Q[:, 1] > 2) & (Q[:, 1] < 30))):
        X = Q[along & sel & (Q[:, 2] > 2) & (Q[:, 2] < 45)]
        (a, b), inl = ransac(lstsq_line, lambda m, X: X[:, 1] - (m[0] + m[1] * X[:, 0]), X[:, :2], 2, 0.75,
                             ok=lambda m: abs(m[1]) < np.tan(np.radians(15)))
        Xi = X[inl]
        # stretches along the street that have facade points: 4 m bins, gaps of 8 m or more split them
        bins = np.floor(Xi[:, 0] / 4).astype(int)
        occ = sorted(b_ for b_ in set(bins) if (bins == b_).sum() >= 3)
        runs, cur = [], [occ[0]]
        for b_ in occ[1:]:
            if b_ - cur[-1] <= 2:
                cur.append(b_)
            else:
                runs.append(cur); cur = [b_]
        runs.append(cur)
        facades.append(dict(side=side, a=a, b=b, X=Xi, rms=float(np.sqrt(np.mean((Xi[:, 1] - a - b * Xi[:, 0]) ** 2))),
                            runs=[(r[0] * 4.0, (r[-1] + 1) * 4.0) for r in runs if (r[-1] - r[0] + 1) * 4 >= 8]))

    # ground: the street slopes, so seed it from the cameras' feet (handheld at about 1.5 m), then refine with SfM
    # points between the facades within 1 m of that line. Too few points: keep the feet line, level across the street.
    feet_s, feet_c = np.polyfit(Qc[:, 0], Qc[:, 2] - 1.5, 1)
    v_l = facades[0]['a'] + facades[0]['b'] * Q[:, 0]
    v_r = facades[1]['a'] + facades[1]['b'] * Q[:, 0]
    G = Q[along & (Q[:, 1] > v_l + 0.5) & (Q[:, 1] < v_r - 0.5) & (np.abs(Q[:, 2] - (feet_s * Q[:, 0] + feet_c)) < 1.0)]
    gp, ginl = (ransac(lstsq_plane, lambda m, X: X[:, 2] - (m[0] * X[:, 0] + m[1] * X[:, 1] + m[2]), G, 3, 0.3,
                       ok=lambda m: np.hypot(m[0], m[1]) < np.tan(np.radians(10))) if len(G) >= 30 else (None, None))
    ground_src = 'SfM ground points'
    if ginl is None or ginl.sum() < 30:
        gp, ginl, ground_src = np.array([feet_s, 0.0, feet_c]), np.ones(len(G), bool), 'camera feet line (too few ground points)'
    ground_z = lambda u, v: gp[0] * u + gp[1] * v + gp[2]

    # back to the spot frame
    def enu(u, v, z):
        xy = c0[:2] + u * d + v * n
        return [round(float(xy[0]), 3), round(float(xy[1]), 3), round(float(z), 3)]

    def plane_enu(normal_uvz, point_enu):
        nu, nv, nz = normal_uvz
        nn = np.r_[nu * d + nv * n, nz]
        nn /= np.linalg.norm(nn)
        return dict(normal=[round(float(x), 5) for x in nn], d=round(float(nn @ np.array(point_enu)), 3))

    u0, u1 = u_lo, u_hi
    gl = [(u0, facades[0]['a'] + facades[0]['b'] * u0), (u1, facades[0]['a'] + facades[0]['b'] * u1),
          (u1, facades[1]['a'] + facades[1]['b'] * u1), (u0, facades[1]['a'] + facades[1]['b'] * u0)]
    ground_poly = [enu(u, v, ground_z(u, v)) for u, v in gl]
    out_f = []
    for f in facades:
        top = float(np.percentile(f['X'][:, 2], 95))
        vv = lambda u: f['a'] + f['b'] * u
        segs = [[enu(ua, vv(ua), ground_z(ua, vv(ua))), enu(ub, vv(ub), ground_z(ub, vv(ub))),
                 enu(ub, vv(ub), top), enu(ua, vv(ua), top)] for ua, ub in f['runs']]
        # normal faces the street centre
        inward = np.array([-f['b'], 1.0, 0.0]) * (1 if f['side'] == 'left' else -1)
        out_f.append(dict(name=f"{'west' if (f['side'] == 'left') == (d[1] > 0) else 'east'} side of the street",
                          plane=plane_enu(inward, segs[0][0]), height_m=round(top - ground_z(0, vv(0)), 1),
                          inliers=int(len(f['X'])), rms_m=round(f['rms'], 2),
                          quads=segs))
    gn = np.array([-gp[0], -gp[1], 1.0])
    feet_rms = float(np.sqrt(np.mean((Qc[:, 2] - 1.5 - ground_z(Qc[:, 0], Qc[:, 1])) ** 2)))
    ground = dict(plane=plane_enu(gn, ground_poly[0]), polygon=ground_poly, source=ground_src, inliers=int(ginl.sum()),
                  street_camera_height_rms_m=round(feet_rms, 2),
                  rms_m=round(float(np.sqrt(np.mean((G[ginl][:, 2] - ground_z(G[ginl][:, 0], G[ginl][:, 1])) ** 2))), 2),
                  slope_deg=round(float(np.degrees(np.arctan(np.hypot(gp[0], gp[1])))), 2))
    # one triangle mesh with every quad, for a three.js BufferGeometry (counter-clockwise seen from the street)
    verts, tris = [], []
    for quad in [ground_poly] + [q for f in out_f for q in f['quads']]:
        k = len(verts); verts += quad; tris += [[k, k + 1, k + 2], [k, k + 2, k + 3]]
    res = dict(
        spot=spot, frame='metres east (x), north (y), up (z) from spot.json lat/lon; ground near z = 0',
        origin=dict(lat=meta['lat'], lon=meta['lon']),
        source=f'COLMAP model {meta.get("model_version")}: {len(P)} points ({int(good.sum())} with error < 2 px and track >= 3), '
               f'georegistered by EXIF GPS (median residual {json.load(open(sd / "stats.json"))["georef"]["resid_median_m"]:.1f} m)',
        street=dict(heading_deg=round(float(np.degrees(np.arctan2(d[0], d[1]))) % 360, 1), centre=enu(0, 0, ground_z(0, 0)),
                    width_m=round(float(facades[1]['a'] - facades[0]['a']), 1)),
        ground=ground, facades=out_f, mesh=dict(vertices=verts, triangles=tris),
        notes='Planes are n . x = d with unit normal n facing the street. Quads run ground, ground, top, top. '
              'Built from sparse SfM points, so expect about 1 m of error; good enough for shadow catching and occlusion, not for measurement.')
    (sd / 'geometry.json').write_text(json.dumps(res, indent=1))
    return res, c0, d, n, ground_z


if __name__ == '__main__':
    spot = sys.argv[1] if len(sys.argv) > 1 else 'nyc_dumbo'
    res, c0, d, n, gz = main(spot)
    # self-check: the street is between the facades, the ground is level-ish and near z = 0, cameras stand above it
    f0, f1 = res['facades']
    assert 6 < res['street']['width_m'] < 40, res['street']
    assert res['ground']['slope_deg'] < 10 and abs(res['street']['centre'][2]) < 3, res['ground']
    assert res['ground']['street_camera_height_rms_m'] < 1.0, 'street cameras should stand about 1.5 m above the ground'
    for f in res['facades']:
        nn, dd = np.array(f['plane']['normal']), f['plane']['d']
        assert nn @ np.r_[c0[:2], 1.5] - dd > 1, f'street centre must be in front of the {f["name"]} facade'
    print(json.dumps({k: res[k] for k in ('street',)}), 'ground', {k: res['ground'][k] for k in ('source', 'inliers', 'rms_m', 'slope_deg', 'street_camera_height_rms_m')})
    for f in res['facades']:
        print(f['name'], {k: f[k] for k in ('inliers', 'rms_m', 'height_m')}, 'stretches', [(q[0][:2], q[1][:2]) for q in f['quads']])
