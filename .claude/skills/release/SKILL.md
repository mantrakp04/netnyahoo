---
name: release
description: Cut and ship a Netnyahoo release end to end — write the Dia-style release notes from git log, bump the version, build/sign/package with scripts/release.sh, smoke-test the build in a hidden instance, publish the GitHub release + Sparkle appcast, and deploy netnyahoo.com so the after-update release-notes tab has its entry. Use this whenever the user asks to ship, release, cut/push a new version or update, publish a build, "get this to me", bump the version, or write release notes for Netnyahoo — even if they only say "ship it" or "new release" after a batch of fixes.
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
if `MARKETING_VERSION` doesn't match or the notes file is missing. It ends with "NOT notarized." until the
user stores notarytool credentials; that's expected, say so in the report.

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
- the bundle's signature is still valid after running (0.1.0 wrote into its own bundle).

Everything must pass before publishing. One known exception: the two passkey window-order checks read
CGWindowList, which isn't reliable while the Mac's screen is locked (window animations freeze). smoke.sh
detects the lock (`CGSSessionScreenIsLocked`) and prints them as SKIP; publish when the release doesn't
touch window ordering, and say so in the report. Before 0.2.0 the builds had three such checks (the
ghost's order), so a pre-0.2.0 export isn't a control for these. A failure is either a real regression (fix it, commit, rebuild —
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
pnpm -C apps/site run deploy
```

Then verify live: `https://netnyahoo.com/release-notes/` contains the new headline, the home page links
`Netnyahoo-<version>.dmg`, and that URL returns 200. Commit `release.ts` ("Site: download <version>") and push.

Deploying makes things public. The user has asked for releases to go all the way through, so deploy as
part of a release; for site changes outside a release, ask first.

## 7. Report

Tell the user, briefly: the version and headline, what's in it (from the notes), the smoke result
(N/N), that it's live (release URL, appcast, site), how to get it (Check for Updates…), anything not
verified (real trackpad/mouse input, notarization), and what they need to try by hand.
