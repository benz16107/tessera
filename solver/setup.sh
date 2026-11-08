#!/usr/bin/env bash
# Creates solver/.venv with CPU torch, pycolmap, hloc and the SuperPoint code hloc expects.
set -euo pipefail
cd "$(dirname "$0")"
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python --index-url https://download.pytorch.org/whl/cpu torch==2.15.0 torchvision==0.29.2
uv pip install --python .venv/bin/python -r requirements.txt
# hloc imports SuperPoint from site-packages/third_party/SuperGluePretrainedNetwork, which pip does not install
SP=$(.venv/bin/python -c 'import site; print(site.getsitepackages()[0])')
if [ ! -d "$SP/third_party/SuperGluePretrainedNetwork" ]; then
  mkdir -p "$SP/third_party"
  git clone -q https://github.com/magicleap/SuperGluePretrainedNetwork "$SP/third_party/SuperGluePretrainedNetwork"
  git -C "$SP/third_party/SuperGluePretrainedNetwork" checkout -q ddcf11f42e7e0732a0c4607648f9448ea8d73590
fi
.venv/bin/python -c 'from hloc.extractors import superpoint; import pycolmap, lightglue; print("solver venv ok, pycolmap", pycolmap.__version__)'
