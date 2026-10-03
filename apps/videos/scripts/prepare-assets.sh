#!/bin/bash
# Copies the brand's fonts and Big Yahu's poster from the repo into public/ (both gitignored here: the sources are
# tracked where they live). Footage and music are made by scripts/capture and scripts/music (README.md).
set -euo pipefail
V=$(cd "$(dirname "$0")/.." && pwd); R=$(cd "$V/../.." && pwd)
F=$R/apps/site/node_modules/@fontsource-variable
[ -d "$F" ] || (cd "$R/apps/site" && pnpm install --frozen-lockfile)
mkdir -p "$V/public/fonts" "$V/public/brand"
cp "$F/archivo/files/archivo-latin-wdth-normal.woff2" "$F/martian-mono/files/martian-mono-latin-wdth-normal.woff2" \
  "$F/newsreader/files/newsreader-latin-opsz-normal.woff2" "$F/newsreader/files/newsreader-latin-opsz-italic.woff2" "$V/public/fonts/"
# Big Yahu, cropped to the figure (the site's poster has room around him).
python3 - "$R/apps/site/src/assets/yahu-poster.webp" "$V/public/brand/yahu.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGBA")
x0, y0, x1, y1 = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
im.crop((max(0, x0 - 8), max(0, y0 - 8), min(im.width, x1 + 8), min(im.height, y1 + 8))).save(sys.argv[2])
PY
# The app icon (Big Yahu fused with a browser window), at 512 px.
python3 -c "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGBA').resize((512, 512), Image.LANCZOS).save(sys.argv[2])" \
  "$R/apps/browser/assets/app-icon.png" "$V/public/brand/app-icon.png"
# Big Yahu's rigged model (clips "Griddy" and "Default Dance"), the site's own.
mkdir -p "$V/public/models"
cp "$R/apps/site/public/models/big-yahu.glb" "$V/public/models/"
# macOS's own pointer artwork, drawn by AppKit (scripts/capture/cursor.swift).
swift "$V/scripts/capture/cursor.swift" "$V/public/brand" > /dev/null
echo "fonts and brand → $V/public"
