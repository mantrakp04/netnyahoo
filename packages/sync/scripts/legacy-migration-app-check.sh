#!/bin/bash
# The launch migration in a real (hidden) app: makes data with today's build, turns it into an old install
# (legacy-migration-e2e.mjs --seed-from), then launches the build on a fresh data dir with ARCADIA_LEGACY_SOURCE
# pointing at it and checks that tabs, pins, settings, shortcuts, the bookmark and a site's cookie came across.
#
#   packages/sync/scripts/legacy-migration-app-check.sh <Debug Arcadia.app> [scratch dir under /tmp]
#
# Hidden instances only (scripts/agent/ac): no real Library, keychain or profile is read. Quits what it launched.
set -euo pipefail
app="${1:?usage: legacy-migration-app-check.sh <Arcadia.app> [scratch dir]}"
here="$(cd "$(dirname "$0")" && pwd -P)"
repo="$(cd "$here/../../.." && pwd -P)"
ac="$repo/scripts/agent/ac"
# Under /tmp: cfprefsd won't keep a test instance's preferences under $TMPDIR.
scratch="${2:-/tmp/arcadia-legacy-app-check}"
rm -rf "$scratch" && mkdir -p "$scratch"
made="$scratch/made" migrated="$scratch/migrated" home="$scratch/home"
cleanup() {
  "$ac" quit "$made" --kill >/dev/null 2>&1 || true
  "$ac" quit "$migrated" --kill >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail=0
check() { if [ "$2" = 1 ]; then echo "ok   $1"; else echo "FAIL $1${3:+: $3}"; fail=1; fi; }

echo "==> today's build makes data"
"$ac" launch "$app" --data "$made" --onboarded >/dev/null
"$ac" eval "$made" '
  const s = ac.store.getState();
  const w = Object.keys(s.windows)[0];
  s.updateSettings({ openLinksInLittleArcadia: false, littleArcadiaSize: [810, 610], shortcuts: { ...s.settings.shortcuts, newLittleArcadia: ["cmd+opt+y"] } });
  const history = s.newTab(w, { url: "arcadia://history" });
  const example = s.newTab(w, { url: "https://example.com/" });
  ac.store.getState().pinTabs([example], true);
  ac.store.getState().addBookmark({ profileId: "default", url: "arcadia://downloads", title: "Migration Bookmark" });
  return [history, example];' >/dev/null
sleep 4
"$ac" page "$made" example.com 'document.cookie = "migration=kept; max-age=999999; path=/"; document.cookie' >/dev/null
sleep 2
"$ac" quit "$made" >/dev/null

echo "==> as an old install"
node "$here/legacy-migration-e2e.mjs" --seed-from "$made" "$home"

echo "==> the build migrates it at launch"
"$ac" launch "$app" --data "$migrated" --onboarded --env "ARCADIA_LEGACY_SOURCE=$home" >/dev/null
sleep 4
state="$("$ac" eval "$migrated" '
  const s = ac.store.getState();
  const tabs = Object.values(s.tabs);
  const bookmarks = Object.values(s.bookmarks?.default?.nodes ?? s.bookmarks?.nodes ?? {});
  return JSON.stringify({
    urls: tabs.map((t) => t.url),
    pinned: tabs.filter((t) => t.pinned).map((t) => t.url),
    little: s.settings.openLinksInLittleArcadia,
    size: s.settings.littleArcadiaSize,
    shortcut: s.settings.shortcuts?.newLittleArcadia ?? null,
    bookmark: JSON.stringify(s.bookmarks).includes("Migration Bookmark") && JSON.stringify(s.bookmarks).includes("arcadia://downloads"),
  });')"
echo "$state"
has() { node -e 'const s = JSON.parse(process.argv[1]); process.exit(eval(process.argv[2]) ? 0 : 1)' "$state" "$1" && echo 1 || echo 0; }
check "tabs, with app URLs in today's scheme" "$(has 's.urls.includes("arcadia://history") && s.urls.some((u) => u.startsWith("https://example.com"))')"
check "the pinned tab" "$(has 's.pinned.some((u) => u.startsWith("https://example.com"))')"
check "settings" "$(has 's.little === false && s.size[0] === 810')"
check "the custom shortcut" "$(has 'JSON.stringify(s.shortcut) === JSON.stringify(["cmd+opt+y"])')"
check "the bookmark (Chrome's profile)" "$(has 's.bookmark')"
cookie="$("$ac" page "$migrated" example.com 'document.cookie' 2>/dev/null || true)"
check "the site's cookie (Chrome's profile, decrypted with the carried key)" "$([[ "$cookie" == *migration=kept* ]] && echo 1 || echo 0)" "$cookie"
journal="$(cat "$migrated/.legacy-migration.json" 2>/dev/null || true)"
check "the migration's journal says done" "$([[ "$journal" == *'"phase":"done"'* && "$journal" == *'"outcome":"migrated"'* ]] && echo 1 || echo 0)" "$journal"
[ "$fail" = 0 ] && echo "all passed" || echo "FAILED (scratch: $scratch)"
exit "$fail"
