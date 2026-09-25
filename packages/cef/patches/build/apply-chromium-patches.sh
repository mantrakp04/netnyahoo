#!/usr/bin/env bash
# Applies patches/chromium-*.patch to chromium/src (idempotent). They are made
# against the fully patched tree (CEF + ungoogled + domain substitution), so
# run this after step 4; `patch` tolerates the small context differences if
# it is run earlier.
set -euo pipefail
source ~/chromium-build/scripts/env.sh
cd "$CB/chromium_git/chromium/src"
for p in "$CB"/patches/chromium-*.patch; do
  if patch -p1 --dry-run -R -s -f -i "$p" >/dev/null 2>&1; then echo "already applied $(basename "$p")"
  elif patch -p1 --dry-run --forward -s -i "$p" >/dev/null 2>&1; then patch -p1 --forward -s -i "$p"; echo "applied $(basename "$p")"
  else echo "error: $(basename "$p") does not apply" >&2; exit 1; fi
done
"$CB/scripts/yahu-resource.sh"
