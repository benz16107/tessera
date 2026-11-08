"""Build a spot's georegistered SfM model: `.venv/bin/python build_spot.py <spot_id>`.

Reads spots/<id>/images (EXIF GPS, heading and focal; spots/<id>/train_meta.json overrides per file when present),
caches features and matches in spots/<id>/sfm/, writes spots/<id>/model/, stats.json and spot.json.
"""
import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import pycolmap
from hloc import extract_features, match_features, pairs_from_retrieval, reconstruction, triangulation

from geometry import Enu, fpx_from_f35, georegister, hpr_from_R
from matching import GLOBAL_CONF, IMAGE_EXTS, LOCAL_CONF, MATCH_CONF, exif_f35, normalize, read_exif

SPOTS = Path(__file__).resolve().parent.parent / 'spots'
NUM_PAIRS = 20
MIRROR_DEG = 90
MAX_ROUNDS = 3


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def load_meta(files, override_file):
    """EXIF from each photo, overridden per file by a JSON list of {file, lat, lon, heading, ...} when it exists
    (the Commons thumbnails lost their EXIF). Keyed by the normalized name <stem>.jpg."""
    override = {m['file']: m for m in json.load(open(override_file))} if override_file.exists() else {}
    meta = {}
    for f in files:
        m = read_exif(f)
        for k in ('lat', 'lon', 'heading', 'heading_ref', 'f35', 'zoom'):
            if override.get(f.name, {}).get(k) is not None:
                m[k] = override[f.name][k]
        meta[f.stem + '.jpg'] = m
    return meta


def true_heading(m):
    # shortcut: magnetic headings are skipped rather than corrected, since that needs a declination model
    if m.get('heading') is None or str(m.get('heading_ref') or 'T').upper().startswith('M'):
        return None
    return m['heading']


def map_images(sfm, names, meta, pairs_all, local, matches):
    """Incremental mapping on a subset of images, reusing the cached features and matches."""
    keep = set(names)
    pairs = sfm / 'pairs-map.txt'
    pairs.write_text(''.join(f'{a} {b}\n' for a, b in pairs_all if a in keep and b in keep))
    out = sfm / 'map'
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    db = out / 'database.db'
    reconstruction.create_empty_db(db)
    reconstruction.import_images(sfm / 'images', db, pycolmap.CameraMode.PER_IMAGE, names, {'camera_model': 'SIMPLE_RADIAL'})
    ids = reconstruction.get_image_ids(db)
    with pycolmap.Database.open(db) as d:
        for im in d.read_all_images():
            f35 = exif_f35(meta[im.name])
            if f35:
                cam = d.read_camera(im.camera_id)
                cam.focal_length = fpx_from_f35(f35, cam.width, cam.height)
                cam.has_prior_focal_length = True
                d.update_camera(cam)
        triangulation.import_features(ids, d, local)
        triangulation.import_matches(ids, d, pairs, matches)
    triangulation.estimation_and_geometric_verification(db, pairs)
    rec = reconstruction.run_reconstruction(out, db, sfm / 'images')
    if rec is None:
        raise RuntimeError('mapping produced no model')
    return rec


def georef(rec, meta, enu):
    regs = sorted((im for im in rec.images.values() if im.has_pose), key=lambda im: im.name)
    Rs = [im.cam_from_world().rotation.matrix() for im in regs]
    C = [im.projection_center() for im in regs]
    gps_idx = [i for i, im in enumerate(regs) if meta[im.name]['lat'] is not None]
    gps_en = [enu.en(meta[regs[i].name]['lat'], meta[regs[i].name]['lon']) for i in gps_idx]
    s, M, T, inl, res = georegister(C, Rs, gps_idx, gps_en)
    heading = {}
    for im, R in zip(regs, Rs):
        h = true_heading(meta[im.name])
        if h is not None:
            heading[im.name] = float((hpr_from_R(R @ M.T)[0] - h + 180) % 360 - 180)
    return dict(scale=float(s), M=M.tolist(), T=T.tolist(), origin=[enu.lat0, enu.lon0], n_gps=len(gps_idx),
                n_gps_inliers=int(inl.sum()), resid_median_m=float(np.median(res[inl])),
                resid_p90_m=float(np.percentile(res[inl], 90)),
                gps_resid_m={regs[i].name: round(float(r), 1) for i, r in zip(gps_idx, res)},
                heading_diff_deg=heading)


