#!/usr/bin/env python3
"""Export a gsplat checkpoint as .ply (full), .compressed.ply (PlayCanvas/SuperSplat/Spark) and .splat (antimatter15).
  python export.py <ckpt.pt> <out-prefix> [min_opacity=0] [sh_degree=3] [formats=ply,ply_compressed,splat]
A lite web copy: min_opacity 0.1 and sh_degree 0 (no view-dependent colour) is about a sixth of the full size."""
import sys
import torch
from gsplat import export_splats

ck, prefix = sys.argv[1], sys.argv[2]
min_op = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
deg = int(sys.argv[4]) if len(sys.argv) > 4 else 3
fmts = sys.argv[5].split(',') if len(sys.argv) > 5 else ['ply', 'ply_compressed', 'splat']
s = torch.load(ck, map_location='cpu', weights_only=False)['splats']
k = torch.sigmoid(s['opacities']) >= min_op
args = dict(means=s['means'][k], scales=s['scales'][k], quats=s['quats'][k], opacities=s['opacities'][k],
            sh0=s['sh0'][k], shN=s['shN'][k][:, :(deg + 1) ** 2 - 1])
ext = {'ply': '.ply', 'ply_compressed': '.compressed.ply', 'splat': '.splat'}
for fmt in fmts:
    export_splats(**args, format=fmt, save_to=prefix + ext[fmt])
    print('wrote', prefix + ext[fmt])
print('gaussians', int(k.sum()), 'of', k.numel(), 'sh degree', deg)
