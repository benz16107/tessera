#!/usr/bin/env python3
"""Difix3D progressive update of a trained splat, steered to Studio's viewpoints. Runs NVIDIA's gsplat example
(nv-tlabs/Difix3D examples/gsplat/simple_trainer_difix3d.py, NVIDIA License: non-commercial research or evaluation
use only; its model nvidia/difix_ref builds on Stability AI's SD-Turbo) with four changes made here, not in their file:

  1. the novel views creep toward our target poses (DIFIX_TARGETS, c2w matrices from splat/difix_views.py) instead of
     the held-out photos, STEP metres per fix (their 0.5 is in a normalized scene; ours is in metres);
  2. the train/val split follows gsplat's convention (every 8th photo held out), not their sparse-view one;
  3. the reference photo is centre-cropped and resized to the render's size (Commons photos differ in size);
  4. GPU memory the fixer used is released after each fix, since vLLM shares the GPU.

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


class FitRef:
    """Difix wants the reference the same size as the render."""

    def __init__(self, pipe):
        self.pipe = pipe

    def __call__(self, *a, image, ref_image=None, **k):
        if ref_image is not None and ref_image.size != image.size:
            ref_image = ImageOps.fit(ref_image, image.size, Image.LANCZOS)
        return self.pipe(*a, image=image, ref_image=ref_image, **k)


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
