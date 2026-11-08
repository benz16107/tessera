#!/usr/bin/env bash
# Difix3D pass on a trained street splat, from its 30k checkpoint (after splat/train.sh and splat/crop.py).
#   bash splat/difix.sh nyc_dumbo
# Setup on the Brev box: git clone nv-tlabs/Difix3D to /ephemeral/Difix3D; cp -a /ephemeral/venv-splat /ephemeral/venv-difix;
# uv pip install diffusers==0.25.1 transformers==4.38.0 huggingface-hub==0.25.1 peft==0.9.0 lpips einops "numpy<2".
# Difix's parser wants <data>/colmap/sparse/0, so difix_data/ links to input/.
# Writes data/splats/<spot>/difix_run/ckpts/ckpt_<STEPS-1>_rank0.pt; fixes every 2,000 steps from 30k (10 fixes by default).
set -euo pipefail
spot=$1
here=$(cd "$(dirname "$0")" && pwd); root=$(dirname "$here")
D=$root/data/splats/$spot; STEPS=${STEPS:-50000}
mkdir -p "$D/difix_data/colmap/sparse"
ln -sfn "$D/input/images" "$D/difix_data/images"; ln -sfn "$D/input/sparse" "$D/difix_data/colmap/sparse/0"
fixes=$(seq 30000 2000 $((STEPS - 2000)))
cd /ephemeral/Difix3D/examples/gsplat
DIFIX_TARGETS=$D/difix_targets.json HF_HOME=${HF_HOME:-/ephemeral/hf} /ephemeral/venv-difix/bin/python "$here/difix_train.py" \
  --data-dir "$D/difix_data" --data-factor 1 --result-dir "$D/difix_run" --no-normalize-world-space --test-every 8 \
  --ckpt "$D/run/ckpts/crop_29999.pt" --max-steps "$STEPS" --fix-steps $fixes --eval-steps "$STEPS" --save-steps "$STEPS" \
  --disable-viewer
