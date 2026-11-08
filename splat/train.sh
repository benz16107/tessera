#!/usr/bin/env bash
# Train a 3D Gaussian splat of a spot on an NVIDIA GPU with gsplat 1.5.3 (CUDA), then export it.
#   bash splat/train.sh nyc_dumbo        (after splat/prepare.py; data/splats/<spot>/input on this box)
# Setup the run used (Brev A100, Ubuntu 22.04, Python 3.10): venv with torch 2.4.1 cu124, the prebuilt wheel
# gsplat-1.5.3+pt24cu124, gsplat's examples/ at tag v1.5.3 and their requirements, and fused-ssim built with
# CUDA_HOME=/usr/local/cuda-12.8 TORCH_CUDA_ARCH_LIST=8.0 (uv pip install --no-build-isolation git+...fused-ssim).
# Knobs: STEPS=30000 GSPLAT=/ephemeral/gsplat PY=/ephemeral/venv-splat/bin/python
set -euo pipefail
spot=$1
here=$(cd "$(dirname "$0")" && pwd); root=$(dirname "$here")
GSPLAT=${GSPLAT:-/ephemeral/gsplat}; PY=${PY:-/ephemeral/venv-splat/bin/python}; STEPS=${STEPS:-30000}; EARLY=${EARLY:-7000}  # EARLY: an early checkpoint, eval and export
data=$root/data/splats/$spot; res=$data/run
cd "$GSPLAT/examples"
# --no-normalize-world-space keeps the georegistered ENU frame; every 8th view is held out for PSNR.
# Default densification: an MCMC run (cap 1M) diverged to NaN at step 2,887 in this unnormalized frame.
# No --use-bilateral-grid: on the first DUMBO run the per-photo grids (16x16 colour transforms) learned each photo
# by themselves and the 3D scene collapsed into one flat colour; appearance embeddings (--app-opt) are out for the
# same reason plus their colours do not export. Mixed light shows up as some colour averaging instead.
"$PY" simple_trainer.py default --data-dir "$data/input" --data-factor 1 --result-dir "$res" \
  --no-normalize-world-space --test-every 8 --max-steps "$STEPS" --eval-steps $EARLY "$STEPS" --save-steps $EARLY "$STEPS" \
  --save-ply --ply-steps $EARLY "$STEPS" --disable-viewer
"$PY" "$here/export.py" "$res/ckpts/ckpt_$((STEPS - 1))_rank0.pt" "$data/$spot"
# the early export runs from a second shell once ckpt_$((EARLY - 1))_rank0.pt exists:
#   python splat/export.py $res/ckpts/ckpt_6999_rank0.pt $data/${spot}_7k
