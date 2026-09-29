---
name: release
description: Cut and ship a Netnyahoo release end to end — write the Dia-style release notes from git log, bump the version, build/sign/package with scripts/release.sh, smoke-test the build in a hidden instance, publish the GitHub release + Sparkle appcast, and deploy netnyahoo.com with the release-notes entry, the new download link and the landing page's claims and screenshots brought up to date. Use this whenever the user asks to ship, release, cut/push a new version or update, publish a build, "get this to me", bump the version, or write release notes for Netnyahoo — even if they only say "ship it" or "new release" after a batch of fixes.
---

# Releasing Netnyahoo

A release is: notes → version bump → `scripts/release.sh` → smoke test → GitHub release → site deploy.
Users get it through Sparkle (Netnyahoo › Check for Updates…), and the first launch of the new version
opens `https://netnyahoo.com/release-notes#<version>`. So the release isn't done until the site is
deployed with the new entry — otherwise that tab opens on a page that doesn't mention the update.

`docs/releasing.md` is the reference for the machinery (keys, notarization, what release.sh checks);
`docs/release-notes/README.md` is the notes style guide. Read the style guide before writing notes.

## Ground rules (why they exist)

- **Never touch the Chromium build cache.** Nothing here needs `~/chromium-build` except `setup.sh`,
  which release.sh runs and which only copies the finished distribution. Never delete or clean
  `~/chromium-build/chromium_git/chromium/src/out`, run `gclient sync` or `gn clean`: a full Chromium
  rebuild costs ~5 hours and the user has been emphatic about it.
- **Never launch or touch `/Applications/Netnyahoo.app`** — the user is using it. Test only the exported
  build in `dist/`, only hidden (`NETNYAHOO_BACKGROUND=1`, throwaway `NETNYAHOO_DATA_DIR`), never with
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
someone else's work in progress. Untracked files under `apps/launch-video`, `apps/site` or `output/` don't
affect the app.

`<previous>` is the last tag (`git describe --tags --abbrev=0`). The next version bumps the patch
(0.1.5 → 0.1.6) unless the user says otherwise.

## 2. Write the notes

Create `docs/release-notes/<version>.md` following `docs/release-notes/README.md`: frontmatter `date`
(today, `YYYY-MM-DD`) and `headline` (30–60 chars, the only witty line: the incumbent's office announcing
the most noticeable change — deadpan, true, political theatre only), then `## New` / `## Fixed` /
`## Smaller` bullets written from the user's side.

Source material: `git log --format='%h %s%n%b' v<previous>..HEAD -- apps/browser packages`. The commit
bodies already describe the user-visible symptom; translate them, don't paste them. Leave out the site,
the launch video, docs and version bumps. Each bold lead says what the user can do or what stopped being
broken; no file names, flags or commit hashes.

Check it renders: `pnpm -C apps/site build` and grep the headline in
`apps/site/dist/release-notes/index.html` (or preview it on port 4321, the "site" launch config).

## 3. Bump and build

First bring the block lists up to date. uBlock Origin Lite is bundled as a component extension, which
never updates itself, so its lists are only as fresh as the last release that moved the pin (Dia refreshes
its lists from its server; this is our equivalent, once per release):

```bash
scripts/update-ubol.sh     # "uBOL <x> is the latest release", or "uBOL <old> -> <new> (sha256 …)"
git add packages/cef/scripts/ubol.sh && git commit -m "Block lists: uBlock Origin Lite <new>"   # only if it moved
```

It checks the zip against GitHub's SHA-256 digest and the manifest's version, rewrites the pin in
`packages/cef/scripts/ubol.sh` and installs it into `packages/cef/vendor/ubol`. Verify after release.sh
that the export carries it: `python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])'
dist/<version>/export/Netnyahoo.app/Contents/Resources/Extensions/ublock-lite/manifest.json` prints the
pinned `UBOL_VERSION`, and the smoke test's "uBlock blocks an ad script" check passes. An error means
the release is odd (no digest, a version mismatch): keep the old pin and say so in the report.

```bash
sed -i '' 's/MARKETING_VERSION = <previous>;/MARKETING_VERSION = <version>;/; s/CURRENT_PROJECT_VERSION = <n>;/CURRENT_PROJECT_VERSION = <n+1>;/' \
  apps/browser/macos/Netnyahoo.xcodeproj/project.pbxproj
git add docs/release-notes/<version>.md apps/browser/macos/Netnyahoo.xcodeproj/project.pbxproj
git commit -m "Release <version>"
scripts/release.sh <version>     # ~5–10 min; run it in the background and wait
# "resources-to-copy-…txt: No such file" in the archive log means another build shared the Pods dir at
# the same moment (each build writes and deletes that file): make sure no other xcodebuild runs, retry.
```

