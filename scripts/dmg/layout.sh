#!/bin/bash
# Writes scripts/dmg/DS_Store, the Finder layout scripts/release.sh copies into the disk image: a 660×384 pt icon-view
# window with no toolbar or sidebar, background.tiff behind it (as .background.tiff in the volume), 112 pt icons and
# where the app and the Applications link sit. Run it after changing any of those and commit the file; the picture
# alone changes with render.sh. It builds a throwaway image with dmgbuild (installed into a temporary venv, so it
# needs a connection) and never opens Finder. The layout finds the picture by volume name and path, so both must
# stay "Netnyahoo" and ".background.tiff".
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'hdiutil detach "$tmp/mnt" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT

python3 -m venv "$tmp/venv"
"$tmp/venv/bin/pip" install -q --disable-pip-version-check dmgbuild==1.6.7
mkdir -p "$tmp/Netnyahoo.app" "$tmp/mnt"
cat > "$tmp/settings.py" <<EOF
files = ["$tmp/Netnyahoo.app"]
symlinks = {"Applications": "/Applications"}
background = "$here/background.tiff"
window_rect = ((200, 160), (660, 384))
default_view = "icon-view"
show_icon_preview = False
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
arrange_by = None
label_pos = "bottom"
text_size = 13
icon_size = 112
icon_locations = {"Netnyahoo.app": (176, 208), "Applications": (484, 208)}
EOF
"$tmp/venv/bin/dmgbuild" -s "$tmp/settings.py" Netnyahoo "$tmp/layout.dmg" >/dev/null 2>&1
hdiutil attach "$tmp/layout.dmg" -nobrowse -readonly -mountpoint "$tmp/mnt" >/dev/null 2>&1
cp "$tmp/mnt/.DS_Store" "$here/DS_Store"
echo "$here/DS_Store"
