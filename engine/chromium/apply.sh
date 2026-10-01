#!/usr/bin/env bash
# Puts Netnyahoo's own Chromium code into the tree: engine/chromium/src mirrors paths under
# chromium/src, and each directory listed in `owned` is ours alone, so it is copied with --delete.
# The hooks that make Chromium build it are patches in packages/cef/patches (`series`:
# cef-netnyahoo-layer.patch links it into CEF's libcef_static, chromium-netnyahoo-layer.patch into
# Chrome's framework for NNCore). Idempotent; never touches args.gn.
#
# The convention, shared with engine/nncore: engine/<layer>/src mirrors the tree, engine/<layer>/apply.sh
# copies it in (`--check` exits 1 when the tree differs), and the repo copy is the only one to edit.
#
#   engine/chromium/apply.sh            copy
#   engine/chromium/apply.sh --check    exit 1 if the tree differs from the repo
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
src=${CHROMIUM_SRC:-$HOME/chromium-build/chromium_git/chromium/src}
owned=(chrome/browser/netnyahoo)

for dir in "${owned[@]}"; do
  if [[ "${1:-}" == --check ]]; then
    diff -r "$here/src/$dir" "$src/$dir" >/dev/null || { echo "drift: $dir" >&2; exit 1; }
  else
    mkdir -p "$src/$dir"
    rsync -a --delete --checksum "$here/src/$dir/" "$src/$dir/"
  fi
done
