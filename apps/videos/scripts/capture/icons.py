"""The seven app icons, cut from the real Settings › Appearance capture (public/footage/windows, label "appearance"):
Default, Midnight, Daylight, Plum, Ocean, Mono, Noir → public/footage/icons/0…6.png. The end card cycles through them.
Positions are the picker's own (2x): the first icon's centre and the pitch between icons."""
import json, os
from PIL import Image, ImageDraw

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
d = os.path.join(ROOT, "public", "footage")
labels = json.load(open(os.path.join(d, "windows", "frames.json")))["frames"]
src = next(f["file"] for f in labels if f["label"] == "appearance")
im = Image.open(os.path.join(d, "windows", src)).convert("RGB")
os.makedirs(os.path.join(d, "icons"), exist_ok=True)
CX, CY, PITCH, HALF = 555, 1020, 156, 46
mask = Image.new("L", (HALF * 8, HALF * 8), 0)
ImageDraw.Draw(mask).rounded_rectangle([8, 8, HALF * 8 - 9, HALF * 8 - 9], int(HALF * 8 * 0.225), fill=255)
mask = mask.resize((HALF * 2, HALF * 2), Image.LANCZOS)
for i in range(7):
    cx = CX + PITCH * i
    tile = im.crop((cx - HALF, CY - HALF, cx + HALF, CY + HALF)).convert("RGBA")
    tile.putalpha(mask)  # every icon is a plate (the painted hills on parchment, night, paper, plum…)
    tile.save(os.path.join(d, "icons", f"{i}.png"))
print("icons → public/footage/icons")
