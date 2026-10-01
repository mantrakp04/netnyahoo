#!/usr/bin/env bash
# Step 1: check out CEF branch 8037 + Chromium 154.0.8037.58 (no history), no build.
set -euo pipefail
source ~/chromium-build/scripts/env.sh
unset DEPOT_TOOLS_UPDATE   # first run must bootstrap depot_tools
# A new checkout needs a new base for `series.py check` (steps 2 and 4 capture it).
rm -rf "$CB/series-base"
cd "$CB/automate"
exec taskpolicy -c utility -d throttle nice -n 19 python3 automate-git.py \
  --download-dir="$CB/chromium_git" --depot-tools-dir="$CB/depot_tools" \
  --branch=$CEF_BRANCH --no-chromium-history --arm64-build --no-debug-build \
  --no-build --no-distrib
