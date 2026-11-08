#!/usr/bin/env python3
"""Difix3D progressive update of a trained splat, steered to Studio's viewpoints. Runs NVIDIA's gsplat example
(nv-tlabs/Difix3D examples/gsplat/simple_trainer_difix3d.py, NVIDIA License: non-commercial research or evaluation
use only; its model nvidia/difix_ref builds on Stability AI's SD-Turbo) with four changes made here, not in their file:

  1. the novel views creep toward our target poses (DIFIX_TARGETS, c2w matrices from splat/difix_views.py) instead of
     the held-out photos, STEP metres per fix (their 0.5 is in a normalized scene; ours is in metres);
  2. the train/val split follows gsplat's convention (every 8th photo held out), not their sparse-view one;
  3. the reference photo is centre-cropped and resized to the render's size (Commons photos differ in size);
  4. GPU memory the fixer used is released after each fix, since vLLM shares the GPU;
  5. each fixed image keeps its render's per-channel mean and spread (DIFIX_MATCH=0 turns it off; see match_stats).

  DIFIX_TARGETS=.../difix_targets.json [DIFIX_STEP=1.5] python splat/difix_train.py --data-dir ... --ckpt ...
Takes the same flags as their script (tyro); see splat/difix.sh for the run.
"""
import json, os, sys

DIFIX = os.environ.get('DIFIX_REPO', '/ephemeral/Difix3D')
sys.path[:0] = [DIFIX, f'{DIFIX}/examples/gsplat']
import numpy as np  # noqa: E402
import torch  # noqa: E402
import tyro  # noqa: E402
from PIL import ImageOps, Image  # noqa: E402
import simple_trainer_difix3d as T  # noqa: E402
from datasets import colmap  # noqa: E402

TARGETS = np.array(json.load(open(os.environ['DIFIX_TARGETS'])), dtype=np.float64)
STEP = float(os.environ.get('DIFIX_STEP', '1.5'))
assert TARGETS.ndim == 3 and TARGETS.shape[1:] == (4, 4), TARGETS.shape

_shift = T.CameraPoseInterpolator.shift_poses
T.CameraPoseInterpolator.shift_poses = lambda self, current, _held_out, distance=0.1, threshold=0.1: \
    _shift(self, current, TARGETS, distance=STEP)

_ds_init = colmap.Dataset.__init__


def ds_init(self, parser, split='train', *a, **k):
    _ds_init(self, parser, split, *a, **k)
    n = parser.test_every
    if n > 1:
        idx = np.arange(len(parser.image_names))
        self.indices = idx[idx % n != 0] if split == 'train' else idx[idx % n == 0]


colmap.Dataset.__init__ = ds_init


def match_stats(out, like):
    """Per-channel mean and spread of `out` set to those of `like`: Difix keeps adding detail, but the scene's
    brightness and colour balance stay where the splat had them. Without it the first run drifted toward a dusk
    reference photo, round after round (one view's brightness went 131 -> 50 over 10 fixes)."""
    o, l = np.asarray(out, np.float32), np.asarray(like, np.float32)
    o = (o - o.mean((0, 1))) / (o.std((0, 1)) + 1e-3) * l.std((0, 1)) + l.mean((0, 1))
    return Image.fromarray(np.clip(o, 0, 255).astype(np.uint8))


class FitRef:
    """Difix wants the reference the same size as the render; its output is held to the render's colour stats."""

    def __init__(self, pipe):
        self.pipe = pipe

    def __call__(self, *a, image, ref_image=None, **k):
        if ref_image is not None and ref_image.size != image.size:
            ref_image = ImageOps.fit(ref_image, image.size, Image.LANCZOS)
        res = self.pipe(*a, image=image, ref_image=ref_image, **k)
        if os.environ.get('DIFIX_MATCH', '1') == '1':
            res.images[0] = match_stats(res.images[0], image)
        return res


_runner_init, _fix = T.Runner.__init__, T.Runner.fix


def runner_init(self, *a, **k):
    _runner_init(self, *a, **k)
    self.difix = FitRef(self.difix)


def fix(self, step):
    _fix(self, step)
    torch.cuda.empty_cache()


T.Runner.__init__, T.Runner.fix = runner_init, fix

if __name__ == '__main__':
    cfg = tyro.cli(T.Config, default=T.Config(strategy=T.DefaultStrategy(verbose=True)))
    cfg.adjust_steps(cfg.steps_scaler)
    T.cli(T.main, cfg, verbose=True)
