#!/usr/bin/env bash
# Step 2: writes out/Release_GN_arm64/args.gn from gn_defines.sh (the complete list) and runs
# `gn gen`. Run it after step 4 (the branding file our series adds must exist), and again
# whenever gn_defines.sh changes.
set -euo pipefail
source ~/chromium-build/scripts/env.sh
source ~/chromium-build/scripts/gn_defines.sh
src="$CB/chromium_git/chromium/src"
mkdir -p "$src/out/$GN_OUT_CONFIGS"
printf '%s\n' "${_gn_args[@]}" | sort >"$src/out/$GN_OUT_CONFIGS/args.gn"
cd "$src"
gn gen "out/$GN_OUT_CONFIGS"
