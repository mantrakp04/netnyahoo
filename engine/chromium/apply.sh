#!/usr/bin/env bash
# Puts Arcadia's own Chromium code into the tree: engine/chromium/src mirrors paths under
# chromium/src, and each directory listed in `owned` is ours alone, so it is copied with --delete.
# The hook that makes Chromium build it is a patch in engine/patches (`series`:
# chromium-arcadia-layer.patch links it into Chrome's framework for ArcadiaCore). Idempotent; never
# touches args.gn.
#
# The convention, shared with engine/arcadiacore: engine/<layer>/src mirrors the tree, engine/<layer>/apply.sh
# copies it in (`--check` exits 1 when the tree differs), and the repo copy is the only one to edit.
#
#   engine/chromium/apply.sh            copy
#   engine/chromium/apply.sh --check    exit 1 if the tree differs from the repo
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
src=${CHROMIUM_SRC:-$HOME/chromium-build/chromium_git/chromium/src}
owned=(chrome/browser/arcadia)

for dir in "${owned[@]}"; do
  if [[ "${1:-}" == --check ]]; then
    diff -r "$here/src/$dir" "$src/$dir" >/dev/null || { echo "drift: $dir" >&2; exit 1; }
  else
    mkdir -p "$src/$dir"
    # Not -t: a copied file gets the time of the copy, so ninja always sees it as new (a repo file
    # older than the last gn run would otherwise never regenerate or recompile).
    rsync -rlp --delete --checksum "$here/src/$dir/" "$src/$dir/"
  fi
done
