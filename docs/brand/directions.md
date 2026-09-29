# Brand directions (phase 1)

Three identities for Netnyahoo that keep Dia's UX, layout and quality bar and change only what reads as Dia
(see `inventory.md`). Each board is a 16:9 mock built on real captures of the app (`apps/site/src/assets/shots`):
the sidebar favicons, the split view in the second window and the Wikipedia page are pixels from those captures,
and the Big Yahu images are renders of `apps/site/public/models/big-yahu.glb`. The window geometry is Dia's, as
the app draws it (sidebar 190, tiles 55×41, rows 34 on a 37 pitch, card inset 6 / radius 10, bar 652×112 r20).

| Board | File |
|---|---|
| A — Incumbent | `boards/a-incumbent.png` (3840×2160) |
| B — Sealed | `boards/b-sealed.png` (1920×1080) |
| C — On Air | `boards/c-on-air.png` (3840×2160) |

All three drop the AI composer wording on the New Tab bar ("Ask anything…", "+ Add tabs or files", the send
button): the bar keeps Dia's size and rows, with the search engine as the chip and a Go pill.

## A — Incumbent (the site's campaign poster)

- **Idea.** The campaign never ends. Dia's calm chrome printed on paper stock in ink; the poster voice of
  netnyahoo.com is kept for the moments that are ours (New Tab, onboarding, error pages).
- **Palette.** Tie `#2150D9`, Stamp `#C3371F`, Sash `#E7B43B`; Paper `#F1ECE2`, Stock `#E6DFD1`, Ink `#16130F`,
  Ink 2 `#57524A`. Dark: Tie `#5B83F2`, Stamp `#E0583E`, Sash `#F0C24F` on Night `#15120F` / `#221E1A` with
  paper ink `#EFE8DC`.
- **Type.** Archivo at 62% width, 860, caps for display; Martian Mono for labels; Newsreader for long text;
  SF Pro stays in the chrome at Dia's sizes.
- **Icon.** A campaign rosette: a tie-blue button with a condensed N and a slogan ring, two ribbon tails, on
  a paper plate.
- **New Tab.** The button replaces Dia's dome; a mono fine-print line under the bar ("Term 0.2.8 · Day 412 in
  office · Paid for by nobody"). Intro "Print run": ink rises in halftone, the button lands like a stamp and
  leaves an ink ring that fades.
- **Tint.** Profiles become paper stocks and inks (Paper, Tie, Stamp, Sash…); warm night instead of #121212.
- **Moments.** Offline: "No mandate." with a Recount button and a rubber stamp. Onboarding: "Impeach
  Chrome." with a ballot. Release notes as a press release.

## B — Sealed (quiet, premium)

- **Idea.** The expensive side of power: stationery, wax, a private office. Navy ink on laid paper instead of
  painted light; the joke is dry (sealed, privileged, not for the court).
- **Palette.** Cabinet navy `#1E2C52`, Sealing wax `#8C2B30`, Brass `#B38B4D`; Laid `#F6F2EA`, Vellum
  `#E9E3D6`, Navy ink `#1A2138`, Graphite `#3A3B40`. Dark: `#93A6DB`, `#C4575D`, `#D4B071` on Night `#0E1320` /
  `#171D2D`.
- **Type.** Newsreader (italic for display); SF Pro for UI; tracked caps for labels. Text in navy ink, not
  black.
- **Icon.** A navy folio with a gilt rule and an oxblood wax seal.
- **New Tab.** The seal as the mark, laid lines on the page, one italic line under the bar. Intro "Sealing": a
  drop of wax lands, spreads, is pressed; a brass hairline traces the bar.
- **Moments.** Offline: "This page is sealed." (released when the connection returns, or in thirty years).
  Release notes as a memorandum.

## C — On Air (bold, mascot-forward)

- **Idea.** The permanent press conference. Big Yahu hosts; broadcast graphics (key lights, lower thirds, a
  LIVE bug) for the loud moments; the sidebar stays Dia-quiet.
- **Palette.** Studio blue `#1638E6`, Chyron `#FFD60A`, On air `#F2352B`; Studio `#0B0C10`, Monitor
  `#1A1C23`, Grey `#8B8F9C`, Prompter `#F4F4F0`. Dark is the default.
- **Type.** Archivo at 125% width, 900 italic caps for chyrons; Martian Mono for timecodes; SF Pro for UI.
- **Icon.** Big Yahu under a key light on studio blue, with a yellow LIVE lower third.
- **New Tab.** Big Yahu peeks over the bar like a lectern; a lower third under it ("Press conference · No
  questions will be taken."). Intro "Cut to live": lights up, he pops up, flashes, lower third slides in.
- **Moments.** Offline: "We'll be right back." test card. Onboarding: "Call the election." with the victory
  dance and a "Chrome concedes" ticker.

## What stays exactly like Dia (all three)

Layout and geometry, the sidebar, tab and tile shapes, the command bar's size and position, the window
translucency pipeline, motion timings, and SF Pro at Dia's sizes in the chrome.

## Decision (owner, 2026-09-29)

> "I like output C but not the whole thing, just replace the Dia logo with the Big Yahu mascot."

So: everything stays Dia except the logo. Big Yahu replaces Dia's mark on the New Tab page (peeking over the
bar, as in board C's first window) and on the sidebar's New Tab row. The palettes, type, icons and moments
above are parked. The production assets and wiring notes are in `yahu-mark/`.
