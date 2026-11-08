#!/usr/bin/env python3
"""Evaluate focal-length readers on the held-out test split and write lens/RESULTS.md.

  python3 eval.py landmark openai            # baselines that need no GPU
  python3 eval.py nvidia                     # base Nemotron VL on build.nvidia.com (needs ~/.config/shotmatch/nvidia_key)
  python3 eval.py local --url http://HOST:8000/v1 --model shotmatch-lens   # the fine-tuned model
Responses are cached in data/lens/cache/<method>/, so reruns cost nothing.
"""
import argparse, base64, json, re, statistics, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from labels import BINS, PROMPT, ZERO_SHOT_PROMPT, to_bin

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data" / "lens"
CFG = Path.home() / ".config" / "shotmatch"
RESULTS = DATA / "results.json"
KEEP = "## Fine-tune run"
# what crew/src/models.ts readLens() sends; kept in sync by hand
CREW_PROMPT = 'Estimate the 35 mm-equivalent focal length (diagonal) this photo was taken with. Reply with strict JSON only: {"f35": <number>}'

rows = {r["file"]: r for r in map(json.loads, (DATA / "meta.jsonl").read_text().splitlines())}
splits = json.loads((DATA / "splits.json").read_text())
test = [rows[f] for f in splits["files"]["test"]]
train = [rows[f] for f in splits["files"]["train"]]


def metrics(preds):
    """preds: {file: f35 or None}. Unparseable answers count as wrong in every metric."""
    n = len(test)
    ps = [preds.get(r["file"]) for r in test]
    ok_bin = [p is not None and to_bin(p) == r["bin"] for r, p in zip(test, ps)]
    err = [abs(p - r["f35"]) / r["f35"] if p else float("inf") for r, p in zip(test, ps)]
    dumbo = [i for i, r in enumerate(test) if r["group"] == "nyc_dumbo"]
    # the test split is mostly 24-35 mm phone photos, so plain accuracy rewards always saying "wide";
    # balanced accuracy is the mean of per-bin recalls, and long-lens recall is the case the solver needs help with
    recall = [sum(ok for r, ok in zip(test, ok_bin) if r["bin"] == b) / cnt
              for b in BINS if (cnt := sum(r["bin"] == b for r in test))]
    long_ = [i for i, r in enumerate(test) if r["bin"] in ("tele", "super-tele")]
    long_ok = sum(ps[i] is not None and ps[i] >= 70 for i in long_)
    return dict(n=n, parsed=sum(p is not None for p in ps),
                bal_acc=round(sum(recall) / len(recall), 3), long_recall=round(long_ok / max(1, len(long_)), 3),
                bin_acc=round(sum(ok_bin) / n, 3), median_abs_pct_err=round(statistics.median(err) * 100, 1),
                within25=round(sum(e <= 0.25 for e in err) / n, 3),
                dumbo_n=len(dumbo), dumbo_bin_acc=round(sum(ok_bin[i] for i in dumbo) / max(1, len(dumbo)), 3))


def landmark_baselines():
    glob = statistics.median(r["f35"] for r in train)
    by = {}
    for r in train:
        by.setdefault(r["group"], []).append(r["f35"])
    # test landmarks are held out whole, so in practice this falls back to the global train median
    a = {r["file"]: statistics.median(by[r["group"]]) if r["group"] in by else glob for r in test}
    # median of the OTHER test photos at the same landmark: uses test labels, an optimistic ceiling for a landmark prior
    g2 = {}
    for r in test:
        g2.setdefault(r["group"], []).append(r)
    a2 = {}
    for rs in g2.values():
        for r in rs:
            others = [x["f35"] for x in rs if x is not r]
            a2[r["file"]] = statistics.median(others) if others else glob
    maj = max(BINS, key=lambda b: sum(r["bin"] == b for r in train))
    majf = {"ultrawide": 18, "wide": 28, "normal": 50, "tele": 100, "super-tele": 300}[maj]
    return {
        "Typical at landmark (train median, else global)": a,
        "Typical at landmark (leave-one-out on test, optimistic)": a2,
        f"Always '{maj}'": {r["file"]: float(majf) for r in test},
    }


def parse_f35(text):
    if not text:
        return None
    m = re.search(r'"f35"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)', text) or re.search(r"([0-9]+(?:\.[0-9]+)?)\s*mm", text)
    return float(m[1]) if m else None


def chat(url, key, model, prompt, img_path, extra):
    b64 = base64.b64encode(Path(img_path).read_bytes()).decode()
    body = dict(model=model, messages=[{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b64}},
        {"type": "text", "text": prompt}]}], **extra)
    for attempt in range(5):
        req = urllib.request.Request(url.rstrip("/") + "/chat/completions", json.dumps(body).encode(),
                                     {"Content-Type": "application/json", **({"Authorization": "Bearer " + key} if key else {})})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503):
                time.sleep(5 * (attempt + 1))
            else:
                raise RuntimeError(f"{e.code} {e.read()[:300]}")
    raise RuntimeError("retries exhausted")


def run_model(name, url, key, model, prompt, extra, workers=6):
    cache = DATA / "cache" / re.sub(r"[^\w.-]", "_", name)
    cache.mkdir(parents=True, exist_ok=True)

    def one(r):
        p = cache / (r["file"] + ".json")
        if p.exists():
            return r["file"], json.loads(p.read_text())["text"]
        text = chat(url, key, model, prompt, DATA / "images" / r["file"], extra)
        p.write_text(json.dumps({"text": text}))
        return r["file"], text
    with ThreadPoolExecutor(workers) as ex:
        out = dict(ex.map(one, test))
    return {f: parse_f35(t) for f, t in out.items()}


