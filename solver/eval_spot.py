"""Run every spots/<id>/test photo through the /solve code path: `.venv/bin/python eval_spot.py <spot_id>`.

EXIF GPS, heading and focal come from each photo, overridden by spots/<id>/test_meta.json when present.
Writes spots/<id>/eval.md and eval.json.
"""
import json
import sys
import time

import numpy as np

from build_spot import load_meta, true_heading
from matching import IMAGE_EXTS, Models, exif_f35
from server import SPOTS_DIR, Spot, solve


def main(spot_id):
    spot_dir = SPOTS_DIR / spot_id
    files = sorted(p for p in (spot_dir / 'test').iterdir() if p.suffix.lower() in IMAGE_EXTS)
    t = time.time()
    spot, models = Spot(spot_dir), Models()
    load_s = time.time() - t
    metas = load_meta(files, spot_dir / 'test_meta.json')
    rows = []
    for i, f in enumerate(files, 1):
        m = metas[f.stem + '.jpg']
        r = None
        for item in solve(spot, models, f, None, exif_f35(m)):
            r = item.get('result', r)
        row = dict(id=f'T{i}', file=f.name, **{k: r[k] for k in ('inliers', 'confidence', 'reason', 'f35', 'secs',
                                                                    'lat', 'lon', 'heading', 'alt')})
        row['exif_f35'] = exif_f35(m)
        row['dist_m'] = (float(np.linalg.norm(spot.enu.en(r['lat'], r['lon']) - spot.enu.en(m['lat'], m['lon'])))
                         if m['lat'] is not None and r['inliers'] else None)
        h = true_heading(m)
        row['dheading'] = float((r['heading'] - h + 180) % 360 - 180) if h is not None and r['inliers'] else None
        rows.append(row)
        print(row, flush=True)

    def fmt(v, d=0):
        return 'n/a' if v is None else f'{v:.{d}f}'

    lines = [f'# {spot_id} held-out eval', '',
             f'{len(files)} photos, run {time.strftime("%Y-%m-%d %H:%M")}, models and spot loaded in {load_s:.0f} s. '
             'Distance is to the photo\'s EXIF GPS (phone GPS is off by metres); heading diff is solved minus EXIF true '
             'heading; f35 EXIF includes digital zoom.', '',
             '| # | file | inliers | m to EXIF GPS | heading diff | f35 est/EXIF | confidence | secs |',
             '|---|---|---|---|---|---|---|---|']
    for r in rows:
        lines.append(f"| {r['id']} | {r['file']} | {r['inliers']} | {fmt(r['dist_m'])} | {fmt(r['dheading'])} | "
                     f"{fmt(r['f35'])}/{fmt(r['exif_f35'])} | {r['confidence']} | {r['secs']:.1f} |")
    placed = [r for r in rows if r['confidence'] != 'none']
    near = [r for r in placed if r['dist_m'] is not None and r['dist_m'] <= 25]
    d = [r['dist_m'] for r in placed if r['dist_m'] is not None]
    fe = [abs(r['f35'] / r['exif_f35'] - 1) for r in placed if r['exif_f35']]
    lines += ['', f'Placed (solid or check): {len(placed)} of {len(rows)}; within 25 m of EXIF GPS: {len(near)}.',
              f'Median distance of placed photos: {fmt(np.median(d) if d else None)} m; '
              f'median focal error: {fmt(100 * np.median(fe) if fe else None)}%; '
              f'median solve: {np.median([r["secs"] for r in rows]):.1f} s.', '']
    (spot_dir / 'eval.md').write_text('\n'.join(lines))
    json.dump(rows, open(spot_dir / 'eval.json', 'w'), indent=1)
    print('\n'.join(lines))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
