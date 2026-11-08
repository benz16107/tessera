#!/usr/bin/env python3
"""Export a gsplat checkpoint as .ply (full), .compressed.ply (PlayCanvas/SuperSplat/Spark) and .splat (antimatter15).
  python export.py <ckpt.pt> <out-prefix>"""
import sys
import torch
from gsplat import export_splats

ck, prefix = sys.argv[1], sys.argv[2]
s = torch.load(ck, map_location='cpu', weights_only=False)['splats']
args = dict(means=s['means'], scales=s['scales'], quats=s['quats'], opacities=s['opacities'], sh0=s['sh0'], shN=s['shN'])
for fmt, ext in (('ply', '.ply'), ('ply_compressed', '.compressed.ply'), ('splat', '.splat')):
    export_splats(**args, format=fmt, save_to=prefix + ext)
    print('wrote', prefix + ext)
print('gaussians', s['means'].shape[0])
