#!/usr/bin/env python3
"""Remove floaters from a street splat using the street geometry: the air above the street is empty in reality.

  python crop.py <ckpt.pt> <spots/<spot>/geometry.json> <off_e> <off_n> <out.pt>

Training from 48 Commons photos leaves Gaussians a few metres in front of the cameras that explain one photo's
lighting or a passing car; from any new pose they are dark blobs. Dropped:
  - the air volume: between the two facades (1 m inside each), more than 2.5 m above the ground, below the roofline,
    along the facades' length;
  - the driving lane: more than 5.5 m from both facades and 0.5 to 2.5 m above the ground (parked cars sit by the kerb).
off_e/off_n: the georef origin in the spot frame (SPLAT.md), since geometry.json is in the spot frame.
"""
import json, sys
import numpy as np
import torch


def keep_mask(xyz_spot, geo):
    c = np.array(geo['street']['centre']); h = np.radians(geo['street']['heading_deg'])
    d = np.array([np.sin(h), np.cos(h)])
    u = (xyz_spot[:, :2] - c[:2]) @ d
    gn, gd = np.array(geo['ground']['plane']['normal']), geo['ground']['plane']['d']
    above = (xyz_spot @ gn - gd) / gn[2]  # height above the ground plane, measured vertically
    inside = []
    for f in geo['facades']:
        n, dd = np.array(f['plane']['normal']), f['plane']['d']
        inside.append(xyz_spot @ n - dd)  # metres in front of the facade, toward the street
    us = [p[1] for f in geo['facades'] for q in f['quads'] for p in q]  # facade extent along the street (north)
    ys = (xyz_spot[:, 1] > min(us) - 2) & (xyz_spot[:, 1] < max(us) + 5)
    roof = min(f['height_m'] for f in geo['facades'])
    between = (inside[0] > 1.0) & (inside[1] > 1.0)
    air = between & ys & (above > 2.5) & (above < roof)
    lane = (inside[0] > 5.5) & (inside[1] > 5.5) & ys & (above > 0.5) & (above <= 2.5)
    return ~(air | lane), air.sum(), lane.sum()


if __name__ == '__main__':
    ckpt, geo_f, oe, on, out = sys.argv[1:6]
    ck = torch.load(ckpt, map_location='cpu', weights_only=False)
    s = ck['splats']
    geo = json.load(open(geo_f))
    xyz = s['means'].numpy().astype(np.float64) + np.array([float(oe), float(on), 0.0])
    keep, n_air, n_lane = keep_mask(xyz, geo)
    k = torch.from_numpy(keep)
    ck['splats'] = {name: v[k] for name, v in s.items()}
    torch.save(ck, out)
    print(f'kept {int(keep.sum())} of {len(keep)} gaussians (air volume {n_air}, driving lane {n_lane})')
