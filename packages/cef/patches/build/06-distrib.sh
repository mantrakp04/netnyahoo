#!/usr/bin/env bash
# Step 6: minimal binary distribution (arm64, Release only, no docs/symbols).
set -euo pipefail
source ~/chromium-build/scripts/env.sh
cd "$CB/chromium_git/chromium/src/cef/tools"
out="$CB/distrib"
mkdir -p "$out"
lowprio python3 make_distrib.py --output-dir="$out" --ninja-build --arm64-build \
  --minimal --allow-partial --no-docs --no-symbols --no-archive
ls "$out"
