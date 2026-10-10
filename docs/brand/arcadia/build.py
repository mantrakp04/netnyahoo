"""Arcadia's logo assets from the oil-painted "hills" (source/, picked 2026-10-10). Run from the repo root;
the results go to output/brand/arcadia/final/, then to their slots (see README.md)."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SRC = Path("docs/brand/arcadia/source")
OUT = Path("output/brand/arcadia/final")
OUT.mkdir(parents=True, exist_ok=True)
LZ = Image.LANCZOS


def clean_alpha(im, floor=16):
    """Drop the faint flecks around a cut-out and trim to the art."""
    im = im.convert("RGBA")
    a = np.array(im.getchannel("A")).astype(np.int32)
    a = np.where(a < floor, 0, np.clip((a - floor) * 255 // (255 - floor), 0, 255))
    im.putalpha(Image.fromarray(a.astype(np.uint8)))
    return im.crop(im.getbbox())


def rounded_mask(size, box, radius, ss=4):
    m = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle([v * ss for v in box], radius * ss, fill=255)
    return m.resize((size, size), LZ)


# Tile artwork: the painted square without its own (soft) edge, as a full-bleed square.
src = Image.open(SRC / "app-icon.png").convert("RGBA")
art = src.crop((131, 133, 893, 891))
parchment = tuple(int(v) for v in np.median(np.array(art)[8:40, 300:460, :3].reshape(-1, 3), axis=0))
flat = Image.new("RGBA", art.size, parchment + (255,))
flat.alpha_composite(art)
square = flat.resize((1024, 1024), LZ)
square.save(OUT / "tile-square-1024.png")
print("parchment", "#%02X%02X%02X" % parchment)

# macOS icon: Apple's 1024 template (824 body at a 100 inset, 185.4 radius) with its drop shadow.
icon = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
body = (100, 100, 924, 924)
mask = rounded_mask(1024, body, 185.4)
shadow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
shadow.putalpha(ImageChops.offset(mask, 0, 10).point(lambda v: v * 0.3).filter(ImageFilter.GaussianBlur(12)))
icon.alpha_composite(shadow)
tile = square.resize((824, 824), LZ)
canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
canvas.paste(tile, (100, 100))
canvas.putalpha(mask)
icon.alpha_composite(canvas)
icon.save(OUT / "icon-1024.png")
for px in (16, 32, 64, 128, 180, 256, 512):
    icon.resize((px, px), LZ).save(OUT / f"icon-{px}.png")

# Painted mark (no tile): New Tab page and the plate app-icon variants.
mark = clean_alpha(Image.open(SRC / "mark.png"))
mark.save(OUT / "mark-trim.png")


def fit(im, size, width_frac, bottom=None):
    w = round(size * width_frac)
    h = round(im.height * w / im.width)
    if h > size * width_frac:
        h = round(size * width_frac)
        w = round(im.width * h / im.height)
    small = im.resize((w, h), LZ)
    c = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    y = (size - h) // 2 if bottom is None else size - h - bottom
    c.alpha_composite(small, ((size - w) // 2, y))
    return c


# New Tab page: 100 pt square, clipped 15.9 pt above its bottom by the address bar, so the
# hills sit on the bottom edge and rise out from behind the bar.
for scale in (1, 2, 3):
    fit(mark, 100 * scale, 0.94, bottom=0).save(OUT / f"ntp-mark{'' if scale == 1 else f'@{scale}x'}.png")

# Plate variants: the mark centred in a square.
fit(mark, 1024, 0.96).save(OUT / "plate-mark-1024.png")

# 16 pt "new tab" glyph, drawn tinted (one colour): a silhouette with the hills split and
# the sun cut free so it still reads as two hills and a sun.
flat_mark = clean_alpha(Image.open(SRC / "mark-small.png"))
rgb = np.array(flat_mark)[:, :, :3].astype(np.int32)
alpha = np.array(flat_mark)[:, :, 3]
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
sun = (r > 180) & (g > 140) & (b < 140) & (alpha > 128)
light = (g > r + 10) & (g > 110) & ~sun & (alpha > 128)
dark = (alpha > 128) & ~sun & ~light


def grow(m, px):
    return np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(px))) > 127


pt = flat_mark.width / 16  # source pixels per point at 16 pt
gap = 2 * round(pt * 0.45) + 1
# Opening the sun-to-hill gap: a little smaller sun, a shallow notch in the hills.
sy, sx = np.nonzero(sun)
sun_r = np.sqrt(sun.sum() / np.pi)
yy, xx = np.mgrid[: sun.shape[0], : sun.shape[1]]
small_sun = np.hypot(xx - sx.mean(), yy - sy.mean()) <= sun_r - pt * 0.3
cut = (grow(light, gap) & grow(dark, gap)) | (grow(sun, 2 * round(pt * 0.25) + 1) & ~sun) | (sun & ~small_sun)
glyph_a = np.where(cut, 0, alpha)
glyph = Image.new("RGBA", flat_mark.size, (0, 0, 0, 255))
glyph.putalpha(Image.fromarray(glyph_a.astype(np.uint8)))
glyph = glyph.crop(glyph.getbbox())
for scale in (1, 2, 3):
    fit(glyph, 16 * scale, 1.0).save(OUT / f"new-tab-mark{'' if scale == 1 else f'@{scale}x'}.png")
fit(glyph, 512, 1.0).save(OUT / "new-tab-mark-512.png")

# iOS home-screen icon: opaque, full-bleed (iOS rounds it).
square.convert("RGB").resize((180, 180), LZ).save(OUT / "apple-touch-icon.png")
print("done")
