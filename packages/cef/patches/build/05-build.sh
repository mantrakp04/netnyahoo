#!/usr/bin/env bash
# Step 5: compile at normal priority; autoninja picks the job count (JOBS overrides).
# -k 0 keeps going past failures so one pass surfaces every broken file.
set -euo pipefail
source ~/chromium-build/scripts/env.sh
"$CB/scripts/yahu-resource.sh"
cd "$CB/chromium_git/chromium/src"
TARGETS="${TARGETS:-cefclient cefsimple}"
exec autoninja ${JOBS:+-j "$JOBS"} -k "${KEEP_GOING:-0}" -C out/Release_GN_arm64 $TARGETS
