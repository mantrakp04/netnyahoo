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
- Sections are `##` headings, only the ones the release needs, in this order: `## New`, `## Faster`,
  `## Fixed`, `## Smaller`, `## Not yet`. When a release is mostly a fix for something broken, put `## Fixed` first
  (0.1.1 does).
  - **New**: things people can do now that they couldn't before.
  - **Faster**: the measured old-against-new table (below), plus a bullet for any speed-up worth a sentence.
  - **Fixed**: things that were broken and now work.
  - **Smaller**: polish and minor fixes, one line each, no bold lead.
  - **Not yet**: known gaps worth saying out loud (a big release only).
- Each item is one bullet: a **bold lead sentence** that states the change from the user's side, then at
  most three plain sentences: what people saw before, what happens now, where to find it or who it
  affects. Items in Smaller are a single sentence without bold.
- `## Faster` carries one table, only when the release is measurably faster than the previous one: the rows that
  moved in the release's perf gate (columns old version, new version, change; plain-language row names), then one
  sentence on what moved most. The site renders it as a table that scrolls inside its own box on a phone; GitHub and
  Sparkle render it as Markdown.
- Nothing else: no images, no other tables, no nested lists, no links unless the item is about a page. The site
  numbers the items and puts the section names in the margin.

## Voice

The notes are plain and useful. The wit goes in the headline only.

**Headline.** One sentence, 30 to 60 characters, ending with a full stop. It's about the release's most
noticeable change, said flatly, as if nothing much had happened. Arcadia is Arc plus Dia, named after the
old pastoral idyll, and using it should feel like touching grass. So the wit is dry and calm. A light
open-country touch (a lamb, a field, a quiet week) is welcome where it fits; most headlines won't need one,
and none should be bent to make room for it. Deadpan, never a pun on the change, never an exclamation mark.
The fact under it must be true.

- 0.1.0 "The first build runs Chromium 154 and asks for no account." (first release)
- 0.1.1 "The ad blocker goes back to work while a lamb goes missing." (ad blocking fixed; the offline game)
- 0.1.2 "The menu bar can be used without consequences." (menu commands crashed the app)
- 0.1.3 "Autofill starts counting clicks again." (autofill suggestions ignored clicks)
- 0.1.4 "Chrome makes no further unscheduled appearances." (Chrome's bubbles over the page)
- 0.2.9 "Nothing you can see has changed, on purpose." (tidied source, the same app)
- 0.2.19 "Arcadia now does less while you do nothing." (less battery while idle)

Keep headlines short, calm and dry, with one outdoor phrase at most. No politics, and no jokes at the
user's expense.

**Items.**

- Lead with what the user sees, not with what the code does: "Menu commands no longer crash the app", not
  "Fix selector in MenuTarget".
- Name the symptom people hit, so they recognise it: "every command in the menu bar crashed Arcadia",
  "sites like Google waited forever at 'Complete sign-in using your passkey'".
- One short "why" is welcome when it explains the fix in user terms ("The menu items pointed at the wrong
  method."). No file names, class names, commit hashes or internal flags.
- Name menus by their path (Arcadia › Check for Updates…, System Settings › Privacy & Security), shortcuts
  with symbols (⌘T, ⇧⌘T), settings by their label in quotes.
- Say which versions a regression affected when it matters ("In 0.1.0 and 0.1.1, …").
- "Like Dia" / "as in Dia" is fine where the feature copies Dia's behaviour.
- Don't write: "exciting", "we're thrilled", "various", "improvements", "bug fixes and performance
  improvements", "under the hood", emoji, exclamation marks.
- Straight quotes and apostrophes in the file are fine; the site curls them.

## From `git log` to a notes file

1. `git log --format='%h %s%n%b' v<previous>..HEAD`. The commit bodies explain the user-visible effect.
2. Keep commits that change what someone using the app sees or can do: `apps/browser`, `packages/*`, the
   engine (`packages/cef/patches`), `Info.plist`. Drop the site (`apps/site`), the videos
   (`apps/videos`), docs, tests, refactors, and "Release x.y.z" version bumps.
3. Merge commits that are one change for the user into one item. Split a commit that fixes two visible
   things into two items.
4. Sort each section by how many people it affects; crashes and data loss first.
5. Pick the headline from the top item.
6. Check it renders: `pnpm -C apps/site build`, then `pnpm -C apps/site preview` and open
   `http://localhost:4321/release-notes#<version>`.
