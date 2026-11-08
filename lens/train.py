#!/usr/bin/env python3
"""LoRA fine-tune of NVIDIA-Nemotron-Nano-12B-v2-VL-BF16 to read the 35 mm-equivalent focal length.

  python3 train.py --dry-run          # CPU: tokenizer + processor only, prints the chat-formatted samples
  python3 train.py                    # GPU: train, keep the best epoch, write the adapter and a merged checkpoint

Plain torch + peft. The model's own forward() calls torch.distributed.get_rank(), so this script embeds the image
tokens itself (model.extract_feature) and calls the language model with labels.
Knobs (env): EPOCHS=2 LR=1e-4 RANK=16 TRAIN_N=1200 MAX_TILES=4 ACCUM=16 VAL_N=150 GRAD_CKPT=auto
"""
import argparse, json, math, os, random, shutil, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from labels import PROMPT, answer_json, BINS

REPO_ID = "nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL-BF16"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "lens"
OUT = Path(os.environ.get("OUT", ROOT / "checkpoints" / "lens"))
E = lambda k, d: type(d)(os.environ.get(k, d))
EPOCHS, LR, RANK = E("EPOCHS", 2), E("LR", 1e-4), E("RANK", 16)
TRAIN_N, MAX_TILES, ACCUM, VAL_N = E("TRAIN_N", 1200), E("MAX_TILES", 4), E("ACCUM", 16), E("VAL_N", 150)
# in_proj (mamba), q/k/v/o (attention), up/down (mlp) of the language model. Mamba out_proj is left out: the fused scan kernel reads its weight directly, so a LoRA there would be skipped, and peft refuses it.
TARGET_RE = r".*\.mixer\.(in_proj|q_proj|k_proj|v_proj|o_proj|up_proj|down_proj)"  # relative to the wrapped language model


def messages():
    # No system message: a plain OpenAI-style request carries none, and the template then defaults to non-thinking.
    return [{"role": "user", "content": [{"type": "image", "image": ""}, {"type": "text", "text": PROMPT}]}]


def load_split(name, n, seed=0):
    rows = {r["file"]: r for r in map(json.loads, (DATA / "meta.jsonl").read_text().splitlines())}
    files = json.loads((DATA / "splits.json").read_text())["files"][name]
    rs = [rows[f] for f in files]
    rnd = random.Random(seed)
    rnd.shuffle(rs)
    if len(rs) <= n:
        return rs
    # cap each bin at n/3 so the many 24-35 mm phone shots do not crowd out tele and ultrawide; refill from the rest
    cap = math.ceil(n / 3)
    pick, rest = [], []
    for b in BINS:
        sub = [r for r in rs if r["bin"] == b]
        pick += sub[:cap]
        rest += sub[cap:]
    rnd.shuffle(rest)
    pick += rest[: n - len(pick)]
    rnd.shuffle(pick)
    return pick[:n]


class Sample:
    """One chat-formatted example: prompt ids + image tiles, and labels that are -100 over the prompt."""

    def __init__(self, tok, proc, row):
        from PIL import Image
        img = Image.open(DATA / "images" / row["file"]).convert("RGB")
        prompt = tok.apply_chat_template(messages(), tokenize=False, add_generation_prompt=True)
        enc = proc(text=[prompt], images=[img], return_tensors="pt", add_special_tokens=False)  # expands <image> to <img><image>*256 per tile</img>
        ans = tok(answer_json(row["f35"]), add_special_tokens=False)["input_ids"] + [tok.eos_token_id]
        p = enc["input_ids"][0].tolist()
        self.ids = p + ans
        self.labels = [-100] * len(p) + ans
        self.pixel_values = enc["pixel_values"]
        self.prompt_text, self.row = prompt, row


def get_tok_proc():
    from huggingface_hub import snapshot_download
    from transformers import AutoProcessor, AutoTokenizer
    path = snapshot_download(REPO_ID, allow_patterns=["*.json", "*.jinja", "*.py"])
    tok = AutoTokenizer.from_pretrained(path)
    proc = AutoProcessor.from_pretrained(path, trust_remote_code=True)
    proc.image_processor.max_num_tiles = MAX_TILES
    return path, tok, proc