def save(name, m, note=""):
    res = json.loads(RESULTS.read_text()) if RESULTS.exists() else {}
    res[name] = dict(m, note=note)
    RESULTS.write_text(json.dumps(res, indent=1))
    write_md(res)
    print(name, m)


def write_md(res):
    counts = {s: {b: sum(rows[f]["bin"] == b for f in fs) for b in BINS} for s, fs in splits["files"].items()}
    L = ["# Lens reader results", "",
         "Test split: whole landmarks the model never saw (" + ", ".join(splits["groups"]["test"]) +
         f"), {len(test)} photos. Bin accuracy rewards always saying \"wide\" (58% of the split), so read it with balanced bin accuracy "
         "(mean of the five per-bin recalls) and long-lens recall (a 70 mm or longer photo read as 70 mm or longer), the case the solver needs help with.", "",
         "| Reader | Bin accuracy | Balanced bin acc | Long-lens recall (>= 70 mm) | Median abs % error | Within 25% | NYC DUMBO bin acc | Answered |",
         "|---|---|---|---|---|---|---|---|"]
    pc = lambda x: "n/a" if x is None else f"{x:.1%}"
    for k, v in res.items():
        L.append(f"| {k} | {v['bin_acc']:.1%} | {pc(v.get('bal_acc'))} | {pc(v.get('long_recall'))} | {v['median_abs_pct_err']}% | {v['within25']:.1%} | {v['dumbo_bin_acc']:.1%} (n={v['dumbo_n']}) | {v['parsed']}/{v['n']} |")
    L += ["", "## Dataset", "", "| Split | " + " | ".join(BINS) + " | total |", "|---|" + "---|" * (len(BINS) + 1)]
    for s, c in counts.items():
        L.append(f"| {s} | " + " | ".join(str(c[b]) for b in BINS) + f" | {sum(c.values())} |")
    L += ["", "## Notes", "",
          "- The f35 label is EXIF FocalLengthIn35mmFilm times DigitalZoomRatio when the ratio is above 1, except on Apple files, whose tag already includes the zoom. EXIF is a noisy reference.",
          "- NYC DUMBO is over half of the test split, so overall numbers lean on it. The 'Always wide' row is the bar a lens reader must clear; the landmark-prior rows need photos from the landmark itself.",
          "- Super-tele has few test photos, so read per-bin results with care.",
          "- The leave-one-out landmark row reads other test photos of the same landmark, so it is an optimistic ceiling for a landmark prior. A new landmark cannot use it.",
          "- Zero-shot models get the image and a prompt asking for strict JSON. The fine-tuned model gets its training prompt."]
    L += [f"- {k}: {v['note']}" for k, v in res.items() if v.get("note")]
    # hand-written sections after this marker survive a rerun
    old = (HERE / "RESULTS.md").read_text() if (HERE / "RESULTS.md").exists() else ""
    keep = old[old.index(KEEP):] if KEEP in old else ""
    (HERE / "RESULTS.md").write_text("\n".join(L) + "\n" + ("\n" + keep if keep else ""))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("which", nargs="+", choices=["landmark", "openai", "nvidia", "local"])
    ap.add_argument("--openai-model", default="gpt-6.1-sol")
    ap.add_argument("--nvidia-model", help="exact id from GET /v1/models; auto-picks a Nemotron VL if omitted")
    ap.add_argument("--url", default="http://localhost:8000/v1")
    ap.add_argument("--model", default="shotmatch-lens")
    ap.add_argument("--name", default=None, help="row label for the local model")
    ap.add_argument("--prompt", choices=["train", "zero", "crew"], default="train",
                    help="local model prompt: the training prompt, the zero-shot JSON prompt, or the one crew/src/models.ts sends")
    a = ap.parse_args()
    for w in a.which:
        if w == "landmark":
            for name, p in landmark_baselines().items():
                save(name, metrics(p))
        elif w == "openai":
            key = (CFG / "openai_key").read_text().strip()
            p = run_model("openai-" + a.openai_model, "https://api.openai.com/v1", key, a.openai_model, ZERO_SHOT_PROMPT,
                          dict(max_completion_tokens=2000))
            save(f"OpenAI {a.openai_model} (zero-shot)", metrics(p))
        elif w == "nvidia":
            kf = CFG / "nvidia_key"
            if not kf.exists():
                print("SKIP nvidia: ~/.config/shotmatch/nvidia_key does not exist yet")
                continue
            key = kf.read_text().strip()
            mid = a.nvidia_model
            if not mid:
                req = urllib.request.Request("https://integrate.api.nvidia.com/v1/models", headers={"Authorization": "Bearer " + key})
                ids = [m["id"] for m in json.load(urllib.request.urlopen(req))["data"]]
                cand = [i for i in ids if "nemotron" in i.lower() and re.search(r"vl|vision|nano-12b", i.lower()) and "embed" not in i]
                print("Nemotron VL candidates:", cand)
                if not cand:
                    sys.exit("no Nemotron VL model listed; pass --nvidia-model")
                mid = cand[0]
            p = run_model("nvidia-" + mid, "https://integrate.api.nvidia.com/v1", key, mid, ZERO_SHOT_PROMPT,
                          dict(max_tokens=200, temperature=0, chat_template_kwargs={"enable_thinking": False}))
            save(f"Base {mid} (zero-shot, hosted)", metrics(p))
        else:
            prompt = {"train": PROMPT, "zero": ZERO_SHOT_PROMPT, "crew": CREW_PROMPT}[a.prompt]
            tag = "" if a.prompt == "train" else "-" + a.prompt
            p = run_model("local-" + a.model + tag, a.url, "", a.model, prompt, dict(max_tokens=60, temperature=0))
            save(a.name or f"Fine-tuned {a.model} (LoRA)", metrics(p))
