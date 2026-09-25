#!/usr/bin/env python3
"""Scans a swapcap recording for transient frames around a window swap.

usage: swapscan.py <outDir> [--white 0.2] [--delta 0.02]

Each frame is compared with the settled states on either side of the swap (the first and last
frames). A clean swap goes straight from "like the first" to "like the last". A frame that is like
neither is a transient; it is reported with its time and how much of it is near-white (Chrome's
compositor clears to white) or near-black. Exits 1 if there is any.

Needs Pillow (python3 -m pip install pillow).
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

args = sys.argv[1:]
if not args:
    sys.exit(__doc__)
out = Path(args[0])
white_limit = float(args[args.index("--white") + 1]) if "--white" in args else 0.2
delta = float(args[args.index("--delta") + 1]) if "--delta" in args else 0.02

times = dict(line.split() for line in (out / "times.txt").read_text().splitlines() if line.strip())
frames = sorted(out.glob("[0-9]*.png"))
if len(frames) < 3:
    sys.exit(f"only {len(frames)} frames")


def small(path):
    return Image.open(path).convert("RGB").resize((320, 200))


def difference(a, b):
    """Mean absolute difference, 0..1."""
    return sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / (3 * 255)


def fraction(img, test):
    px = img.getdata()
    return sum(1 for p in px if test(p)) / len(px)


first, last = small(frames[0]), small(frames[-1])
transients = []
for path in frames:
    img = small(path)
    to_first, to_last = difference(img, first), difference(img, last)
    white = fraction(img, lambda p: min(p) > 245)
    black = fraction(img, lambda p: max(p) < 10)
    like_either = min(to_first, to_last) <= delta
    if not like_either or white > white_limit:
        transients.append((path.stem, times.get(path.stem, "?"), to_first, to_last, white, black))

print(f"{len(frames)} frames, first→last difference {difference(first, last):.3f}")
for name, t, df, dl, w, b in transients:
    print(f"TRANSIENT {name} t={t}s  vs-first {df:.3f}  vs-last {dl:.3f}  white {w:.0%}  black {b:.0%}")
print("clean" if not transients else f"{len(transients)} transient frame(s)")
sys.exit(1 if transients else 0)
