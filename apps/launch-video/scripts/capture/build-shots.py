import json, os, sys, shutil, subprocess, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from composite import composite
L = os.environ["CAPTURE_DIR"]; S = f"{L}/steps"; OUT = f"{L}/shots"
FOOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../assets/footage")
os.makedirs(FOOT, exist_ok=True)

def blank(path):
    a = np.array(Image.open(path).convert("L").resize((288, 180))).astype(float)
    side = a[20:170, 5:35]
    return side.std() < 4 or a.std() < 3  # no sidebar content drawn, or a flat frame

def seq(name, frames):
    """frames: list of (snapshot, page) per output frame at 30 fps → composited PNGs → mp4"""
    d = f"{OUT}/{name}"; shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    cache = {}
    for i, (snap, page) in enumerate(frames):
        key = (snap, page); dst = f"{d}/{i:04d}.png"
        if key in cache: shutil.copy(cache[key], dst); continue
        composite(snap, page, dst); cache[key] = dst
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "30", "-i", f"{d}/%04d.png", "-vf", "format=yuv420p",
                    "-c:v", "libx264", "-crf", "20" if name.startswith("montage") else "14", "-preset", "slow", "-tune", "animation", f"{FOOT}/{name}.mp4"], check=True)
    print(name, len(frames), "frames", os.path.getsize(f"{FOOT}/{name}.mp4") // 1024, "KB")

def log(name): return [e for e in json.load(open(f"{S}/{name}.json"))["log"] if "f" in e]

# S5: the sidebar address bar opens Arc's dropdown and "netnyahoo" is typed, ~110 ms a letter.
a = [e for e in log("addr") if not blank(e["f"])]
closed = [e for e in a if e["label"] == "closed"]; opening = [e for e in a if e["label"] == "opening"]
typed = [e for e in a if e["label"].startswith("type:")]; hold = [e for e in a if e["label"] == "hold"]
earth = f"{S}/earth1.png"
fr = [(closed[-1]["f"], earth)] * 12
fr += [(opening[0]["f"], earth)] * 3 + [(opening[-1]["f"], earth)] * 20
for e in typed: fr += [(e["f"], earth)] * 3 + ([(e["f"], earth)] if e["label"].endswith(("y", "o")) else [])
fr += [(hold[-1]["f"], earth)] * 30
seq("addr", fr)

# S6: the sidebar pages from Personal to Work (one snapshot per 1/30 s of the drag), then the Work window.
w = log("swipe")
drag = [e for e in w if e["label"].startswith("drag") and not blank(e["f"])]
settle = [e for e in w if e["label"] == "settle" and not blank(e["f"])]
start = [e for e in w if e["label"] == "start" and not blank(e["f"])]
wiki = f"{S}/wiki-immunity.png"
# the settled Work window: the last settle frames, whose field reads en.wikipedia.org
done = settle[-1]["f"]
fr = [(start[-1]["f"], earth)] * 8 + [(e["f"], earth) for e in drag] + [(done, wiki)] * 36
seq("swipe", fr)

# S7: the Web Store page itself (no window): "Add to Netnyahoo" (0.8 s, the cursor travels in), its hover state,
# the click, the install spinner (3 s of real time compressed to 0.6 s; our install dialog in between is cut),
# then "Remove from Netnyahoo".
WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../assets/web")
d = f"{OUT}/store"; shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
plan = [("00001", 24), ("00004", 8)] + [(f"{n:05d}", 2) for n in range(5, 14)] + [("00014", 3), ("00016", 30)]
k = 0
for name, n in plan:
    for _ in range(n): shutil.copy(f"{S}/store-page/{name}.jpg", f"{d}/{k:04d}.jpg"); k += 1
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "30", "-i", f"{d}/%04d.jpg", "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "15", "-preset", "slow", f"{WEB}/store.mp4"], check=True)

# S8: three heavy pages, each in the real window, on the page's own clock.
for n in ["aquarium", "earth", "yahu"]:
    pages = sorted(os.listdir(f"{S}/mont-{n}"))[:30]
    seq(f"montage-{n}", [(f"{S}/win-{n}.png", f"{S}/mont-{n}/{p}") for p in pages])
