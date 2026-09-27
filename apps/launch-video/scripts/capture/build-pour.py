"""Builds "Pour"'s window pictures (assets/pour/, 2720x1720, the window at 2x) from the captures in $CAPTURE_DIR:
the app's own snapshots of its window (harness/pour-*.js, via shot.sh) with each page's CDP capture placed in the
page's area. These captures use the default layout (the address in the toolbar), so the page sits at the bottom
of the content card, under its toolbar; composite.py's pane finder assumes the sidebar layout and isn't used.

Stills are JPEG (4:4:4, q95); the Focus-mode slide is an H.264 clip. The window's corners are cut in the film
(a clip-path), so nothing here carries alpha. Writes assets/pour/pour.json with the clip's timing.
usage: CAPTURE_DIR=… build-pour.py
"""
import json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from composite import refs

L = os.environ["CAPTURE_DIR"]
S, PAGES, WORK = f"{L}/steps2", f"{L}/pages", f"{L}/pour-build"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../assets/pour")
os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK, exist_ok=True)
PANE_RADIUS = 20

def rounded(w, h, r):
    from PIL import ImageDraw
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=255)
    return np.array(m, np.float32) / 255.0

def card(snap):
    """The content card: the widest run along the lower middle row that isn't the window's background, and
    its bottom edge (the card is inset equally left of the sidebar's edge and at the bottom)."""
    H, W = snap.shape[:2]
    y = H - 60
    bg = snap[y, 4]
    row = np.abs(snap[y] - bg).max(axis=1) > 6
    runs, x = [], 0
    while x < W:
        if row[x]:
            x0 = x
            while x < W and row[x]: x += 1
            runs.append((x0, x))
        x += 1
    x0, x1 = max(runs, key=lambda r: r[1] - r[0])
    col = np.abs(snap[:, (x0 + x1) // 2] - bg).max(axis=1) > 6
    bottom = int(np.nonzero(col)[0].max()) + 1
    return x0, x1, bottom

def composite(snap_path, page_path, out_path, card_from=None):
    """card_from: a snapshot to find the card in, when UI (the peek) covers part of it in this one."""
    snap = np.array(Image.open(snap_path).convert("RGB")).astype(np.float32)
    out = snap.copy()
    if page_path:
        page = np.array(Image.open(page_path).convert("RGB")).astype(np.float32)
        ph, pw = page.shape[:2]
        x0, x1, bottom = card(snap if card_from is None else np.array(Image.open(card_from).convert("RGB")).astype(np.float32))
        if abs((x1 - x0) - pw) > 2:
            raise SystemExit(f"{snap_path}: card {x1 - x0} px wide, page {pw}")
        x, y = x0, bottom - ph
        reg = snap[y:y + ph, x:x + pw]
        # the page's placeholder: the area's commonest colour; our UI drawn over it (a popover, the bar's
        # dropdown, the peek) differs from it and stays
        flat = reg[::7, ::7].reshape(-1, 3).astype(int)
        vals, counts = np.unique(flat, axis=0, return_counts=True)
        ph_col = vals[counts.argmax()].astype(np.float32)
        overlay = (np.abs(reg - ph_col).max(axis=2) > 10).astype(np.uint8) * 255
        from PIL import ImageFilter
        overlay = np.array(Image.fromarray(overlay).filter(ImageFilter.MaxFilter(3)), np.float32) / 255.0
        # only the card's bottom corners are rounded (its top is the toolbar)
        m = np.ones((ph, pw), np.float32)
        rr = rounded(pw, 2 * PANE_RADIUS + 2, PANE_RADIUS)
        m[-(PANE_RADIUS + 1):] = rr[-(PANE_RADIUS + 1):]
        m *= 1 - overlay
        out[y:y + ph, x:x + pw] = reg * (1 - m[..., None]) + page[:, :pw] * m[..., None]
    lights, _ = refs()
    lh, lw = lights.shape[:2]
    out[30:30 + lh, 26:26 + lw] = np.clip(out[30:30 + lh, 26:26 + lw] + lights, 0, 255)
    im = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    if out_path.endswith(".png"): im.save(out_path, compress_level=1)
    else: im.save(out_path, quality=95, subsampling=0)

def still(name, snap, page):
    composite(snap, page, f"{OUT}/{name}.jpg")
    print(name)

def log(name): return json.load(open(f"{S}/{name}.json"))["log"]

# ---- stills
bar = {e["label"]: e["f"] for e in log("pour-bar") if "f" in e}
still("bar-open", bar["open"], f"{PAGES}/silk-docked.png")
still("bar-n", bar["type:n"], f"{PAGES}/silk-docked.png")
still("bar-net", bar["type:net"], f"{PAGES}/silk-docked.png")
peek = [e for e in log("pour-peek")]
shots = [e for e in peek if "f" in e]
still("hero", shots[0]["f"], f"{PAGES}/silk-docked.png")
still("full", [e for e in shots if e["label"] == "after"][0]["f"], f"{PAGES}/silk-full.png")
still("block", [e for e in log("pour-block") if e.get("label") == "popover"][-1]["f"], f"{PAGES}/mw.png")
still("repo", log("pour-repo")[0]["f"], f"{PAGES}/repo.png")
still("incognito", log("pour-incog")[0]["f"], f"{PAGES}/silk-incog.png")

# ---- Focus mode: the peek, open over the full-width page, slides away. The capture ran with Animated.timing
# SLOW times slower; the clip plays it back at FRAMES frames for the whole slide (so SLOW/(FRAMES/30/0.18)
# times slower than life). A snapshot's moment is the middle of its render.
SLOW = json.load(open(f"{S}/pour-peek.json"))["SLOW"]
out_at = [e for e in peek if "peekOut" in e][0]["peekOut"]
slide_start = out_at + 120  # the peek waits 120 ms (not slowed) before it slides
slide_ms = 180 * SLOW
outs = [e for e in shots if e["label"] in ("out", "after")]
ins = [e for e in shots if e["label"] == "in"]
mid = lambda e: (e["t"] + e["t1"]) / 2
FRAMES = 42
REST = 12
seq = [ins[-1]["f"]] * REST  # the peek at rest
# The peek's own curve is Easing.out(cubic): position done = 1 - (1 - u)^3 at time fraction u. A speed ramp
# makes the slide ease in and out (smoothstep in position): each frame takes the snapshot nearest the moment the
# peek reached that position. Nothing is interpolated.
smooth = lambda x: x * x * (3 - 2 * x)
for i in range(FRAMES + 1):
    t = slide_start + slide_ms * (1 - (1 - smooth(i / FRAMES)) ** (1 / 3))
    seq.append(min(outs, key=lambda e: abs(mid(e) - t))["f"])
seq += [outs[-1]["f"]] * 6
d = f"{WORK}/focus"; shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
done = {}
for i, f in enumerate(seq):
    dst = f"{d}/{i:04d}.png"
    if f in done: shutil.copy(done[f], dst); continue
    composite(f, f"{PAGES}/silk-full.png", dst, card_from=outs[-1]["f"]); done[f] = dst
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "30", "-i", f"{d}/%04d.png", "-vf", "format=yuv420p",
                "-c:v", "libx264", "-crf", "12", "-preset", "slow", "-tune", "film", f"{OUT}/focus.mp4"], check=True)
distinct = len(set(seq))
json.dump({"focus": {"frames": len(seq), "rest": REST, "slide": FRAMES + 1, "distinctSnapshots": distinct, "slow": SLOW}},
          open(f"{OUT}/pour.json", "w"), indent=1)
print("focus.mp4", len(seq), "frames,", distinct, "distinct snapshots")
