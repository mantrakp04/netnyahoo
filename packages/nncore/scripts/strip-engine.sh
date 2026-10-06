#!/usr/bin/env bash
# Strips the local symbols out of Chrome's framework in an exported app, before release.sh signs it, keeping the
# unstripped files for symbolication.
# usage: strip-engine.sh <Netnyahoo.app> <symbols dir>
#
# The engine is built with symbol_level=0: no DWARF, but every local symbol stays in the symbol table, 175 MB of the
# framework's 441. Gatekeeper's first-launch scan of a copy it hasn't seen (a new install from the DMG, a copy Sparkle
# didn't scan) reads the whole bundle and takes time in proportion to its bytes: on 2026-10-06, the stripped
# framework's first launch waited 7.2/6.7 s against 11.1/12.5 s for the shipped one on the same (loaded) Mac
# (docs/perf/launch-critical-path.md).
#
# `strip -x` removes local symbols only. What stays: the export trie (the nn_* calls NNCoreEngineBridge finds with
# dlsym, the NNCore* classes), the external symbols, the code signature's inputs and the LC_UUID, which this checks.
# The unstripped files are copied to <symbols dir> (same relative paths) first: a crash report's frames in the framework
# symbolicate with `atos -o "<symbols dir>/Chromium Framework" -l <load address> <addresses>` (match the UUID with
# `dwarfdump --uuid`). The signatures break here; release.sh signs everything in the framework afterwards.
set -euo pipefail

app="${1:?usage: strip-engine.sh <Netnyahoo.app> <symbols dir>}"
symbols="${2:?usage: strip-engine.sh <Netnyahoo.app> <symbols dir>}"
fwv="$(cd "$app/Contents/Frameworks/Chromium Framework.framework/Versions/Current" && pwd -P)" \
  || { echo "error: no Chromium Framework.framework in $app" >&2; exit 1; }
mkdir -p "$symbols"
symbols="$(cd "$symbols" && pwd -P)"

uuid() { dwarfdump --uuid "$1" | awk '{ print $2 }'; }
total_before=0 total_after=0
binaries=("$fwv/Chromium Framework" "$fwv"/Libraries/*.dylib "$fwv/Helpers/chrome_crashpad_handler" "$fwv/Helpers/app_mode_loader")
for bin in "${binaries[@]}"; do
  [ -f "$bin" ] || continue
  rel="${bin#"$fwv"/}"
  mkdir -p "$symbols/$(dirname "$rel")"
  cp -c "$bin" "$symbols/$rel"
  before_uuid="$(uuid "$bin")" before_exports="$(dyld_info -exports "$bin" | tail -n +2 | sort)"
  before="$(stat -f %z "$bin")"
  strip -x "$bin" 2>/dev/null
  after="$(stat -f %z "$bin")"
  [ "$(uuid "$bin")" = "$before_uuid" ] || { echo "error: strip changed the UUID of $rel" >&2; exit 1; }
  [ "$(dyld_info -exports "$bin" | tail -n +2 | sort)" = "$before_exports" ] \
    || { echo "error: strip changed what $rel exports" >&2; exit 1; }
  total_before=$((total_before + before)) total_after=$((total_after + after))
done
echo "    stripped ${#binaries[@]} files: $((total_before / 1048576)) MB -> $((total_after / 1048576)) MB (unstripped copies in $symbols)"
