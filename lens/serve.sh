#!/usr/bin/env bash
# Serve the fine-tuned lens reader with vLLM: OpenAI-compatible API on :8000, model name "shotmatch-lens".
#   MODE=auto   (default) try base + LoRA adapter; if vLLM rejects it or is not up in 8 minutes, serve the merged checkpoint
#   MODE=lora   base model + adapter only      MODE=merged   merged checkpoint only
# Run after train.sh. Leaves vLLM running in the foreground (use tmux or setsid nohup).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
VENV=${VENV:-$HOME/venv-lens-serve}
OUT=${OUT:-$PWD/checkpoints/lens}
MODE=${MODE:-auto}
MAX_TILES=${MAX_TILES:-4}   # must equal the value used in training
PORT=${PORT:-8000}
GPU_UTIL=${GPU_UTIL:-0.9}   # lower it (e.g. 0.55) when something else, like the splat trainer, shares the GPU
BASE=nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL-BF16

if [ ! -x "$VENV/bin/python" ]; then
  # Separate venv: vLLM needs a newer torch/transformers than the training pins.
  uv venv --python 3.12 "$VENV"
  uv pip install --python "$VENV/bin/python" vllm==0.33.0
fi
VLLM="$VENV/bin/vllm"
# vLLM 0.33 ships torch built for CUDA 13, which needs driver 580+. On an older driver (Brev's A100 had 570), use
# NVIDIA's forward-compatibility libcuda (apt install cuda-compat-13-0; data-center GPUs only).
drv=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1 | cut -d. -f1)
if [ "${drv:-999}" -lt 580 ] && [ -d /usr/local/cuda-13.0/compat ]; then
  export LD_LIBRARY_PATH=/usr/local/cuda-13.0/compat${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
fi
# flashinfer JIT-compiles its sampler on first use (needs ninja and a CUDA 13 nvcc); vLLM's PyTorch sampler needs neither.
export PATH="$VENV/bin:$PATH" VLLM_USE_FLASHINFER_SAMPLER=${VLLM_USE_FLASHINFER_SAMPLER:-0}
COMMON=(--trust-remote-code --dtype bfloat16 --video-pruning-rate 0 --port "$PORT" --host 127.0.0.1 --gpu-memory-utilization "$GPU_UTIL"
        --max-model-len 8192 --limit-mm-per-prompt '{"image":1,"video":0}'
        --mm-processor-kwargs "{\"max_num_tiles\": $MAX_TILES}")

serve_lora()   { exec "$VLLM" serve "$BASE" "${COMMON[@]}" --enable-lora --max-lora-rank 16 --max-loras 1 \
                   --lora-modules "shotmatch-lens=$OUT/adapter_vllm" --served-model-name "$BASE"; }
serve_merged() { exec "$VLLM" serve "$OUT/merged" "${COMMON[@]}" --served-model-name shotmatch-lens; }

case "$MODE" in
  lora) serve_lora ;;
  merged) serve_merged ;;
  auto)
    ( serve_lora ) > "$OUT/vllm_lora.log" 2>&1 &
    pid=$!
    for _ in $(seq 1 96); do   # 8 minutes at 5 s
      sleep 5
      kill -0 "$pid" 2>/dev/null || break
      if curl -sf "http://localhost:$PORT/v1/models" | grep -q shotmatch-lens; then
        echo "serving base + LoRA as shotmatch-lens on :$PORT"; wait "$pid"; exit $?
      fi
    done
    echo "LoRA mode did not come up (see $OUT/vllm_lora.log); serving the merged checkpoint instead"
    kill "$pid" 2>/dev/null || true; sleep 5
    serve_merged ;;
esac
