"""Self-check for geometry.py: run `.venv/bin/python test_geometry.py`."""
import cv2
import numpy as np

from geometry import Enu, R_from_hpr, f35_from_fpx, fpx_from_f35, georegister, hpr_from_R, project, solve_pose


def angdiff(a, b):
    return (a - b + 180) % 360 - 180


def test_conventions():
    for hpr in [(0, 0, 0), (90, 10, 5), (225, -20, -7), (355, 5, 30)]:
        R = R_from_hpr(*hpr)
        assert np.allclose(R @ R.T, np.eye(3)) and np.isclose(np.linalg.det(R), 1)
        got = hpr_from_R(R)
        assert abs(angdiff(got[0], hpr[0])) < 1e-6 and np.allclose(got[1:], hpr[1:], atol=1e-6), (hpr, got)
    # heading 90 looks east; positive pitch looks up; positive roll tips the camera's right side down
    assert np.allclose(R_from_hpr(90, 0, 0)[2], [1, 0, 0])
    assert R_from_hpr(0, 10, 0)[2][2] > 0
    assert R_from_hpr(0, 0, 10)[0][2] < 0
    assert abs(f35_from_fpx(3000, 4032, 3024) - 3000 * 43.2666 / 5040) < 1e-9
    assert abs(fpx_from_f35(f35_from_fpx(1234, 1280, 960), 1280, 960) - 1234) < 1e-9
    e = Enu(40.7033, -73.9894)
    lat, lon = e.latlon(*e.en(40.7051, -73.9871))
    assert abs(lat - 40.7051) < 1e-9 and abs(lon + 73.9871) < 1e-9
    assert abs(e.en(40.7033 + 1 / 111000, -73.9894)[1] - 1.0) < 0.01  # a degree of latitude is about 111 km


def synthetic(rng, n=600, f=1500.0, k1=-0.04, w=1600, h=1200, outliers=0.3):
    R = R_from_hpr(30, 5, -3)
    C = np.array([3.0, -20.0, 1.6])
    # points spread in front of the camera, 20 to 400 m away
    d = rng.uniform(20, 400, n)
    rays = np.c_[rng.uniform(-0.5, 0.5, n), rng.uniform(-0.35, 0.35, n), np.ones(n)]
    X = (rays * d[:, None]) @ R + C
    t = -R @ C
    x = project(cv2.Rodrigues(R)[0].ravel(), t, f, k1, w, h, X) + rng.normal(0, 1.0, (n, 2))
    bad = rng.random(n) < outliers
    x[bad] = rng.uniform(0, [w, h], (bad.sum(), 2))
    return x, X, R, C, f, w, h


def test_solve_pose():
    rng = np.random.default_rng(0)
    x, X, R, C, f, w, h = synthetic(rng)
    for lo, hi in [(fpx_from_f35(10, w, h), fpx_from_f35(300, w, h)), (0.85 * f, 1.15 * f)]:
        s = solve_pose(x, X, w, h, lo, hi)
        dh = angdiff(hpr_from_R(s['R'])[0], 30)
        print(f"C err {np.linalg.norm(s['C'] - C):.3f} m, f {s['f']:.1f}/{f}, k1 {s['k1']:.3f}, heading err {dh:.3f}, "
              f"inliers {s['n_in']}/{s['n']}")
        assert np.linalg.norm(s['C'] - C) < 1.0 and abs(s['f'] / f - 1) < 0.02 and abs(dh) < 0.5
        assert abs(s['k1'] + 0.04) < 0.02 and s['n_in'] > 0.6 * len(x)
    assert solve_pose(x[:5], X[:5], w, h, 500, 3000) is None


def test_georegister():
    rng = np.random.default_rng(1)
    n = 60
    C_enu = np.c_[rng.uniform(-150, 150, n), rng.uniform(-150, 150, n), rng.normal(1.5, 0.3, n)]
    Rs_enu = [R_from_hpr(rng.uniform(0, 360), rng.uniform(-10, 10), 0) for _ in range(n)]
    # an arbitrary SfM frame: x_sfm = A (x_enu - c) / k
    A = R_from_hpr(37, -60, 20)
    k, c = 7.3, np.array([10.0, -5.0, 3.0])
    C_sfm = (C_enu - c) @ A.T / k
    Rs_sfm = [Rw @ A.T for Rw in Rs_enu]
    gps_idx = np.arange(0, n, 2)
    gps = C_enu[gps_idx, :2] + rng.normal(0, 3, (len(gps_idx), 2))
    gps[:6] += rng.uniform(80, 200, (6, 2))  # bad GPS fixes
    s, M, T, inl, _ = georegister(C_sfm, Rs_sfm, gps_idx, gps)
    back = s * C_sfm @ M.T + T
    err = np.linalg.norm(back[:, :2] - C_enu[:, :2], axis=1)
    print(f'georegister median {np.median(err):.2f} m, max {err.max():.2f} m, GPS inliers {inl.sum()}/{len(inl)}')
    assert np.median(err) < 2.0 and err.max() < 5.0 and not inl[:6].any()
    h_err = [angdiff(hpr_from_R(Rs @ M.T)[0], hpr_from_R(Rw)[0]) for Rs, Rw in zip(Rs_sfm, Rs_enu)]
    assert np.max(np.abs(h_err)) < 2.0


if __name__ == '__main__':
    test_conventions()
    test_solve_pose()
    test_georegister()
    print('geometry ok')
