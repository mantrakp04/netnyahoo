#!/bin/bash
# Release day: 0.2.17 against the release candidate, as the table the release notes carry under "## Faster".
#
#   scripts/release-compare-0.2.17.sh <rc Netnyahoo.app> <out dir>      (about 45 minutes; run it in the background)
#
# The RC is dist/<v>-rc/export/Netnyahoo.app from `scripts/release.sh <v> --rc`, built from this working tree (its bench
# bundle is built from the tree, so check the tree is the RC's). Prints the table (Markdown) last and leaves it in
# <out>/table.md (<out>/perf-gate/ when <out> has no /perf-gate/ in its path); <out>/table-detail.md has every row with min–max and runs, for judging the gate.
#
# What it does, all under the perflab lock, nothing launched with plain `open`, the owner's /Applications app untouched:
#   1. fetches 0.2.17's own release zip once (cached in $NN_COMPARE_CACHE, default ~/.cache/netnyahoo/perf-gate/0.2.17:
#      the path has to contain /perf-gate/ so scripts/agent/cpu-cap leaves these instances at normal QoS) and builds its
#      bench bundle from its own source (apps/browser/scripts/perf/legacy-bundle.mjs -> dist/0.2.17/bench/main.jsbundle);
#   2. native-bench interleaved, both apps, run by run: launch x8, then session x2 (idle, memory, tab switch, new tab,
#      new window) and windows x2 (more new windows);
#      and, for "Switching tabs", `--only switch` x3 (0.2.17 freezes background tabs after 60 s, so the session's late
#      switches wait on thawing pages and can't be timed the same way; the dedicated run switches right after opening);
#   3. native-bench --fresh-copy: the first launch after an install, x4;
#   4. the RC alone: newtabkey (⌘T and a keystroke from real key events) and js-bench typing. 0.2.17 can't run either: it
#      has no field timing (journeys) and no perf probe or dev harness in a release bundle. Those rows show "–" for it;
#   5. scripts/release-compare-table.mjs turns the results into the table.
# Afterwards check scripts/agent/cpu-cap's log for pauses during the run (a pause makes the timings invalid).
# Test knobs (a release-day run uses the defaults): NN_COMPARE_LAUNCH_RUNS (8), NN_COMPARE_RUNS (2), NN_COMPARE_IDLE (60 s),
# NN_COMPARE_RC_BUNDLE (a prebuilt bench bundle for the RC; default: built from this tree), NN_COMPARE_CACHE, BENCH_CMD_TIMEOUT_MS.
# Ports: CDP 9770 (native-bench), js-bench 47971 (its instances use CDP 9500+). Needs the display awake (caffeinate runs).
# The old release is the control: the rows that need the new phases (frames, J4) aren't in it. See docs/perf/README.md.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO=$PWD

