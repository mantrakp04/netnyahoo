#!/usr/bin/env bash
# Step 4: ungoogled-chromium domain substitution (rewrites Google & co. hostnames
# in ~18k Chromium source files to unresolvable *.qjz9zk names). The original
# contents are kept in domsubcache.tar.gz so it can be reverted:
#   python3 ungoogled/utils/domain_substitution.py revert -c domsubcache.tar.gz <src>
set -euo pipefail
source ~/chromium-build/scripts/env.sh
src="$CB/chromium_git/chromium/src"
cache="$CB/domsubcache.tar.gz"
if [ -e "$cache" ]; then echo "already substituted ($cache exists)"; else
cd "$CB/ungoogled"
# Keep the Chrome Web Store / extension update sources out of it
# (domsub-keep-store.txt).
python3 - "$CB/scripts/domsub-keep-store.txt" domain_substitution.list > "$CB/domain_substitution.filtered.list" <<'PY'
import fnmatch, sys
keep = [l.strip() for l in open(sys.argv[1]) if l.strip() and not l.startswith('#')]
for path in open(sys.argv[2]).read().splitlines():
    if path and not any(fnmatch.fnmatch(path, p) for p in keep):
        print(path)
PY
lowprio python3 utils/domain_substitution.py apply \
  -r domain_regex.list -f "$CB/domain_substitution.filtered.list" -c "$cache" "$src"
fi
"$CB/scripts/apply-chromium-patches.sh"
