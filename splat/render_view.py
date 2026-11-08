#!/usr/bin/env python3
"""Render a trained splat from a Tessera pose (solve_result style: lat, lon, alt, heading, pitch, roll, f35).

Two steps, because the pose maths lives in the solver venv and the renderer on the GPU box:
  solver/.venv/bin/python splat/render_view.py pose <spot> <lat> <lon> <alt> <heading> <pitch> <roll> <f35> <w> <h> > cam.json
  /ephemeral/venv-splat/bin/python splat/render_view.py render <ckpt.pt> cam.json out.png
The splat is in the model's georef ENU frame, so the pose goes through the same Enu origin as the solver.
"""
import json, sys
from pathlib import Path


def pose(spot, lat, lon, alt, heading, pitch, roll, f35, w, h):
    import numpy as np
    root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(root / 'solver'))
    from geometry import Enu, R_from_hpr, fpx_from_f35
    geo = json.load(open(root / 'spots' / spot / 'model' / 'georef.json'))
    C = np.r_[Enu(*geo['origin']).en(lat, lon), alt]
    R = R_from_hpr(heading, pitch, roll)  # cam_from_world, OpenCV axes (x right, y down, z forward)
    V = np.eye(4); V[:3, :3] = R; V[:3, 3] = -R @ C
    f = fpx_from_f35(f35, w, h)
    return dict(viewmat=V.tolist(), K=[[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]], width=int(w), height=int(h), center=C.tolist())


def render(ckpt, cam_json, out):
    import imageio.v2 as imageio
    import torch
    from gsplat.rendering import rasterization
    cam = json.load(open(cam_json))
    s = torch.load(ckpt, map_location='cuda', weights_only=False)['splats']
    colors = torch.cat([s['sh0'], s['shN']], 1)
    deg = int(round(colors.shape[1] ** 0.5)) - 1
    img, alpha, _ = rasterization(s['means'], torch.nn.functional.normalize(s['quats'], dim=-1), torch.exp(s['scales']),
                                  torch.sigmoid(s['opacities']), colors,
                                  torch.tensor([cam['viewmat']], dtype=torch.float32, device='cuda'),
                                  torch.tensor([cam['K']], dtype=torch.float32, device='cuda'),
                                  cam['width'], cam['height'], sh_degree=deg, near_plane=0.2, far_plane=5000.0)
    rgb = (img[0].clamp(0, 1) * 255).byte().cpu().numpy()
    imageio.imwrite(out, rgb)
    print('wrote', out, rgb.shape, 'gaussians', s['means'].shape[0], 'mean alpha', round(float(alpha.mean()), 3))


if __name__ == '__main__':
    if sys.argv[1] == 'pose':
        print(json.dumps(pose(sys.argv[2], *map(float, sys.argv[3:10]), int(sys.argv[10]), int(sys.argv[11]))))
    else:
        render(*sys.argv[2:5])