RC=${1:-}; OUT=${2:-}
if [ -z "$RC" ] || [ -z "$OUT" ]; then sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 64; fi
[ -d "$RC/Contents" ] || { echo "no app at $RC" >&2; exit 66; }
case "$(cd "$RC" && pwd -P)" in /Applications/*) echo "never the owner's /Applications app" >&2; exit 64 ;; esac
RC=$(cd "$RC" && pwd -P); mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd -P)

OLD=0.2.17
CACHE=${NN_COMPARE_CACHE:-$HOME/.cache/netnyahoo/perf-gate/$OLD}
case "$CACHE" in */perf-gate/*) ;; *) echo "NN_COMPARE_CACHE must contain /perf-gate/ (cpu-cap keeps normal QoS for those paths)" >&2; exit 64 ;; esac
# The instances run from <out>/…/app/Netnyahoo.app: that path needs /perf-gate/ too.
case "$OUT" in */perf-gate/*) ;; *) OUT=$OUT/perf-gate; mkdir -p "$OUT" ;; esac
NEW=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$RC/Contents/Info.plist")
[ -n "$NEW" ] || { echo "can't read the RC's version" >&2; exit 66; }
PERF=apps/browser/scripts/perf
BUNDLE_OLD=$REPO/dist/$OLD/bench/main.jsbundle
log() { echo "[compare $(date +%H:%M:%S)] $*"; }

# 1. The old release: its own zip from our GitHub release, and its own bench bundle.
if [ ! -d "$CACHE/Netnyahoo.app" ]; then
  log "downloading Netnyahoo-$OLD.zip (our own release asset)"
  mkdir -p "$CACHE" && (cd "$CACHE" && gh release download "v$OLD" -R mantrakp04/netnyahoo -p "Netnyahoo-$OLD.zip" --clobber && ditto -x -k "Netnyahoo-$OLD.zip" .) || exit 1
fi
if [ ! -f "$BUNDLE_OLD" ]; then
  log "building $OLD's bench bundle from its own tree"
  tmp=$(mktemp -d "$OUT/legacy.XXXX")
  node $PERF/legacy-bundle.mjs "v$OLD" "$tmp" >"$tmp/log" 2>&1 || { tail -20 "$tmp/log" >&2; exit 1; }
  mkdir -p "$(dirname "$BUNDLE_OLD")" && cp "$tmp/main.jsbundle" "$BUNDLE_OLD" && rm -rf "$tmp"
fi

# 2-4. Everything that times something holds the perflab lock for the whole run (one lock, one command).
export LAUNCH_RUNS=${NN_COMPARE_LAUNCH_RUNS:-8} RUNS=${NN_COMPARE_RUNS:-2} IDLE=${NN_COMPARE_IDLE:-60}
export RC_BUNDLE_FLAG=${NN_COMPARE_RC_BUNDLE:+--bundle $NN_COMPARE_RC_BUNDLE}
export REPO RC OUT OLD NEW CACHE BUNDLE_OLD PERF
exec caffeinate -d scripts/agent/locked perflab --wait 3000 --as compare -- bash -c '
set -uo pipefail
cd "$REPO"
log() { echo "[compare $(date +%H:%M:%S)] $*"; }
NB="node $PERF/native-bench.mjs --app $RC --label $NEW --control $CACHE/Netnyahoo.app --control-label $OLD --control-bundle $BUNDLE_OLD $RC_BUNDLE_FLAG --idle $IDLE"
log "launch, session, windows: $OLD and $NEW interleaved"
$NB --out $OUT/nb --port 9770 --only launch,session,windows --launch-runs $LAUNCH_RUNS --runs $RUNS || exit 1
log "tab switches, right after the tabs open (0.2.17 freezes background tabs after a minute; a full session switches late)"
$NB --out $OUT/switch --port 9770 --only switch --runs $((RUNS + 1)) || log "switch runs failed: that row falls back to the full session"
log "first launch after an install (fresh copies)"
$NB --out $OUT/fresh --port 9770 --only launch --fresh-copy --launch-runs $((LAUNCH_RUNS / 2)) || log "fresh-copy launches failed: those rows stay empty"
log "$NEW alone: ⌘T and keystroke journeys"
node $PERF/native-bench.mjs --app $RC --label $NEW --out $OUT/journeys --port 9770 --only newtabkey --runs $RUNS $RC_BUNDLE_FLAG || log "journeys failed: those rows stay empty"
log "$NEW alone: js-bench typing (own bundle)"
node $PERF/js-bench.mjs run --app $RC --bundle $RC/Contents/Resources/main.jsbundle --label $NEW --scenarios startup,typing --runs $((RUNS + 1)) --port 47971 --out $OUT/js >$OUT/js.log 2>&1 || log "js-bench failed (see $OUT/js.log): those rows stay empty"
log "table"
node scripts/release-compare-table.mjs $OUT $OLD $NEW
scripts/agent/unregister-builds >/dev/null 2>&1 || true
'
