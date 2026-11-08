# Lens reader results

Test split: whole landmarks the model never saw (london_bigben, nyc_dumbo, toronto_gooderham), 480 photos. Bin accuracy rewards always saying "wide" (58% of the split), so read it with balanced bin accuracy (mean of the five per-bin recalls) and long-lens recall (a 70 mm or longer photo read as 70 mm or longer), the case the solver needs help with.

| Reader | Bin accuracy | Balanced bin acc | Long-lens recall (>= 70 mm) | Median abs % error | Within 25% | NYC DUMBO bin acc | Answered |
|---|---|---|---|---|---|---|---|
| Typical at landmark (train median, else global) | 17.1% | 20.0% | 0.0% | 29.6% | 43.5% | 15.3% (n=268) | 480/480 |
| Typical at landmark (leave-one-out on test, optimistic) | 55.2% | 23.3% | 0.0% | 16.7% | 55.4% | 68.7% (n=268) | 480/480 |
| Always 'wide' | 57.5% | 20.0% | 0.0% | 16.7% | 60.4% | 68.7% (n=268) | 480/480 |
| OpenAI gpt-6.1-sol (zero-shot) | 68.3% | 50.9% | 48.3% | 13.8% | 67.7% | 75.7% (n=268) | 480/480 |
| Base nvidia/nemotron-3.5-super-vl-120b-a12b (zero-shot, hosted) | 54.8% | 32.4% | 17.2% | 22.6% | 54.2% | 66.8% (n=268) | 480/480 |
| Fine-tuned Nemotron Nano 12B v2 VL + LoRA (ours, training prompt) | 55.6% | 36.8% | 72.4% | 16.7% | 62.1% | 65.7% (n=268) | 480/480 |
| Fine-tuned (ours), crew's prompt | 44.0% | 29.6% | 60.9% | 20.7% | 59.2% | 49.3% (n=268) | 479/480 |
| Base Nemotron Nano 12B v2 VL (zero-shot, same vLLM) | 51.9% | 27.1% | 12.6% | 22.6% | 52.9% | 63.4% (n=268) | 480/480 |

## Dataset

| Split | ultrawide | wide | normal | tele | super-tele | total |
|---|---|---|---|---|---|---|
| train | 479 | 1286 | 652 | 910 | 207 | 3534 |
| val | 22 | 197 | 83 | 127 | 57 | 486 |
| test | 35 | 276 | 82 | 76 | 11 | 480 |

## Notes

- The f35 label is EXIF FocalLengthIn35mmFilm times DigitalZoomRatio when the ratio is above 1, except on Apple files, whose tag already includes the zoom. EXIF is a noisy reference.
- NYC DUMBO is over half of the test split, so overall numbers lean on it. The 'Always wide' row is the bar a lens reader must clear; the landmark-prior rows need photos from the landmark itself.
- Super-tele has few test photos, so read per-bin results with care.
- The leave-one-out landmark row reads other test photos of the same landmark, so it is an optimistic ceiling for a landmark prior. A new landmark cannot use it.
- Zero-shot models get the image and a prompt asking for strict JSON. The fine-tuned model gets its training prompt.

## Fine-tune run (Sat Nov 7, Brev A100 80 GB)

- Base `nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL-BF16`, LoRA rank 16 (alpha 32) on the language model's Mamba in_proj, attention q/k/v/o and MLP up/down; 38.5 M trainable parameters (0.31%). 1,200 bin-balanced training photos per epoch, 16 per optimizer step, lr 1e-4 cosine, max 4 tiles. `lens/train.sh` unchanged except running from /ephemeral.
- Validation loss on 150 held-out-landmark photos: 0.2569 after epoch 1, 0.2370 after epoch 2 (kept). Training loss 3.74 at step 5, 0.26 at the end. 44 minutes of training (27 min and 17 min per epoch; the first shared the GPU with the splat), first attempt, no failures.
- Served by vLLM 0.33.0 as base + LoRA (`lens/serve.sh` LoRA mode came up; the merged checkpoint was not needed). Two fixes for the Brev box, now in `serve.sh`: its driver (570) is older than vLLM's CUDA 13 torch needs, so it loads NVIDIA's forward-compatibility libcuda (`cuda-compat-13-0`) on drivers below 580; and flashinfer's sampler JIT (needs ninja and a CUDA 13 nvcc) is off. About 1.2 s per photo through the tunnel.

What it learned: telephoto. It flags 72% of the 70 mm-and-longer test photos as long, against 48% for OpenAI's zero-shot model and 13% for the same base model before tuning; it moves the base model's balanced accuracy from 27% to 37% and its median error from 22.6% to 16.7%. What it did not learn: normal lenses. Only 7 of 82 photos at 35 to 70 mm land in the right bin; 49 come back as wide. It does not beat the "always wide" bar on plain bin accuracy (55.6% vs 57.5%).

The prompt matters: the same adapter scores 44.0% with the crew's prompt and 55.6% with its training prompt (`lens/labels.py` PROMPT, "What is the 35 mm-equivalent focal length of this photo? Answer JSON.").

## Wiring and a note for the nvidia thread (crew/ owner)

- The crew on the Vultr VM reads the lens from this model: `ops/shotmatch-crew.service` has `LENS_URL=http://127.0.0.1:18000/v1` and `LENS_MODEL=shotmatch-lens`. Port 18000 on the VM is `ops/shotmatch-lens-tunnel.service`, an ssh tunnel the VM opens to the GPU box (the VM's firewall refuses ssh from the GPU box). Confirmed in the crew journal: `read_lens(photo 12) -> about 24 mm (fine-tuned lens model) 1168 ms`.
- Two changes for `crew/src/models.ts`, sent to the nvidia thread: (1) when LENS_URL is set, send the training prompt above instead of the crew's own; (2) in `solverRange`, use a fine-tuned read only when it is 70 mm or more, with a wide window such as [0.45x, 2.2x], and keep shorter reads advisory. The hero photo (A9TVAN, solved 52.9 mm) reads as 24 mm, and the current 0.6x to 1.6x window turned a Solid solve into "Check this: the 51 mm lens is outside 14-38 mm" (test session JXGUXJ, photo 12; A9TVAN's stored result is unchanged).
- When the GPU box is deleted, remove the two LENS lines and restart the crew, or every lens read fails instead of falling back to Nemotron VL.
