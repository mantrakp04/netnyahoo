---
name: release
description: Cut and ship a Arcadia release end to end — write the Dia-style release notes from git log, bump the version, build/sign/package with scripts/release.sh, smoke-test the build in a hidden instance, publish the GitHub release + Sparkle appcast, and deploy netnyahoo.com with the release-notes entry, the new download link and the landing page's claims and screenshots brought up to date. Use this whenever the user asks to ship, release, cut/push a new version or update, publish a build, "get this to me", bump the version, or write release notes for Arcadia — even if they only say "ship it" or "new release" after a batch of fixes.
---

# Releasing Arcadia

A release is: notes → version bump → `scripts/release.sh` → smoke test → GitHub release → site deploy.
Users get it through Sparkle (Arcadia › Check for Updates…), and the first launch of the new version
opens `https://netnyahoo.com/release-notes#<version>`. So the release isn't done until the site is
deployed with the new entry — otherwise that tab opens on a page that doesn't mention the update.

`docs/releasing.md` is the reference for the machinery (keys, notarization, what release.sh checks);
`docs/release-notes/README.md` is the notes style guide. Read the style guide before writing notes.

## Ground rules (why they exist)

- **Never touch the Chromium build cache.** release.sh only reads the engine framework from
  `~/chromium-build/chromium_git/chromium/src/out/Release_GN_arm64` (and refuses one older than the tree's ArcadiaCore
  sources: rebuilding it is an incremental `chrome_framework` build under the chromium lock). Never delete or clean
  `~/chromium-build/chromium_git/chromium/src/out`, run `gclient sync` or `gn clean`: a full Chromium
  rebuild costs ~5 hours and the user has been emphatic about it.
- **Never launch or touch `/Applications/Arcadia.app`** — the user is using it. Test only the exported
  build in `dist/`, only hidden (`ARCADIA_BACKGROUND=1`, throwaway `ARCADIA_DATA_DIR`), never with
  plain `open`. The smoke script does this for you.
- **Build from a clean tree.** release.sh archives the working tree, so another agent's half-finished
  edit would ship. Check `git status` first (below).
- **Commits** go to `main` with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 1. Check the tree

```bash
git status --short
git log --oneline v<previous>..HEAD
```

Anything modified or untracked under `apps/browser`, `packages/` or `apps/browser/macos` that isn't
committed would end up in the build. If it belongs to a running agent, wait for it or ask; don't commit
someone else's work in progress. Untracked files under `apps/videos`, `apps/site` or `output/` don't
affect the app.

`<previous>` is the last tag (`git describe --tags --abbrev=0`). The next version bumps the patch
(0.1.5 → 0.1.6) unless the user says otherwise.

## 2. Write the notes

Create `docs/release-notes/<version>.md` following `docs/release-notes/README.md`: frontmatter `date`
(today, `YYYY-MM-DD`) and `headline` (30–60 chars, the only witty line: the incumbent's office announcing
the most noticeable change — deadpan, true, political theatre only), then `## New` / `## Faster` (the
perf-gate table, step 4c) / `## Fixed` / `## Smaller` bullets written from the user's side.

Source material: `git log --format='%h %s%n%b' v<previous>..HEAD -- apps/browser packages`. The commit
bodies already describe the user-visible symptom; translate them, don't paste them. Leave out the site,
the videos, docs and version bumps. Each bold lead says what the user can do or what stopped being
broken; no file names, flags or commit hashes.

Check it renders: `pnpm -C apps/site build` and grep the headline in
`apps/site/dist/release-notes/index.html` (or preview it on port 4321, the "site" launch config).

## 3. Bump and build

First bring the block lists up to date. uBlock Origin Lite is bundled as a component extension, which
never updates itself, so its lists are only as fresh as the last release that moved the pin (Dia refreshes
its lists from its server; this is our equivalent, once per release):

```bash
scripts/update-ubol.sh     # "uBOL <x> is the latest release", or "uBOL <old> -> <new> (sha256 …)"
git add packages/arcadiacore/scripts/ubol.sh && git commit -m "Block lists: uBlock Origin Lite <new>"   # only if it moved
```