def dry_run():
    path, tok, proc = get_tok_proc()
    for r in load_split("train", 6):
        s = Sample(tok, proc, r)
        img_tok = proc.image_token_id
        n_img = sum(i == img_tok for i in s.ids)
        print(f"--- {r['file']} f35={r['f35']} bin={r['bin']} tiles={s.pixel_values.shape[0]} "
              f"pixel_values={tuple(s.pixel_values.shape)} seq={len(s.ids)} image_tokens={n_img}")
        print("template output:", repr(s.prompt_text))
        ans = [i for i, l in zip(s.ids, s.labels) if l != -100]
        print("supervised text:", repr(tok.decode(ans, skip_special_tokens=False)))
        assert n_img == s.pixel_values.shape[0] * 256, "image token count must be 256 per tile"
        assert s.ids[-1] == tok.eos_token_id
    print("dry run ok; max_num_tiles =", MAX_TILES)


def train():
    import torch
    from peft import LoraConfig, get_peft_model
    from transformers import AutoModelForCausalLM
    path, tok, proc = get_tok_proc()
    dev = "cuda"
    t0 = time.time()
    model = AutoModelForCausalLM.from_pretrained(REPO_ID, trust_remote_code=True, torch_dtype=torch.bfloat16, device_map=dev).eval()
    print(f"model loaded in {time.time() - t0:.0f}s, {torch.cuda.memory_allocated() / 2**30:.1f} GiB", flush=True)
    for p in model.parameters():
        p.requires_grad_(False)
    lm = model.language_model
    vram = torch.cuda.get_device_properties(0).total_memory / 2**30
    use_ckpt = {"1": True, "0": False}.get(os.environ.get("GRAD_CKPT", "auto"), vram < 60)
    if use_ckpt:
        lm.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    peft_lm = get_peft_model(lm, LoraConfig(r=RANK, lora_alpha=2 * RANK, lora_dropout=0.05, target_modules=TARGET_RE))
    peft_lm.print_trainable_parameters()
    params = [p for p in peft_lm.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=LR, weight_decay=0.0, betas=(0.9, 0.99))

    tr_rows, va_rows = load_split("train", TRAIN_N, 1), load_split("val", VAL_N, 2)
    print(f"train {len(tr_rows)} val {len(va_rows)} grad_ckpt={use_ckpt} max_tiles={MAX_TILES}", flush=True)
    steps_total = EPOCHS * math.ceil(len(tr_rows) / ACCUM)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / max(1, 0.05 * steps_total)) *
                                              0.5 * (1 + math.cos(math.pi * min(1, s / steps_total))))

    def loss_of(s):
        ids = torch.tensor([s.ids], device=dev)
        with torch.no_grad():
            vit = model.extract_feature(s.pixel_values.to(dev, torch.bfloat16))
            emb = lm.get_input_embeddings()(ids)
            emb[0, ids[0] == model.img_context_token_id] = vit.reshape(-1, emb.shape[-1]).to(emb.dtype)
        emb.requires_grad_(True)
        out = peft_lm(inputs_embeds=emb, attention_mask=torch.ones_like(ids), labels=torch.tensor([s.labels], device=dev), use_cache=False)
        return out.loss

    OUT.mkdir(parents=True, exist_ok=True)
    log = (OUT / "train_log.jsonl").open("a")
    best, bad, step = float("inf"), 0, 0
    for ep in range(EPOCHS):
        peft_lm.train()
        random.Random(ep).shuffle(tr_rows)
        run, n_run, t_ep = 0.0, 0, time.time()
        for i, r in enumerate(tr_rows):
            loss = loss_of(Sample(tok, proc, r))
            (loss / ACCUM).backward()
            run, n_run = run + loss.item(), n_run + 1
            if (i + 1) % ACCUM == 0 or i + 1 == len(tr_rows):
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                opt.step(); sched.step(); opt.zero_grad(set_to_none=True); step += 1
                if step % 5 == 0:
                    rec = dict(epoch=ep, step=step, loss=round(run / n_run, 4), secs=round(time.time() - t_ep), lr=sched.get_last_lr()[0])
                    print(json.dumps(rec), flush=True); log.write(json.dumps(rec) + "\n"); log.flush()
                    run, n_run = 0.0, 0
        peft_lm.eval()
        with torch.no_grad():
            vl = sum(loss_of(Sample(tok, proc, r)).item() for r in va_rows) / len(va_rows)
        rec = dict(epoch=ep, val_loss=round(vl, 4), epoch_secs=round(time.time() - t_ep))
        print(json.dumps(rec), flush=True); log.write(json.dumps(rec) + "\n"); log.flush()
        if vl < best:
            best, bad = vl, 0
            peft_lm.save_pretrained(OUT / "adapter")
        else:
            bad += 1
            if bad >= 1:
                print("val loss did not improve, early stop", flush=True)
                break

    # reload the best epoch's weights, fold them into the base and write a checkpoint with the original layout
    from peft import set_peft_model_state_dict
    from safetensors.torch import load_file
    set_peft_model_state_dict(peft_lm, load_file(OUT / "adapter" / "adapter_model.safetensors"))
    merged_lm = peft_lm.merge_and_unload()
    sd = {k: v for k, v in merged_lm.state_dict().items()}
    merge_dir = OUT / "merged"
    write_merged(path, merge_dir, sd, "language_model.")
    save_vllm_adapter(OUT / "adapter", OUT / "adapter_vllm")
    print("done: adapter in", OUT / "adapter", "(vLLM naming in adapter_vllm) merged checkpoint in", merge_dir, flush=True)


