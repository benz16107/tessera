#!/usr/bin/env python3
"""PSNR of a splat on its held-out views (gsplat's test split: every 8th image), raw and colour-corrected.

  cd <gsplat>/examples && python <repo>/splat/eval_views.py <data/splats/spot/input> <ckpt.pt> [out_dir]

Colour-corrected: one affine RGB transform per held-out photo, fitted by least squares between render and photo,
then PSNR. Commons photos differ in exposure, white balance and processing, which the splat cannot know for a
photo it never saw, so the raw number mostly measures that; the corrected one measures geometry and texture.
"""
import json, sys
import imageio.v2 as imageio
import numpy as np
import torch
from datasets.colmap import Parser  # gsplat examples/
from gsplat.rendering import rasterization


def psnr(a, b):
    return float(10 * np.log10(1.0 / np.mean((a - b) ** 2)))


def main(data_dir, ckpt, out_dir=None):
    p = Parser(data_dir, factor=1, normalize=False, test_every=8)
    s = torch.load(ckpt, map_location='cuda', weights_only=False)['splats']
    colors = torch.cat([s['sh0'], s['shN']], 1)
    deg = int(round(colors.shape[1] ** 0.5)) - 1
    rows = []
    for i in range(0, len(p.image_names), 8):
        cid = p.camera_ids[i]
        w, h = p.imsize_dict[cid]
        K = torch.tensor(p.Ks_dict[cid], dtype=torch.float32, device='cuda')[None]
        V = torch.tensor(np.linalg.inv(p.camtoworlds[i]), dtype=torch.float32, device='cuda')[None]
        img, _, _ = rasterization(s['means'], torch.nn.functional.normalize(s['quats'], dim=-1), torch.exp(s['scales']),
                                  torch.sigmoid(s['opacities']), colors, V, K, w, h, sh_degree=deg)
        r = img[0].clamp(0, 1).cpu().numpy().astype(np.float64)
        g = imageio.imread(p.image_paths[i])[..., :3].astype(np.float64) / 255
        X = np.c_[r.reshape(-1, 3), np.ones(r.shape[0] * r.shape[1])]
        A = np.linalg.lstsq(X, g.reshape(-1, 3), rcond=None)[0]
        cc = np.clip(X @ A, 0, 1).reshape(r.shape)
        rows.append(dict(image=p.image_names[i], psnr=round(psnr(r, g), 2), cc_psnr=round(psnr(cc, g), 2)))
        if out_dir:
            imageio.imwrite(f'{out_dir}/heldout_{p.image_names[i]}.jpg',
                            (np.concatenate([g, cc], 1) * 255).astype(np.uint8), quality=85)
    res = dict(n=len(rows), psnr=round(float(np.mean([r['psnr'] for r in rows])), 2),
               cc_psnr=round(float(np.mean([r['cc_psnr'] for r in rows])), 2), views=rows)
    print(json.dumps(res, indent=1))
    return res


if __name__ == '__main__':
    main(*sys.argv[1:4])