It checks the zip against GitHub's SHA-256 digest and the manifest's version, rewrites the pin in
`packages/arcadiacore/scripts/ubol.sh` and installs it into `packages/arcadiacore/vendor/ubol`. Verify after release.sh
that the export carries it: `python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])'
dist/<version>/export/Arcadia.app/Contents/Resources/Extensions/ublock-lite/manifest.json` prints the
pinned `UBOL_VERSION`, and the smoke test's "uBlock blocks an ad script" check passes. An error means
the release is odd (no digest, a version mismatch): keep the old pin and say so in the report.

```bash
sed -i '' 's/MARKETING_VERSION = <previous>;/MARKETING_VERSION = <version>;/; s/CURRENT_PROJECT_VERSION = <n>;/CURRENT_PROJECT_VERSION = <n+1>;/' \
  apps/browser/macos/Arcadia.xcodeproj/project.pbxproj
git add docs/release-notes/<version>.md apps/browser/macos/Arcadia.xcodeproj/project.pbxproj
git commit -m "Release <version>"
scripts/release.sh <version>     # ~15–25 min with notarization; run it in the background and wait
```

`CURRENT_PROJECT_VERSION` is the build number Sparkle compares — it must go up every release (read the
current value with `grep CURRENT_PROJECT_VERSION …project.pbxproj | sort -u`). release.sh refuses to run
if `MARKETING_VERSION` doesn't match, the notes file is missing, the tree has uncommitted app or engine
changes, or the engine framework is stale (`docs/releasing.md` lists what it checks). It notarizes the app and the DMG with the
`arcadia` notarytool profile (an App Store Connect API key in the login keychain, set up 2026-09-26) and
ends with "Notarized and stapled." If it says "NOT notarized.", the profile is gone or invalid
(`xcrun notarytool history --keychain-profile arcadia` shows why): stop and tell the user rather than
shipping an unnotarized build. Never store or re-create the credential yourself; that's the user's step.
Notarization adds a few minutes per submission.

## 4. Smoke test the build

```bash
.claude/skills/release/scripts/smoke.sh <version> <previous>     # --rc for dist/<version>-rc
```

First it checks the update from `<previous>` (its export in `dist/<previous>/export`):

- the engine is ArcadiaCore (Chrome's framework, no CEF);
- the identity Sparkle, the keychain and TCC compare: same bundle id, executable, feed and EdDSA key, the build
  satisfies `<previous>`'s designated requirement, and its build number is higher;
- the appcast's EdDSA signature of the zip verifies with the app's key, and the zip holds this very app, sealed and
  stapled; Gatekeeper accepts the app and the DMG as notarized;
- `update-test.sh`: `<previous>`'s own Sparkle updates a scratch copy of it to this build, through a local feed made of
  the appcast's item (test bundle id and key; no relaunch, no UI);
- `carryover.sh`: `<previous>`'s data, made where an installed copy keeps it (two profiles: tabs, cookies including
  session ones, localStorage, passwords, bookmarks, history, an address, a site permission, zoom, an extension),
  opens in this build started without `ARCADIA_DATA_DIR` (test copies in a fake home; never the real data).

Then it launches `dist/<version>/export/Arcadia.app` hidden with a data dir that says `<previous>` ran last,
and a session whose window was left on its second profile, and checks, over CDP and the window list:

- engine is Chromium 154, the after-update release-notes tab opened exactly once;
- the browser's child processes are the bundle's own helpers (Chrome's process checks pass under Developer ID);
- pages load, uBlock blocks an ad script, H.264/AAC/WebGL2;
- no hidden full-size Chrome window (since 0.2.0 the app window is Chrome's own; before, a hidden "ghost"
  sat behind it), and the window restores as the Work profile's Chrome window, alone on screen, its pages
  in the Work context;
- a passkey dialog comes in front, directly over the visible window it belongs to, and closes when the
  page navigates (the 0.1.2–0.1.4 regressions);
- the autofill dropdown accepts a suggestion (0.1.3), the offline page is Where's the lamb?, chrome://version;
- right-click shows the native context menu (0.1.5);
- with Chrome's last-used profile left at Work (as quitting with Work's window in front does), Personal's pages
  still run in Personal's profile (0.2.19 and earlier ran them in Work's);
- a page that stops responding is reported (Chrome's hang monitor reaches the app; 0.2.20 attached a DevTools client to
  every tab it showed, and Chrome ignores hangs while one is attached);
