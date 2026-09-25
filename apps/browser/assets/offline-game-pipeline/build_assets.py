"""Cut the generated character sheets into sprites and encode the game payload.

Usage (from this folder):
  swiftc -O cutout.swift -o /tmp/cutout
  uv run --with numpy --with scipy --with pillow build_assets.py <raw-dir> <cutout-bin>

<raw-dir> holds the codex outputs: sheet1..N.png, decoys.png, yahu.png, bg-*.png.
Writes ../offline-game/assets/{crowd,bg}/*.webp and ../offline-game/assets/manifest.js.
The engine ships the folder packed into one file by inline.py (the CEF build runs it).
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
GAME = HERE.parent / "offline-game" / "assets"
SPRITE_H = 400  # px; covers ~4x zoom on back rows at 2x DPR
BG_W = 1600

# Sheets and which cells (row-major, 0-based) to drop after review.
SHEETS = {
    "sheet1": ("crowd", set()),
    "sheet2": ("crowd", set()),
    # 2: read as a caricature of a real politician (blond swoop, cream suit)
    "sheet3": ("crowd", {2}),
    # 2: blond mop read as a real politician
    "sheet4": ("crowd", {2}),
    # 1, 8: glamour-shot framing, off-tone for the satire
    "sheet5": ("crowd", {1, 8}),
    "decoys": ("decoy", set()),
    "yahu": ("yahu", set()),
}
# Decoy trait per cell (row-major) for the difficulty ramp.
DECOY_TRAITS = ["hair", "hair", "tie", "tie", "tie", "hair", "tie", "hair", "tie"]


def cut_sheet(raw: Path, cutout_bin: str, tmp: Path):
    rgba_path = tmp / f"{raw.stem}-rgba.png"
    subprocess.run([cutout_bin, str(raw), str(rgba_path)], check=True)
    im = Image.open(rgba_path).convert("RGBA")
    a = np.asarray(im)[:, :, 3]
    solid = a > 40
    labels, n = ndimage.label(solid)
    areas = ndimage.sum(np.ones_like(a), labels, range(1, n + 1))
    median = float(np.median([x for x in areas if x > 0.005 * a.size]))
    # Busts whose shoulders touch come out as one blob: cut it at the thinnest
    # column (side by side) or row (stacked) near its middle, then relabel.
    for i, sl in enumerate(ndimage.find_objects(labels)):
        if areas[i] < 1.6 * median:
            continue
        ys, xs = sl
        blob = labels[sl] == i + 1
        horizontal = (xs.stop - xs.start) > (ys.stop - ys.start) * 1.2
        prof = blob.sum(axis=0 if horizontal else 1)
        lo, hi = int(len(prof) * 0.3), int(len(prof) * 0.7)
        cut = lo + int(np.argmin(prof[lo:hi]))
        if horizontal:
            solid[ys, xs.start + cut - 1 : xs.start + cut + 2] &= ~blob[:, cut - 1 : cut + 2]
        else:
            solid[ys.start + cut - 1 : ys.start + cut + 2, xs] &= ~blob[cut - 1 : cut + 2, :]
    labels, n = ndimage.label(solid)
    comps = []
    for i, sl in enumerate(ndimage.find_objects(labels)):
        if sl is None:
            continue
        area = int((labels[sl] == i + 1).sum())
        if area < 0.01 * a.size:
            continue
        ys, xs = sl
        comps.append((ys.start, ys.stop, xs.start, xs.stop, i + 1))
    # Row-major order: bucket by vertical centre into thirds of the sheet.
    h = a.shape[0]
    comps.sort(key=lambda c: (int(((c[0] + c[1]) / 2) / (h / 3)), (c[2] + c[3]) / 2))
    out = []
    for y0, y1, x0, x1, lab in comps:
        crop = np.asarray(im)[y0:y1, x0:x1].copy()
        # Keep only this component's pixels (neighbours can poke into the bbox).
        keep = ndimage.binary_dilation(labels[y0:y1, x0:x1] == lab, iterations=3)
        crop[:, :, 3] = np.where(keep, crop[:, :, 3], 0)
        out.append(Image.fromarray(crop, "RGBA"))
    return out


def fade_bottom(cell: Image.Image, frac: float = 0.16) -> Image.Image:
    """Soften the bust's chest cut so it melts into the row in front."""
    arr = np.asarray(cell).copy()
    h = arr.shape[0]
    n = max(1, int(h * frac))
    ramp = np.ones(h)
    ramp[h - n:] = np.linspace(1, 0, n) ** 1.4
    arr[:, :, 3] = (arr[:, :, 3] * ramp[:, None]).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def hit_mask(cell: Image.Image, cols: int = 32) -> list:
    """Coarse opacity grid for pixel-ish hit testing without canvas readback
    (getImageData taints under file://). Each row is a 32-bit hex string."""
    rows = max(1, round(cols * cell.height / cell.width))
    a = np.asarray(cell.getchannel("A").resize((cols, rows), Image.BOX)) > 110
    return ["%08x" % int("".join("1" if v else "0" for v in r), 2) for r in a]


def main():
    raw_dir = Path(sys.argv[1])
    cutout_bin = sys.argv[2]
    tmp = raw_dir / "_cut"
    tmp.mkdir(exist_ok=True)
    (GAME / "crowd").mkdir(parents=True, exist_ok=True)
    (GAME / "bg").mkdir(parents=True, exist_ok=True)
    for old in (GAME / "crowd").glob("*.webp"):
        old.unlink()

    sprites = []
    for sheet, (kind, drop) in SHEETS.items():
        src = raw_dir / f"{sheet}.png"
        if not src.exists():
            print("missing", src)
            continue
        cells = cut_sheet(src, cutout_bin, tmp)
        print(sheet, "cells:", len(cells))
        for idx, cell in enumerate(cells):
            if idx in drop:
                continue
            w, h = cell.size
            scale = SPRITE_H / h
            cell = fade_bottom(cell.resize((max(1, round(w * scale)), SPRITE_H), Image.LANCZOS))
            name = f"{kind}-{sheet}-{idx}"
            cell.save(GAME / "crowd" / f"{name}.webp", "WEBP", quality=80, method=6, alpha_quality=90)
            entry = {"id": name, "kind": kind, "w": cell.size[0], "h": cell.size[1], "mask": hit_mask(cell)}
            if kind == "decoy":
                entry["trait"] = DECOY_TRAITS[idx % len(DECOY_TRAITS)]
            sprites.append(entry)

    bgs = []
    for src in sorted(raw_dir.glob("bg-*.png")):
        im = Image.open(src).convert("RGB")
        im = im.resize((BG_W, round(im.height * BG_W / im.width)), Image.LANCZOS)
        im.save(GAME / "bg" / f"{src.stem}.webp", "WEBP", quality=72, method=6)
        bgs.append({"id": src.stem, "w": im.width, "h": im.height})

    manifest = {"sprites": sprites, "backgrounds": bgs}
    (GAME / "manifest.js").write_text(
        "// Generated by offline-game-pipeline/build_assets.py. Do not edit.\n"
        "window.YAHU_MANIFEST = " + json.dumps(manifest, indent=1) + ";\n"
    )
    counts = {k: sum(1 for s in sprites if s["kind"] == k) for k in ("crowd", "decoy", "yahu")}
    print("sprites", counts, "backgrounds", len(bgs))


if __name__ == "__main__":
    main()
