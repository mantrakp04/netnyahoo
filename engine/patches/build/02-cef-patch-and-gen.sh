#!/usr/bin/env bash
# Step 2: our CEF patches (the `cef` lines of engine/patches/series), then CEF's hook: generates the
# translated API files, applies CEF's Chromium patches and runs `gn gen` for out/Release_GN_arm64 with
# GN_DEFINES. The rest of the series goes in after ungoogled-chromium and domain substitution (step 4).
set -euo pipefail
source ~/chromium-build/scripts/env.sh
source ~/chromium-build/scripts/gn_defines.sh
series="$NN_REPO/engine/patches/series.py"
# The base `series.py check` compares against: CEF's files as the series finds them (once per checkout).
python3 "$series" capture-base --phase cef
python3 "$series" apply --phase cef
cd "$CB/chromium_git/chromium/src/cef"
echo "GN_DEFINES=$GN_DEFINES"
lowprio_net python3 tools/gclient_hook.py
