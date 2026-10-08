#!/bin/bash
# Stages NNCore for the app target (apps/browser/macos): a copy of Chrome's framework built with
# engine/nncore, signed ad hoc with its helpers. The app links the staged copy and embed.sh clones it into the bundle.
#
# Each build stages into its own NNCORE_STAGE_DIR (the project sets it inside the derived data), so builds running
# in parallel never replace a framework another one is linking or embedding. The copy is made and signed once per
# engine build into a shared cache (apps/browser/build-nncore/staged/<key>), and each build clones that: an APFS
# clone, instant, no new disk. The copy out of Chromium's out dir holds the chromium lock (an engine build writes
# there under it), and the key is read under that lock too, so it always names what was copied. No lock is held while
# waiting for another: two builds that find a new engine at once both copy and sign, and the first to publish wins.
#
#   NNCORE_FRAMEWORK=<path to Chromium Framework.framework>   another build than out/Release_GN_arm64
# Without a local engine build, it uses the prebuilt one matching engine/ (fetch-engine.sh downloads it once).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
src=${NNCORE_FRAMEWORK:-$HOME/chromium-build/chromium_git/chromium/src/out/Release_GN_arm64/Chromium Framework.framework}
if [[ -z "${NNCORE_FRAMEWORK:-}" && ! -d "$src" ]]; then
  src=$("$here/fetch-engine.sh") || exit 1
fi
dest=${NNCORE_STAGE_DIR:-$repo/apps/browser/build-nncore/NNCoreFramework}
cache=${NNCORE_STAGE_CACHE:-$repo/apps/browser/build-nncore/staged}
name="Chromium Framework"

# Under the cache lock (fill_cache): publish a signed copy as <key> unless another build did first, then drop copies
# of other engine builds nobody has staged from in an hour, and leftovers of stagers that died.
if [[ "${1:-}" == --publish ]]; then
  tmp=$2 key=$3
  if [[ -f "$cache/$key/.complete" ]]; then
    rm -rf "$tmp"
  else
    rm -rf "${cache:?}/$key"
    mv "$tmp" "$cache/$key"
  fi
  for old in "$cache"/*/; do
    old=${old%/}
    [[ -d "$old" ]] || continue
    [[ "${old##*/}" == "$key" ]] && continue
    [[ -n "$(find "$old" -maxdepth 0 -mmin -60)$(find "$old" -maxdepth 1 -name .used -mmin -60)" ]] || rm -rf "$old"
  done
  find "$cache" -mindepth 1 -maxdepth 1 -name '.tmp-*' -mmin +60 -exec rm -rf {} + 2>/dev/null || true
  exit 0
fi

[[ -d "$src" ]] || { echo "error: no NNCore framework at $src (engine/nncore/apply.sh, then build chrome_framework)" >&2; exit 1; }
# Which engine build: where it is, when it was written and its size.
key_of() { printf '%s %s' "$1" "$(stat -f '%m %z' "$1/Versions/Current/$name")" | shasum -a 256 | cut -c1-16; }
stamp="$dest/.stamp"

# Copies the engine into a private folder of the cache and signs it, then publishes it. Prints the key.
fill_cache() {
  local tmp="$cache/.tmp-$$" key fwv lib helper
  rm -rf "$tmp" && mkdir -p "$tmp" || return 1
  echo "staging $src" >&2
  "$repo/scripts/agent/locked" chromium --wait 500 -- bash -c '
    set -e
    printf "%s %s" "$1" "$(stat -f "%m %z" "$1/Versions/Current/$3")" | shasum -a 256 | cut -c1-16 >"$2/.key"
    cp -cR "$1" "$2/"' _ "$src" "$tmp" "$name" >&2 || return 1
  key=$(cat "$tmp/.key") || return 1
  # Ad hoc, without the hardened runtime (a development build; release signing is docs/nncore-spike.md's).
  sign() { codesign --force --timestamp=none --sign - "$@"; }
  fwv=$(cd "$tmp/$name.framework/Versions/Current" && pwd -P) || return 1
  for lib in "$fwv"/Libraries/*.dylib; do
    if [[ -e "$lib" ]]; then sign "$lib" || return 1; fi
  done
  for helper in "$fwv"/Helpers/*.app "$fwv"/Helpers/chrome_crashpad_handler "$fwv"/Helpers/app_mode_loader "$fwv"/Helpers/web_app_shortcut_copier; do
    if [[ -e "$helper" ]]; then sign "$helper" || return 1; fi
  done
  sign "$tmp/$name.framework" || return 1
  touch "$tmp/.complete" "$tmp/.used" || return 1
  # lockf's lock dies with its holder.
  lockf -k -t 120 "$cache/.lock" "$0" --publish "$tmp" "$key" >&2 || return 1
  echo "$key"
}

key=$(key_of "$src")
if [[ -f "$stamp" && "$(cat "$stamp")" == "$key" && -d "$dest/$name.framework" ]]; then
  exit 0
fi
mkdir -p "$cache" "$dest"
for attempt in 1 2 3; do
  if [[ ! -f "$cache/$key/.complete" ]]; then
    key=$(fill_cache) || { echo "error: staging NNCore from $src failed" >&2; exit 1; }
  fi
  # Marks the copy in use (pruning skips it for an hour), then clones it. Pruned in between: stage it again.
  touch "$cache/$key/.used" 2>/dev/null || continue
  rm -rf "$dest/$name.framework.new"
  cp -cR "$cache/$key/$name.framework" "$dest/$name.framework.new" 2>/dev/null || continue
  rm -rf "$dest/$name.framework"
  mv "$dest/$name.framework.new" "$dest/$name.framework"
  echo "$key" >"$stamp"
  exit 0
done
echo "error: couldn't stage NNCore from $cache (it kept changing under this build)" >&2
exit 1