- quitting the way ⌘Q and Sparkle's update do (the quit Apple event, sent to this instance's pid only) exits
  within 15 s with status 0 and no crash report (0.2.6 and 0.2.7 crashed on every quit, so every update
  ended in "Arcadia quit unexpectedly");
- the bundle's signature is still valid after running (0.1.0 wrote into its own bundle);
- the feed in the build's Info.plist (`SUFeedURL`, `https://netnyahoo.com/appcast.xml` in builds after 0.2.13) answers
  with an appcast (`scripts/feed.sh --before-publish`). A 404 means netnyahoo.com is running a deploy without
  the feed endpoint (`infra/site/nginx.conf`): deploy the site first, or copies of this build never update.

Everything must pass before publishing. One known exception: the two passkey window-order checks read
CGWindowList, which isn't reliable while the Mac's screen is locked (window animations freeze). smoke.sh
detects the lock (`CGSSessionScreenIsLocked`) and prints them as SKIP; publish when the release doesn't
touch window ordering, and say so in the report. Before 0.2.0 the builds had three such checks (the
ghost's order), so a pre-0.2.0 export isn't a control for these. The window-list checks also fail, with an empty or
shrunken list, when the user switches Spaces or opens Mission Control during the run (the hidden instance's
windows leave the on-screen list): run it again. A failure is either a real regression (fix it, commit, rebuild —
don't publish) or the check itself going stale after an intended change (fix the check in
`scripts/smoke.mjs`, and say so). When a release fixes a new class of bug that can be observed over CDP or
the window list, add a check for it to `smoke.mjs` so the next release guards it.

### 4b. Perf ratchet

Check the candidate's counts against the ceilings before publishing (about two minutes, no perflab lock needed: they
are counts, not timings):

```bash
node apps/browser/scripts/perf/ratchet.mjs run --own --app dist/<version>-rc/export/Arcadia.app   # dist/<version>/export without an rc
```

`--own` runs the app's own `main.jsbundle`, so it checks what ships. It must print `ratchet: ok`. It runs the launch,
idle, command bar, tab switch, navigate, scroll and hover scenarios in a hidden instance, and a count over its ceiling
gets one more run (a stray window event isn't a regression; a count over in both is). A failure is a real regression
(find the commit that added the commit, render, store update or timer, and fix it) or an intended increase: raise that
one ceiling by hand in `apps/browser/scripts/perf/ratchet.json` and say why in the commit and the release report. When
the release made counts go down, run `ratchet.mjs lower <the run's report>` (`$TMPDIR/ac-ratchet/ratchet.json`), commit
the lowered ceilings, and say which counts dropped. The wall-clock gate is a separate step: `docs/perf/README.md`.

### 4c. Perf gate: the RC against the previous release

Every release is timed against the previous one before it publishes, and ships only when every row is the same or
better (`docs/perf/README.md` › Gating a release: native-bench with `--control dist/<previous>/export/Arcadia.app`,
interleaved, launch x6+ and session x2, then js-bench alternating the two apps). It runs alone on a quiet Mac, holding
the perflab lock, after the smoke test and the ratchet. Call a row a regression only when the ranges separate.
Afterwards read `scripts/agent/cpu-cap`'s log (`cpu-cap.log`): a pause of the bench or its instances during the run
invalidates it, so rerun. Put the numbers in `docs/perf/<previous>-to-<version>.md`.

The notes get a `## Faster` section only when the release is measurably faster: a short table of the rows that
moved (old, new, change) and one sentence naming the biggest win. A release that's the same within noise has no
Faster section. The 0.2.17 comparison (`scripts/release-compare-0.2.17.sh`) was for 0.2.28 and 0.2.29; run it only
when the owner asks.

## 5. Publish

```bash
git tag v<version> && git push origin main v<version>
gh release create v<version> -R mantrakp04/arcadia --title "Arcadia <version>" \
  --notes-file dist/<version>/release-notes.md \
  dist/<version>/Arcadia-<version>.dmg dist/<version>/Arcadia-<version>.zip dist/<version>/appcast.xml \
  $(ls dist/<version>/ArcadiaCore-*.tar.xz 2>/dev/null)
curl -fsL https://github.com/mantrakp04/arcadia/releases/latest/download/appcast.xml | grep -o 'shortVersionString>[0-9.]*' | head -1
.claude/skills/release/scripts/feed.sh <version>
```

When engine/ changed since the last prebuilt engine, release.sh also packed `ArcadiaCore-<tree>.tar.xz` (the command
above uploads it) and wrote its table line. Once the release is up, commit that line, so builds without a Chromium tree
find it (`packages/arcadiacore/scripts/fetch-engine.sh`):

```bash
if [ -f dist/<version>/prebuilt-engine.tsv ]; then
  cat dist/<version>/prebuilt-engine.tsv >> packages/arcadiacore/prebuilt-engines.tsv
  git add packages/arcadiacore/prebuilt-engines.tsv && git commit -m "Prebuilt engine: <version>'s" && git push origin main
fi
```

Both must show the new version. Copies from 0.2.13 and earlier poll GitHub's URL directly; newer ones poll
netnyahoo.com/appcast.xml, which counts the check (version, day, first check or not) and redirects to the
same GitHub file. feed.sh reads the URL from the built Info.plist, so it checks what this build will poll.

### 5b. Staged rollout (an ArcadiaCore-sized or risky release)

Three steps, in this order. Nothing here publishes by itself; each needs the owner's go-ahead (the first is the standing
rule that a release which changes the engine or something users would notice publishes only after the owner has tested
the final RC and said ship).

