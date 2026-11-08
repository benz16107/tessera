"""Pose, lens and georegistration math shared by the spot build and the solver.

World frame is local ENU metres (x east, y north, z up). Camera rotations are world->camera with
OpenCV axes (x right, y down, z forward). Angle conventions follow CONTRACTS.md.
"""
import cv2
import numpy as np
from scipy.optimize import least_squares

DIAG_35 = 43.2666  # mm, diagonal of a 36 x 24 mm frame
WGS_A, WGS_E2 = 6378137.0, 6.69437999014e-3


def f35_from_fpx(fpx, w, h):
    return fpx * DIAG_35 / np.hypot(w, h)


def fpx_from_f35(f35, w, h):
    return f35 * np.hypot(w, h) / DIAG_35


class Enu:
    """Flat east/north plane around an origin, with WGS84 radii at the origin. Fine within a few km."""

    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = float(lat0), float(lon0)
        s = np.sin(np.radians(lat0))
        d = 1 - WGS_E2 * s * s
        self.rn = WGS_A * (1 - WGS_E2) / d ** 1.5
        self.re = WGS_A / np.sqrt(d) * np.cos(np.radians(lat0))

    def en(self, lat, lon):
        return np.array([np.radians(lon - self.lon0) * self.re, np.radians(lat - self.lat0) * self.rn])

    def latlon(self, e, n):
        return self.lat0 + float(np.degrees(n / self.rn)), self.lon0 + float(np.degrees(e / self.re))


def _level_axes(heading, fwd):
    hr = np.radians(heading)
    r0 = np.array([np.cos(hr), -np.sin(hr), 0.0])  # right vector of the same camera with zero roll
    return r0, np.cross(r0, fwd)


def hpr_from_R(R):
    """Heading (clockwise from north), pitch (up positive), roll (clockwise positive as seen by the camera), degrees."""
    right, fwd = R[0], R[2]
    heading = float(np.degrees(np.arctan2(fwd[0], fwd[1])) % 360)
    pitch = float(np.degrees(np.arcsin(np.clip(fwd[2], -1, 1))))
    r0, u0 = _level_axes(heading, fwd)
    roll = float(np.degrees(np.arctan2(-right @ u0, right @ r0)))
    return heading, pitch, roll


def R_from_hpr(heading, pitch, roll):
    h, p, r = np.radians([heading, pitch, roll])
    fwd = np.array([np.sin(h) * np.cos(p), np.cos(h) * np.cos(p), np.sin(p)])
    r0, u0 = _level_axes(heading, fwd)
    right = r0 * np.cos(r) - u0 * np.sin(r)
    up = u0 * np.cos(r) + r0 * np.sin(r)
    return np.stack([right, -up, fwd])


def project(rvec, t, f, k1, w, h, X):
    """Pinhole with principal point at the image centre and one radial term (COLMAP SIMPLE_RADIAL)."""
    Xc = X @ cv2.Rodrigues(np.asarray(rvec, np.float64))[0].T + t
    xy = Xc[:, :2] / Xc[:, 2:3]
    return f * xy * (1 + k1 * (xy ** 2).sum(1, keepdims=True)) + [w / 2, h / 2]


