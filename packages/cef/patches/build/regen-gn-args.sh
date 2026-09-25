#!/usr/bin/env bash
# Rewrites out/Release_GN_arm64/args.gn from GN_DEFINES (CEF's gn_args.py, the
# same merge gclient_hook.py does) and runs `gn gen`, without re-running CEF's
# patcher, which can't recognize its own patches once ungoogled-chromium and
# domain substitution changed their context. Use after step 2 has run once.
set -euo pipefail
source ~/chromium-build/scripts/env.sh
source ~/chromium-build/scripts/gn_defines.sh
src="$CB/chromium_git/chromium/src"
cd "$src/cef/tools"
python3 - "$src/out" <<'PY'
import os, sys
import gn_args
out = sys.argv[1]
for name, args in gn_args.GetAllPlatformConfigs({}).items():
    os.makedirs(os.path.join(out, name), exist_ok=True)
    with open(os.path.join(out, name, 'args.gn'), 'w') as f:
        f.write(gn_args.GetConfigFileContents(args) + '\n')
    print('wrote', name)
PY
cd "$src"
gn gen out/Release_GN_arm64
