"""Composites a Netnyahoo window frame from real captures:
- the app's own in-process snapshot of its window (devSnapshotWindow, 2x): our UI, with each web page's area
  drawn as an opaque placeholder in that page's background colour;
- each page's own CDP capture, placed in its pane (panes found from the snapshot's geometry, left to right),
  except where our UI draws over the placeholder (dropdowns, dialogs); a dialog's scrim is carried onto the page;
- the window's real traffic lights and corner shape, from a `screencapture -l` still of the same build (sc.png).
usage: composite.py <snapshot.png> <page.png|-> [<page2.png>…] <out.png>
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

L = os.environ["CAPTURE_DIR"]
PANE_RADIUS = 20
SIDEBAR_SAMPLE = (40, 1500)  # a plain patch of sidebar, for measuring a scrim

_refs = None
def refs():
    global _refs
    if _refs is None:
        sc = np.array(Image.open(f"{L}/sc.png").convert("RGBA")).astype(np.float32)
        lights = sc[30:78, 26:180, :3] - np.array([48, 35, 40], np.float32)  # additive, over the sidebar
        _refs = (lights, sc[:48, :48, 3] / 255.0)
    return _refs

def rounded(w, h, r):
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=255)
    return np.array(m, np.float32) / 255.0

def panes(snap):
    """Pane rects (x, y, w, h) in the page area: runs along the middle row that differ from the window
    background between the sidebar and the first pane."""
    H, W = snap.shape[:2]
    y = H // 2
    bg = snap[y, 372]
    row = np.abs(snap[y, :, :] - bg).max(axis=1) > 6
    row[:376] = False
    out, x = [], 376
    while x < W:
        if row[x]:
            x0 = x
            while x < W and row[x]: x += 1
            if x - x0 > 200:
                cx = (x0 + x) // 2
                col = np.abs(snap[:, cx, :] - snap[3, cx]).max(axis=1) > 6
                ys = np.nonzero(col)[0]
                top = int(ys.min())
                out.append((x0, top, x - x0, H - 2 * top))  # the pane is inset equally top and bottom
        x += 1
    return out

def composite(snap_path, pages, out_path, ref_sidebar=None):
    snap = np.array(Image.open(snap_path).convert("RGB")).astype(np.float32)
    out = snap.copy()
    k = 1.0
    if ref_sidebar is not None:  # a scrim over the window: its darkening, measured on the sidebar
        k = float(snap[SIDEBAR_SAMPLE[1], SIDEBAR_SAMPLE[0]].mean() / max(ref_sidebar, 1))
    for (x, y, w, h), page_path in zip(panes(snap), pages):
        if page_path == "-": continue
        page = Image.open(page_path).convert("RGB")
        # a capture of the page's viewport at 2x fills the pane; the pane can be a pixel off the viewport
        page = np.array(page.resize((w, h), Image.LANCZOS) if page.size != (w, h) else page).astype(np.float32) * (k if k < 0.97 else 1)
        reg = snap[y:y + h, x:x + w]
        flat = reg[::7, ::7].reshape(-1, 3).astype(int)
        vals, counts = np.unique(flat, axis=0, return_counts=True)
        ph = vals[counts.argmax()].astype(np.float32)
        overlay = (np.abs(reg - ph).max(axis=2) > 10).astype(np.uint8) * 255
        overlay = np.array(Image.fromarray(overlay).filter(ImageFilter.MaxFilter(3)), np.float32) / 255.0
        m = rounded(w, h, PANE_RADIUS) * (1 - overlay)
        out[y:y + h, x:x + w] = reg * (1 - m[..., None]) + page * m[..., None]
    lights, corner = refs()
    lh, lw = lights.shape[:2]
    out[30:30 + lh, 26:26 + lw] = np.clip(out[30:30 + lh, 26:26 + lw] + lights * k, 0, 255)
    H, W = out.shape[:2]
    a = np.ones((H, W), np.float32); n = corner.shape[0]
    a[:n, :n] = np.minimum(a[:n, :n], corner); a[:n, W - n:] = np.minimum(a[:n, W - n:], corner[:, ::-1])
    a[H - n:, :n] = np.minimum(a[H - n:, :n], corner[::-1]); a[H - n:, W - n:] = np.minimum(a[H - n:, W - n:], corner[::-1, ::-1])
    Image.fromarray(np.dstack([out, a * 255]).clip(0, 255).astype(np.uint8)).save(out_path, compress_level=2)

if __name__ == "__main__":
    args = sys.argv[1:]
    composite(args[0], args[1:-1], args[-1])