1. **The owner tests the RC first.** Build `scripts/release.sh <version> --rc`, hand it over, and wait for "ship". Not
   for a JS-only fix that passed the smoke test.
2. **Phased appcast.** Build the release with `scripts/release.sh <version> --phased 86400`. The new appcast item then
   carries `<sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>` (check with
   `grep -c phasedRolloutInterval dist/<version>/appcast.xml`, which must print 1): Sparkle gives each copy a random
   group on that Mac (no ID, nothing sent) and offers the update to the first seventh of copies at once, a seventh more
   every interval, so everyone has it after a week. Someone who clicks Check for Updates… gets it at once. Publish as in
   step 5 and watch a day or two: `crash.log`, new PostHog `$exception`s, `update_check` counts by version
   (`docs/growth.md`). A problem found: flip the release's kill switch (`docs/kill-switches.md`) if it has one, and
   publish a fixed build with a higher build number: copies that haven't updated yet go straight to it.
3. **Everyone.** Remove the interval from the published appcast, so every copy sees the update:
   ```bash
   gh release download v<version> -R mantrakp04/arcadia -p appcast.xml -D /tmp/ac-appcast --clobber
   sed -i '' '/<sparkle:phasedRolloutInterval>/d' /tmp/ac-appcast/appcast.xml
   gh release upload v<version> -R mantrakp04/arcadia /tmp/ac-appcast/appcast.xml --clobber
   .claude/skills/release/scripts/feed.sh <version>
   ```
   (The appcast isn't signed as a whole, only its zip's `edSignature`, so editing the line keeps it valid.) The next
   release's `release.sh` starts from this published appcast, so it doesn't bring the interval back.

A release without `--phased` goes to everyone at once, as before.

## 6. Deploy the site

The download button builds its URL from `VERSION` (`releases/latest/download/Arcadia-<VERSION>.dmg`),
so it 404s the moment a newer release is published until this is bumped:

```bash
size=$(gh release view v<version> -R mantrakp04/arcadia --json assets -q '.assets[] | select(.name|endswith(".dmg")) | .size' | awk '{printf "%.0f MB", $1/1000000}')
# set VERSION = "<version>" and DMG_SIZE = "$size" in apps/site/src/data/release.ts
```

**Bring the landing page's claims up to date.** The home page makes specific promises; a release can make
one of them stale or earn a new one. Read the new notes against:
- `apps/site/src/data/pledges.ts`: the pledges with screenshots, and "Also passed" (one line each);
- `apps/site/src/components/Record.astro`: the ballot of what's in and what isn't yet;
- `Press.astro` (Q&A), `Hero.astro` and `Closing.astro` (the fine print: macOS version, Apple Silicon,
  Notarized), and `Footer.astro`.

