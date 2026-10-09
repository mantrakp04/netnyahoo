#!/usr/bin/env bash
# Step 1: check out Chromium $CHROMIUM_VERSION (env.sh) for the Mac, without history, and run its
# hooks; no build. Then step 3 (ungoogled-chromium), step 4 (domain substitution and our series),
# step 2 (GN args) and step 5 (build).
set -euo pipefail
source ~/chromium-build/scripts/env.sh
# A new checkout needs a new base for `series.py check` (step 4 captures it).
rm -rf "$CB/series-base"
mkdir -p "$CB/chromium_git/chromium"
cd "$CB/chromium_git/chromium"
cat > .gclient <<GCLIENT
solutions = [{'managed': False, 'name': 'src',
  'url': 'https://chromium.googlesource.com/chromium/src.git@refs/tags/$CHROMIUM_VERSION',
  'custom_vars': {'checkout_pgo_profiles': False, 'source_tarball': False, 'siso_version': 'latest'},
  'custom_deps': {}, 'deps_file': 'DEPS', 'safesync_url': ''}]
target_os = ['mac']
GCLIENT
lowprio_net gclient sync --no-history --nohooks -j 16
lowprio_net gclient runhooks