def save_vllm_adapter(src, dst):
    """vLLM names modules from the whole VL model, so the adapter needs the 'language_model.' prefix peft did not see."""
    from safetensors.torch import load_file, save_file
    dst.mkdir(parents=True, exist_ok=True)
    w = {k.replace("base_model.model.", "base_model.model.language_model.", 1): v
         for k, v in load_file(src / "adapter_model.safetensors").items()}
    save_file(w, dst / "adapter_model.safetensors", metadata={"format": "pt"})
    cfg = json.loads((src / "adapter_config.json").read_text())
    cfg["target_modules"] = r".*language_model.*" + TARGET_RE[2:]
    cfg["base_model_name_or_path"] = REPO_ID
    (dst / "adapter_config.json").write_text(json.dumps(cfg, indent=2))


def write_merged(config_path, merge_dir, lm_sd, prefix):
    """Copy the original repo layout and overwrite only the tensors LoRA changed (same names, same shards)."""
    from huggingface_hub import snapshot_download
    from safetensors import safe_open
    from safetensors.torch import save_file
    src = Path(snapshot_download(REPO_ID, allow_patterns=["*.json", "*.jinja", "*.py", "*.safetensors"]))
    merge_dir.mkdir(parents=True, exist_ok=True)
    for f in src.iterdir():
        if f.suffix != ".safetensors" and f.is_file():
            shutil.copy(f.resolve(), merge_dir / f.name)
    pre = json.loads((merge_dir / "preprocessor_config.json").read_text())
    pre["max_num_tiles"] = MAX_TILES  # serving must tile images the way training did
    (merge_dir / "preprocessor_config.json").write_text(json.dumps(pre, indent=2))
    for shard in sorted(src.glob("*.safetensors")):
        tensors = {}
        with safe_open(shard, "pt") as f:
            for k in f.keys():
                t = f.get_tensor(k)
                if k.startswith(prefix) and k[len(prefix):] in lm_sd:
                    t = lm_sd[k[len(prefix):]].detach().to("cpu", t.dtype)
                tensors[k] = t.contiguous()
        save_file(tensors, merge_dir / shard.name, metadata={"format": "pt"})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry_run() if a.dry_run else train()
