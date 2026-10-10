#!/bin/bash
# Renders scripts/dmg/background.html to background.tiff (660×460 pt at 1× and 2×), the picture behind the disk
# image's window. Run it after editing the HTML and commit the TIFF. Needs Google Chrome and a connection (the page
# loads the site's typefaces from Google Fonts).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$chrome" ] || { echo "error: no Chrome at $chrome (set CHROME)" >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Without the typefaces the page still renders, at the right size, in fallback type.
fonts="$(sed -n 's/.*href="\(https:\/\/fonts\.googleapis\.com[^"]*\)".*/\1/p' "$here/background.html")"
[ -n "$fonts" ] && curl -fsS --max-time 20 -o /dev/null "$fonts" \
  || { echo "error: can't load the typefaces from Google Fonts" >&2; exit 1; }

for scale in 1 2; do
  "$chrome" --headless=new --user-data-dir="$tmp/profile" --no-first-run --disable-gpu --hide-scrollbars \
    --window-size=660,460 --force-device-scale-factor="$scale" --virtual-time-budget=8000 \
    --screenshot="$tmp/$scale.png" "file://$here/background.html" >/dev/null 2>&1
  [ "$(sips -g pixelWidth "$tmp/$scale.png" | awk '/pixelWidth/ { print $2 }')" = "$((660 * scale))" ] \
    || { echo "error: the ${scale}× render isn't $((660 * scale)) px wide" >&2; exit 1; }
  sips -s format tiff -s dpiWidth "$((72 * scale))" -s dpiHeight "$((72 * scale))" "$tmp/$scale.png" --out "$tmp/$scale.tiff" >/dev/null
done
tiffutil -cathidpicheck "$tmp/1.tiff" "$tmp/2.tiff" -out "$here/background.tiff"
echo "$here/background.tiff"
