#!/usr/bin/env bash
# Step 2: add our CEF patches to src/cef, then run CEF's hook: generates the
# translated API files, applies CEF's Chromium patches and runs `gn gen`
# for out/Release_GN_arm64 with GN_DEFINES.
set -euo pipefail
source ~/chromium-build/scripts/env.sh
source ~/chromium-build/scripts/gn_defines.sh
src="$CB/chromium_git/chromium/src"
cd "$src/cef"
for p in "$CB"/patches/cef-*.patch; do
  if git apply --check "$p" 2>/dev/null; then git apply "$p"; echo "applied $(basename "$p")"
  elif git apply --check -R "$p" 2>/dev/null; then echo "already applied $(basename "$p")"
  else echo "error: $(basename "$p") does not apply" >&2; exit 1; fi
done
# Our Chromium patches (idempotent; step 4 re-runs this after ungoogled).
"$CB/scripts/apply-chromium-patches.sh" || echo "note: Chromium patches will be applied after step 4"
cd "$src/cef"
echo "GN_DEFINES=$GN_DEFINES"
lowprio_net python3 tools/gclient_hook.py
