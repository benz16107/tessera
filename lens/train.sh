#!/usr/bin/env bash
# Train the lens reader on a rented NVIDIA GPU (Ubuntu 24.04, CUDA driver >= 12.6, A40 48 GB or A100 80 GB).
# Run from anywhere; expects data/lens/{images,meta.jsonl,splits.json} under the repo root (rsync them up first).
# Knobs: EPOCHS=2 TRAIN_N=1200 MAX_TILES=4 LR=1e-4 RANK=16 GRAD_CKPT=auto|0|1
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
VENV=${VENV:-$HOME/venv-lens-train}
OUT=${OUT:-$PWD/checkpoints/lens}
export OUT

nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
test -s data/lens/splits.json || { echo "missing data/lens/splits.json: rsync data/lens up first"; exit 1; }

command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
if [ ! -x "$VENV/bin/python" ]; then
  uv venv --python 3.12 "$VENV"
  PIP="uv pip install --python $VENV/bin/python"
  # Pins: transformers 4.53.x is what the model card requires; mamba-ssm 2.2.5 and causal-conv1d have prebuilt wheels for
  # torch 2.7 + cu12 + py3.12 (no 30 minute compile). peft 0.21.2 is the version the LoRA wiring was smoke-tested with.
  $PIP torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu126
  $PIP "transformers==4.53.3" peft==0.21.2 accelerate timm open_clip_torch einops pillow numpy safetensors huggingface_hub sentencepiece packaging
  $PIP "https://github.com/state-spaces/mamba/releases/download/v2.2.5/mamba_ssm-2.2.5%2Bcu12torch2.7cxx11abiTRUE-cp312-cp312-linux_x86_64.whl" \
       "https://github.com/Dao-AILab/causal-conv1d/releases/download/v1.6.1.post4/causal_conv1d-1.6.1%2Bcu12torch2.7cxx11abiTRUE-cp312-cp312-linux_x86_64.whl"
fi
"$VENV/bin/python" -c "import torch, mamba_ssm, causal_conv1d; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"

mkdir -p "$OUT"
"$VENV/bin/python" lens/train.py --dry-run | tail -3
"$VENV/bin/python" -u lens/train.py 2>&1 | tee -a "$OUT/train.out"
