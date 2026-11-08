#!/usr/bin/env python3
"""Split data/lens/meta.jsonl by landmark group into train/val/test and print class counts."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from labels import BINS, split_groups

DATA = Path(__file__).resolve().parent.parent / "data" / "lens"
rows = [json.loads(l) for l in (DATA / "meta.jsonl").read_text().splitlines()]
from labels import f35_with_zoom, to_bin
for r in rows:  # relabel from the raw EXIF so labeling-rule changes apply to rows pulled earlier
    r["f35"] = round(f35_with_zoom(r["f35_raw"], r["zoom"], r["make"]), 2)
    r["bin"] = to_bin(r["f35"])
(DATA / "meta.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
groups = {}
for r in rows:
    groups[r["group"]] = groups.get(r["group"], 0) + 1
g = split_groups(groups)
which = {x: s for s, xs in g.items() for x in xs}
files = {s: [r["file"] for r in rows if which[r["group"]] == s] for s in g}
(DATA / "splits.json").write_text(json.dumps({"groups": g, "files": files}, indent=1))
print("held-out test landmarks:", g["test"], "| val landmarks:", g["val"])
print(f"{'split':6} {'n':>5} " + " ".join(f"{b:>10}" for b in BINS))
for s in ("train", "val", "test"):
    sub = [r for r in rows if which[r["group"]] == s]
    print(f"{s:6} {len(sub):5d} " + " ".join(f"{sum(r['bin'] == b for r in sub):10d}" for b in BINS))
print(f"{'all':6} {len(rows):5d} " + " ".join(f"{sum(r['bin'] == b for r in rows):10d}" for b in BINS))
print("landmarks:", len(groups), "| lens-category buckets:", sum(k.startswith("cat:") for k in groups))
