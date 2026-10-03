"""Builds finished window frames from a raw capture (.capture/<scene>, made by cap.mjs):

- the app's in-process snapshot of its window (2x, transparent where Metal draws: the window's tint);
- the window's tint under it: the profile's backdrop as the app paints it, sampled from the snapshot's own opaque
  sidebar edge where it has one, otherwise from the tint table below (the app's windowTint, dark/light);
- each shown page's own picture (capturePicture, the page as painted) in its frame, wherever the snapshot shows the
  page's placeholder (our UI drawn over the page, a popover say, stays on top);
- AppKit's traffic lights (scripts/capture/lights.swift) at the window's close-button position (log or default);
During a profile swipe the app cross-fades the tint from one profile's to the next by the pager's position; frames
the scene marks with `p` (the swipe's progress) get that blend, from tints sampled at rest. The window's rounded
corners are the film's (CSS), so frames are opaque JPEGs.

usage: python3 composite.py <scene> → public/footage/<scene>/0000.jpg … and frames.json; updates
src/lib/nn-launch/footage.json (frame counts, size and labels per scene)
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
RADIUS = 42  # px at 2x: the window's corner, measured from apps/site's ScreenCaptureKit window captures
LIGHTS_AT = (16, 18)  # pt: AppKit's 18,20 close-button origin (NETNYAHOO_TRAFFIC_LIGHTS_LOG) less the image's 2 pt pad

# Opaque window tint (top, bottom) per profile colour, from apps/browser/src/lib/windowTint.ts (docs/brand/inventory.md
# 2.3), used where a snapshot has no opaque sidebar to sample.
TINT = {
    "dark": {"plum": ("#342123", "#3B3031"), "pink": ("#342123", "#3B3031"), "blue": ("#242A30", "#343537"),
             "purple": ("#262130", "#353037"), "red": ("#342121", "#3B3030"), "orange": ("#342520", "#3B3230"),
             "yellow": ("#342B20", "#3B3530"), "green": ("#24302A", "#343834"), "neutral": ("#1F1B1A", "#231F1E")},
    "light": {"plum": ("#E7CFD3", "#F2E7E9"), "pink": ("#E7CFD3", "#F2E7E9"), "blue": ("#D0DDE7", "#E7EDF2"),
              "purple": ("#D2CFE7", "#E8E7F2"), "red": ("#E7CFD0", "#F2E7E7"), "orange": ("#E7D6CF", "#F2EAE6"),
              "yellow": ("#E7DFCF", "#F2EEE6"), "green": ("#D0E7DE", "#E7F2ED"), "neutral": ("#F0F0F0", "#F6F5F5")},
}


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)


_lights = {}


def lights(dark):
    key = "dark" if dark else "light"
    if key not in _lights:
        path = os.path.join(ROOT, ".capture", f"lights-{key}.png")
        if not os.path.exists(path):
            os.system(f'swift "{os.path.join(HERE, "lights.swift")}" "{path}" {key} > /dev/null')
        _lights[key] = Image.open(path).convert("RGBA")
    return _lights[key]


_mask = {}


def corners(w, h):
    if (w, h) not in _mask:
        m = Image.new("L", (w * 2, h * 2), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, w * 2 - 1, h * 2 - 1], RADIUS * 2, fill=255)
        _mask[(w, h)] = m.resize((w, h), Image.LANCZOS)
    return _mask[(w, h)]


def backdrop(snap, color, dark, tint=None):
    """The tint behind the window: a vertical gradient. Sampled from the snapshot's opaque left edge (the sidebar's
    first column), else the table."""
    H, W = snap.shape[:2]
    col = snap[:, 2, :]
    opaque = col[:, 3] > 250
    top, bottom = TINT["dark" if dark else "light"].get(color or "plum", TINT["dark"]["plum"])
    top, bottom = hexrgb(top), hexrgb(bottom)
    if tint is not None:
        top, bottom = tint
    elif opaque[: H // 10].sum() > 4:
        top = col[: H // 10][opaque[: H // 10]][:, :3].astype(np.float32).mean(axis=0)
        lower = opaque.copy()
        lower[: H * 9 // 10] = False
        if lower.sum() > 4:
            bottom = col[lower][:, :3].astype(np.float32).mean(axis=0)
        else:
            bottom = top + (bottom - hexrgb(TINT["dark" if dark else "light"].get(color or "plum")[0]))
    t = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    grad = top[None, :] * (1 - t) + bottom[None, :] * t
    return np.broadcast_to(grad[:, None, :], (H, W, 3)).copy()


def placeholder_mask(region):
    """Where the snapshot shows the page placeholder: its most common colour, opaque."""
    flat = region[::9, ::9, :3].reshape(-1, 3).astype(int)
    vals, counts = np.unique(flat, axis=0, return_counts=True)
    ph = vals[counts.argmax()].astype(np.float32)
    diff = np.abs(region[..., :3].astype(np.float32) - ph).max(axis=2)
    return (diff <= 3) & (region[..., 3] > 250)


def sampled_tint(snap_path):
    snap = np.array(Image.open(snap_path).convert("RGBA"))
    H = snap.shape[0]
    col = snap[:, 2, :]
    op = col[:, 3] > 250
    top = col[: H // 10][op[: H // 10]][:, :3].astype(np.float32)
    low = op.copy()
    low[: H * 9 // 10] = False
    bottom = col[low][:, :3].astype(np.float32)
    if len(top) < 4 or len(bottom) < 4:
        return None
    return top.mean(axis=0), bottom.mean(axis=0)


def composite(snap_path, page_items, color, dark, tint=None, slide=None):
    snap = np.array(Image.open(snap_path).convert("RGBA"))
    H, W = snap.shape[:2]
    a = snap[..., 3:4].astype(np.float32) / 255
    rgb = snap[..., :3].astype(np.float32)
    if tint is not None:
        # Recolour the snapshot's own opaque tint (the sidebar's plain areas) to the blended tint.
        own = sampled_tint(snap_path)
        if own is not None:
            t = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
            own_grad = own[0] * (1 - t) + own[1] * t
            new_grad = tint[0] * (1 - t) + tint[1] * t
            near = (np.abs(rgb - own_grad).max(axis=2, keepdims=True) < 6) & (a > 0.98)
            rgb = np.where(near, rgb + (new_grad - own_grad), rgb)
    base = backdrop(snap, color, dark, tint)
    out = rgb * a + base * (1 - a)  # snapshot pixels are straight alpha
    for page_path, frame in page_items:
        x, y, w, h = [int(round(v * 2)) for v in frame]
        x2, y2 = min(W, x + w), min(H, y + h)
        if x2 <= x or y2 <= y:
            continue
        page = Image.open(page_path).convert("RGB")
        if page.size != (w, h):
            page = page.resize((w, h), Image.LANCZOS)
        if slide is not None:
            # A profile swipe: the app slides the sidebar; the film slides the page with it. The outgoing page travels
            # with the fingers and the incoming one follows it in, offset by the drag fraction.
            p, direction, incoming = slide
            inc = Image.open(incoming).convert("RGB")
            if inc.size != (w, h):
                inc = inc.resize((w, h), Image.LANCZOS)
            strip = Image.new("RGB", (w, h))
            ox = int(round(direction * p * w))
            strip.paste(page, (ox, 0))
            strip.paste(inc, (ox - direction * w, 0))
            page = strip
        page = np.array(page, np.float32)[: y2 - y, : x2 - x]
        m = placeholder_mask(snap[y:y2, x:x2])
        if m.mean() < 0.2 and (snap[y:y2, x:x2, 3] < 128).mean() > 0.6:
            # Right after a profile swipe commits, the hidden instance shows the new page's card a beat late (its
            # view is re-attached): the snapshot has no card there yet. Put the page where its card goes, as the app
            # does once attached (card radius 10 pt).
            card = np.asarray(Image.new("L", (x2 - x, y2 - y), 0), np.float32)
            mask_img = Image.new("L", (x2 - x, y2 - y), 0)
            ImageDraw.Draw(mask_img).rounded_rectangle([0, 0, x2 - x - 1, y2 - y - 1], 20, fill=255)
            m = (np.asarray(mask_img) > 127) & (snap[y:y2, x:x2, 3] < 128)
        reg = out[y:y2, x:x2]
        reg[m] = page[m]
    img = Image.fromarray(out.clip(0, 255).astype(np.uint8)).convert("RGBA")
    li = lights(dark)
    img.alpha_composite(li, (LIGHTS_AT[0] * 2, LIGHTS_AT[1] * 2))
    return img.convert("RGB")


ORDER = ["default", "work", "campaign", "side", "weekend"]


def main():
    scene = sys.argv[1]
    src = os.path.join(ROOT, ".capture", scene)
    man = json.load(open(os.path.join(src, "manifest.json")))
    dst = os.path.join(ROOT, "public", "footage", scene)
    if os.path.isdir(dst):
        for f in os.listdir(dst):
            os.remove(os.path.join(dst, f))
    os.makedirs(dst, exist_ok=True)
    pages = man["pages"]
    frames = [fr for fr in man["frames"] if fr.get("ok")]
    rest = {}
    for fr in frames:  # each profile's tint at rest, for the swipe blend
        if "p" not in fr and fr.get("profile") and fr["profile"] not in rest:
            t = sampled_tint(fr["f"])
            if t is not None:
                rest[fr["profile"]] = t
    # A page shown again after a swipe can be captured before it repaints: a blank picture. Skip those and keep the
    # tab's last good one.
    blank = {}
    def is_blank(p):
        if p["file"] not in blank:
            a = np.asarray(Image.open(os.path.join(src, p["file"])).convert("L").resize((96, 60)), np.float32)
            blank[p["file"]] = float(a.std()) < 4.0
        return blank[p["file"]]
    # Each frame's own picture of a tab, else the tab's last good one, else its next good one (a profile's page
    # during the swipe that first shows it).
    own = []
    for fr in frames:
        keys = fr.get("pageKey") or {}
        pick = {}
        for tab in fr.get("tabs", []):
            # The frame's own picture first; the tab's generic one only when it has none.
            c = next((c for c in (pages.get(keys.get(tab, "")), pages.get(tab)) if c and not is_blank(c)), None)
            if c:
                pick[tab] = c
        own.append(pick)
    # Each swipe's incoming page: the picture its rest frame shows.
    incoming = {}
    for i, fr in enumerate(frames):
        if fr.get("label", "").endswith(":rest") and own[i]:
            incoming[fr["label"][: -len(":rest")]] = os.path.join(src, next(iter(own[i].values()))["file"])
    # Each swipe's outgoing page: the picture its drag frames show (filled in as the loop reaches them).
    outgoing = {}
    last_page = {}
    out = []
    for i, fr in enumerate(frames):
        items = []
        for tab in fr.get("tabs", []):
            p = own[i].get(tab) or last_page.get(tab) or next((o[tab] for o in own[i + 1:] if tab in o), None)
            if p:
                last_page[tab] = p
                items.append((os.path.join(src, p["file"]), p["frame"]))
        tint = None
        if "p" in fr and fr.get("profile") in ORDER:
            i = ORDER.index(fr["profile"]) + (1 if fr["dir"] < 0 else -1)
            other = ORDER[i] if 0 <= i < len(ORDER) else None
            if other in rest and fr["profile"] in rest:
                p = min(1.0, max(0.0, fr["p"]))
                a, b = rest[fr["profile"]], rest[other]
                tint = (a[0] * (1 - p) + b[0] * p, a[1] * (1 - p) + b[1] * p)
        slide = None
        base = fr.get("label", "").split(":")[0]
        if "p" in fr and items and base not in outgoing:
            outgoing[base] = items[0][0]
        if fr.get("pos") is not None and fr.get("from") is not None and base in incoming:
            # The page travels exactly as far as the pager has (its own position), so page and sidebar move as one.
            frac = min(1.0, max(0.0, abs(fr["pos"] - fr["from"])))
            if True:
                if fr.get("label", "").endswith(":settle"):
                    # After the commit the app shows the new page; the outgoing one is the drag's.
                    out_tab = outgoing.get(base)
                    if out_tab:
                        items = [(out_tab, items[0][1])] if items else items
                if items:
                    slide = (frac, int(fr["dir"]), incoming[base])
        elif "p" in fr and fr.get("label") in incoming and items:
            slide = (min(1.0, max(0.0, fr["p"])), int(fr["dir"]), incoming[fr["label"]])
        img = composite(fr["f"], items, fr.get("color"), fr.get("dark", True), tint, slide)
        name = f"{len(out):04d}.jpg"
        img.save(os.path.join(dst, name), quality=93, subsampling=0)
        progress = round(abs(fr["pos"] - fr["from"]), 4) if fr.get("pos") is not None and fr.get("from") is not None else None
        out.append({"file": name, "label": fr.get("label"), "t": fr.get("t"), "profile": fr.get("profile"), "progress": progress})
    size = [img.width, img.height]
    json.dump({"frames": out, "size": size}, open(os.path.join(dst, "frames.json"), "w"), indent=1)
    index_path = os.path.join(ROOT, "src", "lib", "nn-launch", "footage.json")
    index = json.load(open(index_path)) if os.path.exists(index_path) else {}
    marks = {fr["label"]: fr["mark"] for fr in frames if fr.get("mark")}
    progress = [f["progress"] for f in out]
    index[scene] = {"size": size, "labels": [f["label"] for f in out], **({"marks": marks} if marks else {}),
                    **({"progress": progress} if any(p is not None for p in progress) else {})}
    json.dump(dict(sorted(index.items())), open(index_path, "w"), indent=1)
    print(f"{scene}: {len(out)} frames → {dst}")


if __name__ == "__main__":
    main()
