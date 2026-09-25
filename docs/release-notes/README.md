# Release notes

One Markdown file per version: `docs/release-notes/<version>.md`, where `<version>` is the app's
`MARKETING_VERSION` exactly (`0.1.4.md`). Write it before running `scripts/release.sh`, which refuses
to build without it. The same file ends up in three places:

- **The website**, `https://netnyahoo.com/release-notes#<version>` (`apps/site/src/pages/release-notes.astro`),
  newest first. The app opens that anchor in a new tab the first time it launches after an update, and from
  Help › Release Notes. The page only shows a version once the site is rebuilt and deployed.
- **The GitHub release**: `release.sh` writes `dist/<version>/release-notes.md` (the body, then the standard
  Install section and a link to the page) for `gh release create --notes-file`.
- **The update dialog**: `release.sh` embeds the headline and body in the appcast item, so Sparkle's
  "A new version is available" window shows them (it renders the Markdown).

## The file

```markdown
---
date: 2026-09-25
headline: Chrome makes no further unscheduled appearances.
---

## Fixed

- **⌘-scroll no longer zooms with a trackpad.** Resting a thumb on ⌘ while scrolling with two fingers
  zoomed the page. It scrolls now; pinch to zoom instead. With a wheel mouse or a Magic Mouse, ⌘-scroll
  still zooms.
```

Frontmatter, both required:

- `date`: the day the release is published, `YYYY-MM-DD`.
- `headline`: one line, the deadpan part (below).

Body:

- An intro paragraph before the first section is optional. Use it only for a big release (the first one,
  a redesign) and keep it to two or three plain sentences.
- Sections are `##` headings, only the ones the release needs, in this order: `## New`, `## Fixed`,
  `## Smaller`, `## Not yet`. When a release is mostly a fix for something broken, put `## Fixed` first
  (0.1.1 does).
  - **New**: things people can do now that they couldn't before.
  - **Fixed**: things that were broken and now work.
  - **Smaller**: polish and minor fixes, one line each, no bold lead.
  - **Not yet**: known gaps worth saying out loud (a big release only).
- Each item is one bullet: a **bold lead sentence** that states the change from the user's side, then at
  most three plain sentences: what people saw before, what happens now, where to find it or who it
  affects. Items in Smaller are a single sentence without bold.
- Nothing else: no images, no tables, no nested lists, no links unless the item is about a page. The site
  numbers the items and puts the section names in the margin.

## Voice

The notes are plain and useful. The wit goes in the headline only.

**Headline.** One sentence, 30 to 60 characters, ending with a full stop. It's about the release's most
noticeable change, told as if the incumbent's office were announcing it: elections, office, cabinet,
decrees, the press, "no plans to leave". Deadpan, never a pun on the change and never an exclamation mark.
The fact under the joke must be true.

- 0.1.0 "Sworn in on Chromium 154. No plans to leave." (first release)
- 0.1.1 "The ad blocker returns to work. Big Yahu goes into hiding." (ad blocking fixed; the offline game)
- 0.1.2 "Menus no longer bring down the government." (menu commands crashed the app)
- 0.1.3 "Autofill starts counting clicks again." (autofill suggestions ignored clicks)
- 0.1.4 "Chrome makes no further unscheduled appearances." (Chrome's bubbles over the page)

Keep the satire on politics as theatre (campaigns, incumbency, bureaucracy, press conferences). No
jokes about war, violence, religion or ethnicity, and none at the user's expense.

**Items.**

- Lead with what the user sees, not with what the code does: "Menu commands no longer crash the app", not
  "Fix selector in MenuTarget".
- Name the symptom people hit, so they recognise it: "every command in the menu bar crashed Netnyahoo",
  "sites like Google waited forever at 'Complete sign-in using your passkey'".
- One short "why" is welcome when it explains the fix in user terms ("The menu items pointed at the wrong
  method."). No file names, class names, commit hashes or internal flags.
- Name menus by their path (Netnyahoo › Check for Updates…, System Settings › Privacy & Security), shortcuts
  with symbols (⌘T, ⇧⌘T), settings by their label in quotes.
- Say which versions a regression affected when it matters ("In 0.1.0 and 0.1.1, …").
- "Like Dia" / "as in Dia" is fine where the feature copies Dia's behaviour.
- Don't write: "exciting", "we're thrilled", "various", "improvements", "bug fixes and performance
  improvements", "under the hood", emoji, exclamation marks.
- Straight quotes and apostrophes in the file are fine; the site curls them.

## From `git log` to a notes file

1. `git log --format='%h %s%n%b' v<previous>..HEAD`. The commit bodies explain the user-visible effect.
2. Keep commits that change what someone using the app sees or can do: `apps/browser`, `packages/*`, the
   engine (`packages/cef/patches`), `Info.plist`. Drop the site (`apps/site`), the launch video
   (`apps/launch-video`), docs, tests, refactors, and "Release x.y.z" version bumps.
3. Merge commits that are one change for the user into one item. Split a commit that fixes two visible
   things into two items.
4. Sort each section by how many people it affects; crashes and data loss first.
5. Pick the headline from the top item.
6. Check it renders: `pnpm -C apps/site build`, then `pnpm -C apps/site preview` and open
   `http://localhost:4321/release-notes#<version>`.
