import os
from PIL import Image, ImageFilter
L = os.environ["CAPTURE_DIR"]; C = f"{L}/cap"; S = f"{L}/steps"
WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../assets/web"); os.makedirs(WEB, exist_ok=True)

def blur(im, box, r=18):
    reg = im.crop(box).filter(ImageFilter.GaussianBlur(r)); im.paste(reg, box[:2]); return im

LOGO = (0, 0, 170, 170)  # the site's logo, top-left of the page (2x px)
# 1: the cookie wall: just the banner (the page above it shows an IP address and ISP), its body copy blurred
im = Image.open(f"{C}/cookie/00030.png").convert("RGB")
im = blur(im, (80, 1330, 1420, 1600), 9)
im.crop((0, 1180, 1460, 1774)).save(f"{WEB}/cookie.webp", quality=95)
# 2 and 4: the same forecast page, blocking off and on
for src, name in [("weather-off/00001.png", "weather-ads"), ("weather-on/00001.png", "weather-clean")]:
    blur(Image.open(f"{C}/{src}").convert("RGB"), LOGO).save(f"{WEB}/{name}.webp", quality=95)
