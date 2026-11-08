#!/usr/bin/env python3
"""Side-by-side before/after renders of a splat, one row per view, labelled.
  python compare.py <dir with before_<view>.png and after_<view>.png> <out.png> <view>=<label> ...
"""
import sys
from PIL import Image, ImageDraw, ImageFont

src, out, views = sys.argv[1], sys.argv[2], [a.split('=', 1) for a in sys.argv[3:]]
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans{}.ttf'
big, small = ImageFont.truetype(F.format('-Bold'), 30), ImageFont.truetype(F.format(''), 24)
W, H, PAD, TOP = 960, 600, 16, 56
canvas = Image.new('RGB', (2 * W + 3 * PAD, TOP + len(views) * (H + 44 + PAD)), (18, 18, 20))
d = ImageDraw.Draw(canvas)
for j, t in enumerate(('Before: current splat', 'After: Difix3D pass')):
    d.text((PAD + j * (W + PAD), 14), t, font=big, fill=(240, 240, 240))
for i, (v, label) in enumerate(views):
    y = TOP + i * (H + 44 + PAD)
    d.text((PAD, y), label, font=small, fill=(200, 200, 200))
    for j, k in enumerate(('before', 'after')):
        canvas.paste(Image.open(f'{src}/{k}_{v}.png').convert('RGB').resize((W, H), Image.LANCZOS), (PAD + j * (W + PAD), y + 36))
canvas.save(out)
print('wrote', out, canvas.size)