`CURRENT_PROJECT_VERSION` is the build number Sparkle compares — it must go up every release (read the
current value with `grep CURRENT_PROJECT_VERSION …project.pbxproj | sort -u`). release.sh refuses to run
if `MARKETING_VERSION` doesn't match or the notes file is missing. It notarizes the app and the DMG with the
`netnyahoo` notarytool profile (an App Store Connect API key in the login keychain, set up 2026-09-26) and
ends with "Notarized and stapled." If it says "NOT notarized.", the profile is gone or invalid
(`xcrun notarytool history --keychain-profile netnyahoo` shows why): stop and tell the user rather than
shipping an unnotarized build. Never store or re-create the credential yourself; that's the user's step.
Notarization adds a few minutes per submission.

## 4. Smoke test the build

```bash
.claude/skills/release/scripts/smoke.sh <version> <previous>
```

It launches `dist/<version>/export/Netnyahoo.app` hidden with a data dir that says `<previous>` ran last,
and a session whose window was left on its second profile, and checks, over CDP and the window list:

- engine is Chromium 154, the after-update release-notes tab opened exactly once;
- pages load, uBlock blocks an ad script, H.264/AAC/WebGL2;
- no hidden full-size Chrome window (since 0.2.0 the app window is Chrome's own; before, a hidden "ghost"
  sat behind it), and the window restores as the Work profile's Chrome window, alone on screen, its pages
  in the Work context;
- a passkey dialog comes in front, directly over the visible window it belongs to, and closes when the
  page navigates (the 0.1.2–0.1.4 regressions);
- the autofill dropdown accepts a suggestion (0.1.3), the offline page is Where's Big Yahu?, chrome://version;
- right-click shows the native context menu (0.1.5);
- quitting the way ⌘Q and Sparkle's update do (the quit Apple event, sent to this instance's pid only) exits
  within 15 s with status 0 and no crash report (0.2.6 and 0.2.7 crashed on every quit, so every update
  ended in "Netnyahoo quit unexpectedly");
- the bundle's signature is still valid after running (0.1.0 wrote into its own bundle).

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

## 5. Publish

```bash
git tag v<version> && git push origin main v<version>
gh release create v<version> -R mantrakp04/netnyahoo --title "Netnyahoo <version>" \
  --notes-file dist/<version>/release-notes.md \
  dist/<version>/Netnyahoo-<version>.dmg dist/<version>/Netnyahoo-<version>.zip dist/<version>/appcast.xml
curl -fsL https://github.com/mantrakp04/netnyahoo/releases/latest/download/appcast.xml | grep -o 'shortVersionString>[0-9.]*' | head -1
```

The appcast check must print the new version: that's what every installed copy polls.

## 6. Deploy the site

The download button builds its URL from `VERSION` (`releases/latest/download/Netnyahoo-<VERSION>.dmg`),
so it 404s the moment a newer release is published until this is bumped:

```bash
size=$(gh release view v<version> -R mantrakp04/netnyahoo --json assets -q '.assets[] | select(.name|endswith(".dmg")) | .size' | awk '{printf "%.0f MB", $1/1000000}')
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
  release's export** (`dist/<version>/export/Netnyahoo.app`). A new page or feature that earned a pledge
  may also need a new shot.
- **How:** use a hidden instance with the smoke test's rules (`NETNYAHOO_BACKGROUND=1`, a throwaway
  `NETNYAHOO_DATA_DIR`, never plain `open`, never `/Applications`).
  - Set up the same state as the old shot (the same sites, profiles, light or dark).
  - Take a real window capture at 2× with a transparent outside: `screencapture -l <windowID> -o`.
- **Screen locked:** WindowServer captures fail. Leave the old shot, and tell the user which shots are stale.
  An in-process snapshot is not a substitute: it drops glass and Metal views.
- **Replace in place:** save the new capture over the file with the same name, since Astro makes the sizes.
  Update the shot's `alt` text if what it shows changed, and check its phone crop (`focus` in `data/pledges.ts`).
- **Don't touch the rest:** leave the mascot poster (`yahu-poster.webp`) and the 3D model alone unless the
  brand changed.

Keep to the site's bar: few words, witty over wordy (see the existing lines). Build with `pnpm -C apps/site build`
and check the changed sections and shots render, on a phone width too (the "site" launch config, port 4321).

```bash
pnpm -C apps/site run deploy   # the upload can drop on a weak connection: rerun it until it succeeds
```

Then verify live: `https://netnyahoo.com/release-notes/` contains the new headline, the home page links
`Netnyahoo-<version>.dmg`, that URL returns 200, and any claim you changed shows. Commit `release.ts`
and the claim changes ("Site: download <version>", plus what changed) and push.

Deploying makes things public. The user has asked for releases to go all the way through, so deploy as
part of a release; for site changes outside a release, ask first.

## 7. Report

Tell the user, briefly: the version and headline, what's in it (from the notes), any landing-page claims changed, the smoke result
(N/N), that it's live (release URL, appcast, site), how to get it (Check for Updates…), anything not
verified (real trackpad/mouse input, notarization), and what they need to try by hand.
