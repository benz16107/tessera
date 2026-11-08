# Lens reader runbook (fresh Vultr GPU box to a served model)

Everything below was written without a GPU. The data pull, splits, label code, chat format, processor, LoRA wiring (on a tiny stand-in model) and the baselines were run on linuxbox. Model loading, training speed, the merged checkpoint and vLLM serving were not run. Section "If something breaks" lists the likely failures.

Model: `nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL-BF16` (12.6 B parameters, Mamba-2 and attention hybrid with a RADIO vision tower). License: NVIDIA Open Model License, which allows commercial use and derivative models. The repo is not gated, so no Hugging Face token is needed. The smaller option, `NVIDIA-Nemotron-3.5-Bolt-E4B-BF16`, takes text only, so it cannot read a photo.

## 1. Rent the box

- Vultr Cloud GPU, Ubuntu 24.04, A100 80 GB ($2.40/h, preferred) or A40 48 GB ($1.71/h). Any NVIDIA driver 12.6 or newer works; Vultr's GPU images ship one. Check with `nvidia-smi`.
- Python 3.12 is the Ubuntu 24.04 default. The pinned wheels below are built for Python 3.12 and torch 2.7.
- Open nothing to the internet. Reach the API through an ssh tunnel.

## 2. Send the data and code up (from linuxbox)

```sh
BOX=root@<ip>
cd ~/Code/hackathons/shotmatch
ssh $BOX 'mkdir -p Code/shotmatch/data'
rsync -az --info=progress2 lens $BOX:Code/shotmatch/ --exclude __pycache__ --exclude .venv
rsync -az --info=progress2 data/lens $BOX:Code/shotmatch/data/ --exclude cache
```

About 1 GB (4,500 images). The box needs `data/lens/images`, `meta.jsonl` and `splits.json`.

## 3. Train (about 30 to 40 minutes on an A100, estimated)

```sh
ssh $BOX
cd Code/shotmatch
setsid nohup bash lens/train.sh > train.log 2>&1 &
tail -f train.log
```

`train.sh` installs uv, builds `~/venv-lens-train` with pinned versions (torch 2.7.1 cu126, transformers 4.53.3, peft 0.21.2, mamba-ssm 2.2.5 and causal-conv1d 1.6.1 prebuilt wheels), prints three dry-run samples, then trains. Output goes to `checkpoints/lens/`:

- `adapter/` the LoRA adapter, `adapter_vllm/` the same weights with vLLM's module names
- `merged/` a full checkpoint with the adapter folded in, same file layout as the base
- `train_log.jsonl` loss every 5 optimizer steps and the validation loss per epoch

What it does: LoRA rank 16 (alpha 32, dropout 0.05) on the Mamba `in_proj`, attention q/k/v/o and MLP up/down of the language model. The vision tower and projector are frozen. Learning rate 1e-4 with 5% warmup and cosine decay, 16 samples per optimizer step, 2 epochs, validation loss on 150 held-out-landmark photos after each epoch, the best epoch is kept, and it stops early if validation loss rises.

Subsampling, to stay inside the hour: 1,200 training photos per epoch, with each focal-length bin capped at a third of that so the many 24 to 35 mm phone photos do not crowd out tele and ultrawide. Images are tiled into at most 4 tiles plus a thumbnail (about 1,280 image tokens) instead of the model's default 12. Set `TRAIN_N`, `MAX_TILES`, `EPOCHS` to change this; serving must use the same `MAX_TILES`.

Speed estimate: 12 B parameters, about 1,300 tokens per sample, LoRA backward costs roughly 4 x parameters x tokens in FLOPs. On an A100 at 30 to 40 percent utilisation that is 0.6 to 1 second per sample, so 2,400 sample passes take 25 to 40 minutes. An A40 is about half the speed with gradient checkpointing on (set automatically under 60 GB), so expect 60 to 80 minutes there. Look at `secs` in the first log lines and decide: if one epoch will take more than 25 minutes, stop and rerun with `TRAIN_N=600`.

## 4. Install vLLM while training runs

A separate venv, because vLLM wants a newer torch and transformers than the model's training code:

```sh
export PATH="$HOME/.local/bin:$PATH"
uv venv --python 3.12 ~/venv-lens-serve && uv pip install --python ~/venv-lens-serve/bin/python vllm==0.33.0
```

If that fails on the CUDA driver, use the Docker image from the Nemotron model cards instead: `vllm/vllm-openai:v0.31.0` with the same flags that `serve.sh` passes.

## 5. Serve

```sh
cd ~/Code/shotmatch
setsid nohup bash lens/serve.sh > serve.log 2>&1 &
curl -s localhost:8000/v1/models        # lists shotmatch-lens when ready
```

`serve.sh` first tries the base model with the LoRA adapter (`--enable-lora`). If vLLM rejects the adapter or it is not up after 8 minutes, it serves `checkpoints/lens/merged` under the name `shotmatch-lens`. Force one with `MODE=lora` or `MODE=merged`. The API is OpenAI-compatible on port 8000. Reach it from linuxbox with `ssh -N -L 8000:localhost:8000 $BOX`, and set `LENS_URL=http://localhost:8000/v1` for the crew service.

## 6. Evaluate (from linuxbox, with the tunnel up)

```sh
cd ~/Code/hackathons/shotmatch
python3 lens/eval.py local --url http://localhost:8000/v1 --model shotmatch-lens
python3 lens/eval.py nvidia        # base Nemotron VL on build.nvidia.com, once ~/.config/shotmatch/nvidia_key exists
```

Both rewrite `lens/RESULTS.md` with the new row. The fine-tuned row must beat "Typical at landmark" to be worth shipping; report it either way.

## 7. Cost

| Step | A100 80 GB | A40 48 GB |
|---|---|---|
| Boot, apt, installs | 10 min | 10 min |
| Download 25 GB of weights | 5 to 8 min | 5 to 8 min |
| Train | 30 to 40 min | 60 to 80 min |
| Merge and write checkpoint | 3 min | 3 min |
| vLLM start and eval | 10 min | 10 min |
| Total | about 1.1 h, $2.70 | about 1.6 h, $2.70 |

Budget $5 on either and destroy the box as soon as the adapter and merged checkpoint are copied down (`rsync -az $BOX:Code/shotmatch/checkpoints/lens/adapter* .`). If the demo needs the model served from the GPU, the box bills $2.40 (A100) or $1.71 (A40) for every hour it runs, so shut it down between demos and keep the 25 GB merged checkpoint for the next start.

## If something breaks

- `mamba-ssm` or `causal-conv1d` wheel not found: the box has a different Python or torch than the pins. Use Python 3.12 and keep torch 2.7.1, or install `nvcc` and build from source (20 to 30 minutes).
- "fast path is not available" in the log: the kernels did not import, so Mamba layers fall back to slow PyTorch. Stop and fix it; training would take hours.
- CUDA out of memory on an A40: `GRAD_CKPT=1 MAX_TILES=2 bash lens/train.sh`.
- vLLM cannot load `merged`: compare the file list in `checkpoints/lens/merged` with the base repo. `preprocessor_config.json` there carries `max_num_tiles`.
- Fine-tuned model answers without JSON: check `train_log.jsonl`; the supervised text is `{"f35": N, "bin": "..."}` followed by the end token, and `eval.py` counts an unparseable answer as wrong.
