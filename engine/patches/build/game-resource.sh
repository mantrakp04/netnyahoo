#!/usr/bin/env bash
# Packs the app's offline game (apps/browser/assets/offline-game in $AC_REPO) into
# the single file chromium-neterror-mascot.patch's resource names,
# components/neterror/resources/game/game.html (untracked in the Chromium tree).
# apply-chromium-patches.sh and step 5 run it, so a build always ships the game as it is.
set -euo pipefail
source ~/chromium-build/scripts/env.sh
python3 "$AC_REPO/apps/browser/assets/offline-game-pipeline/inline.py" \
  "$CB/chromium_git/chromium/src/components/neterror/resources/game/game.html"
