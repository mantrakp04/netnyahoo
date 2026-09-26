"""Composites a Netnyahoo window frame from real captures:
- the app's own in-process snapshot of its window (devSnapshotWindow, 2x, our UI; the page area is an opaque placeholder),
- the page's own CDP screenshot, placed at the WebContents rect (380,12,2486x1774 at 2x, 20 px corners)
  except where our UI draws over the placeholder (dropdowns, dialogs),
- the window's real traffic lights and corner shape from a `screencapture -l` still of the same build (sc.png).
usage: composite.py <snapshot.png> <page.(png|jpg)|-> <out.png> [--dim] """
import os, sys, numpy as np
from PIL import Image, ImageFilter
L = os.environ["CAPTURE_DIR"]
PX, PY, PW, PH, PR = 380, 12, 2486, 1774, 20

_sc = None
def refs():
    global _sc
    if _sc is None:
        sc = np.array(Image.open(f"{L}/sc.png").convert("RGBA")).astype(np.float32)
        lights = sc[30:78, 26:180, :3] - np.array([48, 35, 40], np.float32)  # additive delta over the sidebar
        corner = sc[:48, :48, 3] / 255.0
        _sc = (lights, corner)
    return _sc

def rounded(w, h, r):
    m = Image.new("L", (w, h), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=255)
    return np.array(m, np.float32) / 255.0

def composite(snap_path, page_path, out_path, dim=False):
    snap = np.array(Image.open(snap_path).convert("RGB")).astype(np.float32)
    out = snap.copy()
    if page_path != "-":
        page = Image.open(page_path).convert("RGB")
        if page.size != (PW, PH): page = page.resize((PW, PH), Image.LANCZOS)
        page = np.array(page).astype(np.float32)
        reg = snap[PY:PY + PH, PX:PX + PW]
        # the placeholder: the most common colour in the page area
        flat = reg[::7, ::7].reshape(-1, 3).astype(int)
        vals, counts = np.unique(flat, axis=0, return_counts=True)
        ph = vals[counts.argmax()].astype(np.float32)
        diff = np.abs(reg - ph).max(axis=2)
        overlay = (diff > 10).astype(np.float32)
        overlay = np.array(Image.fromarray((overlay * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)), np.float32) / 255.0
        if dim:  # a scrim over the whole page: carry its darkening onto the page
            k = reg.mean() / max(ph.mean(), 1)
            page = page * k
        m = rounded(PW, PH, PR) * (1 - overlay)
        out[PY:PY + PH, PX:PX + PW] = reg * (1 - m[..., None]) + page * m[..., None]
    lights, corner = refs()
    h, w = lights.shape[:2]
    out[30:30 + h, 26:26 + w] = np.clip(out[30:30 + h, 26:26 + w] + lights, 0, 255)
    H, W = out.shape[:2]
    alpha = np.ones((H, W), np.float32)
    c = corner; n = c.shape[0]
    alpha[:n, :n] = np.minimum(alpha[:n, :n], c)
    alpha[:n, W - n:] = np.minimum(alpha[:n, W - n:], c[:, ::-1])
    alpha[H - n:, :n] = np.minimum(alpha[H - n:, :n], c[::-1, :])
    alpha[H - n:, W - n:] = np.minimum(alpha[H - n:, W - n:], c[::-1, ::-1])
    rgba = np.dstack([out, alpha * 255]).clip(0, 255).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(out_path, optimize=False, compress_level=3)

if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    composite(a[0], a[1], a[2], dim="--dim" in sys.argv)