Then:
- **Something the page says "not yet" or "partly" to is now done:** flip the ballot row.
- **Something the page claims changed** (a new import source, a new requirement): fix the line.
- **A headline feature isn't on the page:** add an "Also passed" line in the page's voice. It should be
  short, dry, political theatre, and literally true. The pledge count updates itself.
- **Bug fixes and small changes:** leave the page alone.
- **Never claim anything the release doesn't do.** Anything unverified or behind a setting says so.

**Bring the landing page's pictures up to date too.** Every screenshot on the site claims "a screenshot,
not a mockup", so it has to look like the app people download today. Here is what shows which part of the
app (listed in `apps/site/README.md` › Screenshots):

| Asset | Shows |
|---|---|
| `src/assets/shots/office.webp` | the whole window: sidebar, pinned tiles, tabs, a page ("Fig. 2 — In office") |
| `shots/address-{toolbar,sidebar}.webp` | the address bar pledge's before and after |
| `shots/profile-*.webp` | the profiles pledge, one window per profile |
| `shots/split.webp`, `extensions.webp`, `privacy.webp` | split view, the Web Store, Settings › Privacy & Security |
| `src/assets/app-icon.png` | the header, the favicon source |
| `src/assets/game/crowd.webp` | the offline game; its hotspot is in `Game.astro` |
| `public/og.png` | the share card |

- **When:** if the release visibly changes something a shot shows (the sidebar, the tiles, the New Tab page,
  the logo or mark, the icon, a Settings pane, the window chrome), retake the affected shots from **this
  release's export** (`dist/<version>/export/Arcadia.app`). A new page or feature that earned a pledge
  may also need a new shot.
- **How:** use a hidden instance with the smoke test's rules (`ARCADIA_BACKGROUND=1`, a throwaway
  `ARCADIA_DATA_DIR`, never plain `open`, never `/Applications`).
  - Set up the same state as the old shot (the same sites, profiles, light or dark).
  - Take a real window capture at 2× with a transparent outside: `screencapture -l <windowID> -o`.
- **Screen locked:** WindowServer captures fail. Leave the old shot, and tell the user which shots are stale.
  An in-process snapshot is not a substitute: it drops glass and Metal views.
- **Replace in place:** save the new capture over the file with the same name, since Astro makes the sizes.
  Update the shot's `alt` text if what it shows changed, and check its phone crop (`focus` in `data/pledges.ts`).
- **Don't touch the rest:** leave the painted logo (`arcadia-mark.png`, from `docs/brand/arcadia`) alone unless
  the brand changed.

Keep to the site's bar: few words, witty over wordy (see the existing lines). Build with `pnpm -C apps/site build`
and check the changed sections and shots render, on a phone width too (the "site" launch config, port 4321).

```bash
pnpm -C apps/site run deploy   # the upload can drop on a weak connection: rerun it until it succeeds
```

Then verify live: `https://netnyahoo.com/release-notes/` contains the new headline, the home page links
`Arcadia-<version>.dmg`, that URL returns 200, and any claim you changed shows. Commit `release.ts`
and the claim changes ("Site: download <version>", plus what changed) and push.

The SEO data follows `release.ts` and the notes by itself; check that it did:
- The home page's JSON-LD `softwareVersion` is the new version.
- `https://netnyahoo.com/sitemap.xml` has today's `lastmod`.
- If the release changed what Arcadia is (a new headline feature, a new platform), update the home page's
  `description` in `src/pages/index.astro`: ~150 characters, and it is also the share text.
- If `og.png` changes, its URL's `?v=` hash changes with it, so X and others fetch the new card.

Deploying makes things public. The user has asked for releases to go all the way through, so deploy as
part of a release; for site changes outside a release, ask first.

## 7. Tweet draft

Draft the announcement for the owner to post (never post it yourself): `Arcadia <version>`, 4–5 short,
witty, simple bullets from the notes, then netnyahoo.com, under 280
characters. Make `output/tweets/<version>.png` (1600×1000, the site's paper background and fonts) from
real captures of a hidden instance on neutral pages you control; see `output/tweets/0.2.12.png`. Send both
to the owner.

## 8. Report

Tell the user, briefly: the version and headline, what's in it (from the notes), any landing-page claims changed, the smoke result
(N/N), that it's live (release URL, appcast, site), how to get it (Check for Updates…), anything not
verified (real trackpad/mouse input, notarization), and what they need to try by hand.