def solve_pose(x2d, X3d, w, h, f_lo, f_hi, extra_f=(), thresh=None, step=1.1, iters=2000):
    """Pose, focal (px) and k1 from 2D-3D matches: RANSAC PnP over a focal grid, then joint refinement."""
    x2d = np.ascontiguousarray(x2d, np.float64)
    X3d = np.ascontiguousarray(X3d, np.float64)
    if len(x2d) < 12:
        return None
    thresh = thresh or 0.008 * max(w, h)
    n_steps = max(3, int(np.ceil(np.log(f_hi / f_lo) / np.log(step))) + 1)
    best = None
    for f in np.r_[np.geomspace(f_lo, f_hi, n_steps), list(extra_f)]:
        K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1.0]])
        try:
            ok, rv, tv, inl = cv2.solvePnPRansac(X3d, x2d, K, None, iterationsCount=iters, reprojectionError=thresh,
                                                 confidence=0.999, flags=cv2.SOLVEPNP_SQPNP)
        except cv2.error:  # SQPNP throws on degenerate minimal samples
            continue
        if not ok or inl is None or not np.isfinite(rv).all() or not np.isfinite(tv).all():
            continue
        inl = inl.ravel()
        err = np.median(np.linalg.norm(project(rv.ravel(), tv.ravel(), f, 0, w, h, X3d[inl]) - x2d[inl], axis=1))
        # with few points many focal lengths fit them all, so ties go to the lower error
        if best is None or (len(inl), -err) > (len(best[3]), -best[4]):
            best = (f, rv.ravel(), tv.ravel(), inl, err)
    if best is None:
        return None
    f, rv, tv, inl, _ = best
    p = np.r_[rv, tv, np.log(f), 0.0]
    lo = np.r_[[-np.inf] * 7, -0.5]
    hi = np.r_[[np.inf] * 7, 0.5]
    for _ in range(2):
        if len(inl) < 6:
            return None
        sel = inl

        def residual(q):
            return (project(q[:3], q[3:6], np.exp(q[6]), q[7], w, h, X3d[sel]) - x2d[sel]).ravel()

        p = least_squares(residual, p, bounds=(lo, hi), loss='soft_l1', f_scale=thresh / 2).x
        err = np.linalg.norm(project(p[:3], p[3:6], np.exp(p[6]), p[7], w, h, X3d) - x2d, axis=1)
        inl = np.where(err < thresh)[0]
    R = cv2.Rodrigues(p[:3])[0]
    return dict(R=R, t=p[3:6], C=-R.T @ p[3:6], f=float(np.exp(p[6])), k1=float(p[7]), n_in=len(inl), n=len(x2d),
                rmse=float(np.sqrt(np.mean(err[inl] ** 2))) if len(inl) else None)


def gravity_up(Rs):
    """Model 'up' assuming photos are taken upright: the direction most orthogonal to every camera x axis."""
    Rs = np.asarray(Rs)
    up = np.linalg.svd(Rs[:, 0, :])[2][-1]
    return up if up @ (-Rs[:, 1, :]).mean(0) > 0 else -up


def _rot_to_z(up):
    z = up / np.linalg.norm(up)
    x = np.cross([0.0, 1.0, 0.0] if abs(z[1]) < 0.9 else [1.0, 0.0, 0.0], z)
    x /= np.linalg.norm(x)
    return np.stack([x, np.cross(z, x), z])


def fit_sim2(a, b):
    """Least-squares 2D similarity b ~ s R a + t (Umeyama)."""
    ma, mb = a.mean(0), b.mean(0)
    A, B = a - ma, b - mb
    U, S, Vt = np.linalg.svd(B.T @ A)
    D = np.diag([1.0, np.sign(np.linalg.det(U @ Vt))])
    R = U @ D @ Vt
    s = (S * np.diag(D)).sum() / (A ** 2).sum()
    return s, R, mb - s * R @ ma


def georegister(centers, Rs, gps_idx, gps_en, thresh=15.0, iters=3000, seed=0):
    """Similarity from SfM coordinates to ENU: gravity from upright cameras, then a robust 2D fit to GPS.

    GPS altitude is too noisy to use, so height is only rescaled; the median camera sits at z = 1.5 m.
    Returns scale s, rotation M, shift T (x_enu = s M x + T), the GPS inlier mask and per-GPS residuals.
    """
    G = _rot_to_z(gravity_up(Rs))
    src = np.asarray(centers) @ G.T
    a, b = src[gps_idx, :2], np.asarray(gps_en, float)
    if len(a) < 3:
        raise ValueError(f'need 3 registered photos with GPS, have {len(a)}')
    rng = np.random.default_rng(seed)
    best, best_key = None, None
    for _ in range(iters):
        i, j = rng.choice(len(a), 2, replace=False)
        if np.linalg.norm(a[i] - a[j]) < 1e-9:
            continue
        s, R2, t2 = fit_sim2(a[[i, j]], b[[i, j]])
        r = np.linalg.norm(s * a @ R2.T + t2 - b, axis=1)
        inl = r < thresh
        key = (inl.sum(), -np.median(r[inl]))
        if best_key is None or key > best_key:
            best, best_key = inl, key
    if best.sum() < 3:
        raise ValueError(f'GPS does not fit the model: only {best.sum()} photos agree within {thresh} m')
    for _ in range(3):
        s, R2, t2 = fit_sim2(a[best], b[best])
        r = np.linalg.norm(s * a @ R2.T + t2 - b, axis=1)
        best = r < thresh
    M = np.eye(3)
    M[:2, :2] = R2
    M = M @ G
    T = np.r_[t2, 1.5 - s * np.median(src[:, 2])]
    return s, M, T, best, r
