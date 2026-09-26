"""Builds the film's window clips (assets/footage/*.mp4, 2880x1800, 30 fps) from the captures in $CAPTURE_DIR,
with every state change placed on the beat grid of src/timeline.ts (72 BPM: a beat is 25 frames).

Each clip is a list of (UI snapshot, page captures…) per output frame; composite.py makes the frames.
Writes assets/footage/film.json with the frames the clips' events land on (for the camera and the foley).
"""
import json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from composite import composite, SIDEBAR_SAMPLE

L = os.environ["CAPTURE_DIR"]
S, V, OUT = f"{L}/steps2", f"{L}/v2", f"{L}/film"
FOOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../assets/footage")
events = {}

_blank = {}
def blank(path):
    """Snapshots taken while a window redraws can come back empty: no sidebar detail at all."""
    if path not in _blank:
        a = np.array(Image.open(path).convert("L").resize((288, 180))).astype(float)
        _blank[path] = a[10:170, 2:36].std() < 6
    return _blank[path]

def log(name): return [e for e in json.load(open(f"{S}/{name}.json"))["log"] if "f" not in e or not blank(e["f"])]
def snaps(name, prefix=""): return [e for e in log(name) if "f" in e and e["label"].startswith(prefix)]
def mean_px(path, x, y): return np.array(Image.open(path).convert("RGB").getpixel((x, y)), float)

def clip(name, frames, sidebar_ref=None):
    d = f"{OUT}/{name}"; shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    done = {}
    for i, (snap, *pages) in enumerate(frames):
        key = (snap, *pages); dst = f"{d}/{i:04d}.png"
        if key in done: shutil.copy(done[key], dst); continue
        composite(snap, pages, dst, sidebar_ref); done[key] = dst
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "30", "-i", f"{d}/%04d.png", "-vf", "format=yuv420p",
                    "-c:v", "libx264", "-crf", "13", "-preset", "slow", "-tune", "animation", f"{FOOT}/{name}.mp4"], check=True)
    print(name, len(frames), "frames", os.path.getsize(f"{FOOT}/{name}.mp4") // 1024, "KB")

earth = lambda i: f"{S}/earth/{min(300, i + 1):04d}.jpg"

# ---- Bars 1-2 (film frames 0-200): Personal. The globe turns; on bar 2's downbeat the sidebar field opens Arc's
# dropdown, "netnyahoo" is typed on the eighth notes of beat 1-2, it holds, and Escape closes it on the last eighth.
a = {e["label"]: e["f"] for e in snaps("addr")}
fr = [(f"{S}/idle.png", earth(i)) for i in range(100)]
fr += [(a["open"], earth(i)) for i in range(100, 106)]
letters = [f"type:{'netnyahoo'[:k]}" for k in range(1, 10)]
t = 106
events["addrOpen"] = 100; events["addrLetters"] = []
for k, lab in enumerate(letters):
    n = 4
    events["addrLetters"].append(t)
    fr += [(a[lab], earth(t + j)) for j in range(n)]; t += n
fr += [(a["hold"], earth(i)) for i in range(t, 188)]
fr += [(a["closed-after"], earth(i)) for i in range(188, 200)]
events["addrClose"] = 188
clip("film-personal", fr)

# ---- Bar 3 (200-300): the sidebar swipes from Personal to Work through the real tracker: 100 eased steps
# (Personal and Work side by side mid-way, the tint crossing over), resampled into 84 frames; then the settle.
w = snaps("swipe")
start = [e for e in w if e["label"] == "start"][-1]["f"]
drag = [e["f"] for e in w if e["label"].startswith("drag")]
settle = [e["f"] for e in w if e["label"] == "settle"]
earth_bg = mean_px(f"{S}/idle.png", 1600, 1700)
def page_for(snap, i):
    # the page area's placeholder is the showing page's background: the globe's black, or the repo's dark grey
    return earth(200 + i) if np.abs(mean_px(snap, 1600, 1700) - earth_bg).max() < 4 else f"{V}/p-repo-full.png"
fr = [(start, earth(200 + i)) for i in range(3)]
events["swipeStart"] = 203
# the drag fills 203-275; the first settle frame that shows Work's page lands on beat 4 (275)
DRAG = 72
for i in range(DRAG):
    s_ = drag[min(len(drag) - 1, round(i * (len(drag) - 1) / (DRAG - 1)))]
    fr.append((s_, page_for(s_, len(fr))))
flip = next(i for i, s_ in enumerate(settle) if page_for(s_, 0).endswith("p-repo-full.png"))
before = settle[:flip][-3:]  # the pager finishing its move, just before the page changes
fr = fr[: 75 - len(before)] + [(s_, page_for(s_, 72 + k)) for k, s_ in enumerate(before)]
for s_ in settle[flip:]:
    fr.append((s_, page_for(s_, len(fr))))
events["swipeFlip"] = 275
fr = (fr + [fr[-1]] * 100)[:100]
clip("film-swipe", fr)

# ---- Bar 4 (300-400): split view, on the downbeat: the extension docs open beside the repo.
clip("film-split", [(f"{V}/s-split.png", f"{V}/p-repo.png", f"{V}/p-docs.png")] * 118)  # until the camera is inside the docs page (418)

# ---- Bar 5 (400-500; the clip starts at 409, inside the zoom-through's white): the Web Store, scrolled so its
# "Switch to Chrome" banner is under the sticky header. The recorded press is placed on beat 3 (450); real time
# until our dialog has been accepted; the ~5 s install spinner cut; "Remove from Netnyahoo" on bar
# 6's downbeat (500), held while the camera pulls back.
st = [e for e in log("store") if "f" in e]
times = [l.split() for l in open(f"{S}/store-page/times.txt") if l.strip()]
PRESS = int(next(t for n, t in times if n == "press"))
pages = [(int(t) - PRESS, f"{S}/store-page/{n}.jpg") for n, t in times if n not in ("press", "release")]
def at(seq, ms): return [f for t, f in seq if t <= ms][-1] if any(t <= ms for t, _ in seq) else seq[0][1]
ui = [(e["t"] - PRESS, e["f"]) for e in st]
ref = mean_px(st[0]["f"], *SIDEBAR_SAMPLE).mean()
DONE = f"{V}/bw-done/00005.jpg"  # "Remove from Netnyahoo", once the install finished
fr = []
for f in range(409, 525):
    if f < 450: ms = -1079 if f < 444 else -545  # "Add", then its hover as the cursor arrives
    elif f < 475: ms = (f - 450) * 700 / 25  # press → our dialog (first drawn at +701 ms), which lands on beat 4 (475)
    elif f < 500: ms = 701 + (f - 475) * (1381 - 701) / 25  # the dialog, until it is accepted (real time)
    else: ms = None
    fr.append((at(ui, ms), at(pages, ms)) if ms is not None else (f"{V}/s-store-done.png", DONE))
events["storePress"] = 450; events["storeDialog"] = 475; events["storeDone"] = 500
clip("film-store", fr, sidebar_ref=ref)

# ---- Bars 6-7 (500-700): the whole window; on beat 2 of bar 6 the sidebar switches to the repo's tab.
fr = [(f"{V}/s-store-done.png", DONE)] * 25 + [(f"{V}/s-repo.png", f"{V}/p-repo-full.png")] * 175
events["repoClick"] = 525
clip("film-hero", fr)

json.dump(events, open(f"{FOOT}/film.json", "w"), indent=1)
print(events)