def main(spot_id):
    t_start = time.time()
    spot_dir = SPOTS / spot_id
    sfm = spot_dir / 'sfm'
    files = sorted(p for p in (spot_dir / 'images').iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if not files:
        sys.exit(f'no images in {spot_dir / "images"}')
    T = {}

    def stage(name, fn):
        t = time.time()
        r = fn()
        T[name] = round(time.time() - t, 1)
        log(f'{name}: {T[name]} s')
        return r

    def prepare():
        for f in files:
            dst = sfm / 'images' / (f.stem + '.jpg')
            if not dst.exists() or dst.stat().st_mtime < f.stat().st_mtime:
                normalize(f, dst)
        return load_meta(files, spot_dir / 'train_meta.json')

    meta = stage('prepare', prepare)
    names = sorted(meta)
    gps = np.array([(m['lat'], m['lon']) for m in meta.values() if m['lat'] is not None])
    log(f'{len(names)} images, {len(gps)} with GPS, {sum(true_heading(m) is not None for m in meta.values())} with heading')
    if len(gps) < 3:
        sys.exit('need at least 3 photos with GPS to georegister')
    enu = Enu(*np.median(gps, 0))

    gfeat = stage('megaloc', lambda: extract_features.main(GLOBAL_CONF, sfm / 'images', image_list=names,
                                                           feature_path=sfm / 'global.h5'))
    pairs_path = sfm / f'pairs-top{NUM_PAIRS}.txt'
    stage('pairs', lambda: pairs_from_retrieval.main(gfeat, pairs_path, NUM_PAIRS, query_list=names, db_list=names))
    local = stage('superpoint', lambda: extract_features.main(LOCAL_CONF, sfm / 'images', image_list=names,
                                                              feature_path=sfm / 'local.h5'))
    matches = sfm / 'matches.h5'
    stage('lightglue', lambda: match_features.main(MATCH_CONF, pairs_path, local, matches=matches))
    pairs_all = [tuple(line.split()) for line in pairs_path.read_text().splitlines() if line.strip()]

    dropped, rounds = {}, []
    use = list(names)
    for rnd in range(1, MAX_ROUNDS + 1):
        rec = stage(f'mapping_{rnd}', lambda: map_images(sfm, use, meta, pairs_all, local, matches))
        geo = georef(rec, meta, enu)
        mirrors = {n: d for n, d in geo['heading_diff_deg'].items() if abs(d) > MIRROR_DEG}
        rounds.append(dict(images=len(use), registered=rec.num_reg_images(), points3D=rec.num_points3D(),
                           gps_inliers=f"{geo['n_gps_inliers']}/{geo['n_gps']}", mirrors=sorted(mirrors)))
        log(f'round {rnd}: {rec.num_reg_images()}/{len(use)} registered, {rec.num_points3D()} points, '
            f"GPS {geo['n_gps_inliers']}/{geo['n_gps']} within 15 m (median {geo['resid_median_m']:.1f} m), "
            f'{len(mirrors)} mirror registrations')
        for n, d in sorted(mirrors.items()):
            log(f'  drop {n}: SfM heading {d:+.0f} deg from EXIF')
        if not mirrors:
            break
        if rnd == MAX_ROUNDS:
            log(f'  {len(mirrors)} mirror registrations remain after {MAX_ROUNDS} rounds; kept in the model')
            break
        dropped.update({n: round(d, 1) for n, d in mirrors.items()})
        use = [n for n in use if n not in mirrors]

    model = spot_dir / 'model'
    shutil.rmtree(model, ignore_errors=True)
    model.mkdir()
    rec.write(model)
    shutil.copy(gfeat, model / 'global.h5')
    shutil.copy(local, model / 'local.h5')
    json.dump({k: geo[k] for k in ('scale', 'M', 'T', 'origin')}, open(model / 'georef.json', 'w'), indent=1)

    s, M, Tr = geo['scale'], np.array(geo['M']), np.array(geo['T'])
    cams = np.array([s * M @ im.projection_center() + Tr for im in rec.images.values() if im.has_pose])
    center = np.median(cams[:, :2], 0)
    radius = float(np.max(np.linalg.norm(cams[:, :2] - center, axis=1)))
    lat, lon = enu.latlon(*center)
    hd = np.abs(list(geo['heading_diff_deg'].values()))
    T['total'] = round(time.time() - t_start, 1)
    stats = dict(images_in=len(names), images_gps=len(gps), registered=rec.num_reg_images(),
                 points3D=rec.num_points3D(), mean_reproj_px=round(rec.compute_mean_reprojection_error(), 3),
                 mean_track_len=round(rec.compute_mean_track_length(), 2), pairs=len(pairs_all),
                 georef={k: geo[k] for k in ('n_gps', 'n_gps_inliers', 'resid_median_m', 'resid_p90_m', 'gps_resid_m')},
                 heading_check=dict(n=len(hd), median_abs_diff_deg=round(float(np.median(hd)), 1) if len(hd) else None,
                                    over_90=int((hd > MIRROR_DEG).sum())),
                 dropped_mirrors=dropped, rounds=rounds, timings_s=T)
    json.dump(stats, open(spot_dir / 'stats.json', 'w'), indent=1)

    old = json.load(open(spot_dir / 'spot.json')) if (spot_dir / 'spot.json').exists() else {}
    spot = dict(id=spot_id, name=old.get('name', spot_id), lat=round(lat, 7), lon=round(lon, 7),
                radius_m=int(np.ceil(radius)), cameras=rec.num_reg_images(),
                model_version=time.strftime('%Y%m%d-%H%M'), credit_page=(spot_dir / 'CREDITS.tsv').exists())
    json.dump(spot, open(spot_dir / 'spot.json', 'w'), indent=1)
    log('spot', spot)
    log('stats', {k: v for k, v in stats.items() if k not in ('georef', 'rounds')})


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
