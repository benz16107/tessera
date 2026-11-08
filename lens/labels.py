"""Label rules shared by the pull, eval and training: f35 with digital zoom, bins, and the landmark split."""
import random

BINS = ["ultrawide", "wide", "normal", "tele", "super-tele"]
EDGES = [24, 35, 70, 200]  # ultrawide <24, wide 24-35, normal 35-70, tele 70-200, super-tele >200


def f35_with_zoom(f35, zoom=None, make=None):
    """EXIF digital zoom above 1 multiplies the 35 mm equivalent (a 33 mm tag on a 2.3x shot is 75 mm).
    Apple writes a tag that already includes the zoom: in the pull, the ratio of f35 to real focal length grew with
    DigitalZoomRatio on 98 of 98 Apple photos and stayed constant on Pixel, Samsung and Sony. So Apple is left alone."""
    if f35 is None or f35 <= 0:
        return None
    if make and make.strip().lower().startswith("apple"):
        return float(f35)
    return f35 * zoom if zoom and zoom > 1 else float(f35)


def to_bin(f35):
    for name, edge in zip(BINS, EDGES):
        if f35 < edge:
            return name
    return BINS[-1]


def split_groups(counts, force_test=("nyc_dumbo",), n_test_extra=2, val_frac=0.1, seed=7):
    """counts: {group: n_images}. Whole groups go to one split. Returns {"train": [...], "val": [...], "test": [...]}."""
    rnd = random.Random(seed)
    test = [g for g in force_test if g in counts]
    # extra test landmarks: real landmarks (not 'cat:' lens-category buckets) of middling size
    pool = sorted(g for g, n in counts.items() if g not in test and not g.startswith("cat:") and 25 <= n <= 160)
    rnd.shuffle(pool)
    test += pool[:n_test_extra]
    rest = sorted(g for g in counts if g not in test)
    rnd.shuffle(rest)
    total = sum(counts[g] for g in rest)
    val, acc = [], 0
    for g in rest:
        if acc >= val_frac * total:
            break
        if g.startswith("cat:"):
            continue
        val.append(g)
        acc += counts[g]
    train = [g for g in rest if g not in val]
    return {"train": sorted(train), "val": sorted(val), "test": sorted(test)}


# Training/serving prompt and the zero-shot variant used for models that were not fine-tuned.
PROMPT = "What is the 35 mm-equivalent focal length of this photo? Answer JSON."
ZERO_SHOT_PROMPT = ('What is the 35 mm-equivalent focal length of this photo, in millimetres? '
                    'Reply with strict JSON only, no other text: {"f35": number}')


def answer_json(f35):
    import json
    return json.dumps({"f35": int(round(f35)), "bin": to_bin(f35)})
