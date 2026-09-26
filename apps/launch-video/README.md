# Netnyahoo launch film: "The sidebar browser"

A 30-second, 4:5 (1080×1350) product film for X, made with Remotion. One real Netnyahoo window floats in
a dark space. A single eased camera moves over it through the product's moat:
- the Arc-style address bar in the sidebar;
- profiles you swipe between;
- split view;
- any Chrome Web Store extension;
- no account, no AI, open source.

The film is music-led, with four supers and no narrator. The satire comes only at the end ("Full immunity.
From ads, trackers and acquisitions.", then Big Yahu and "Impeach Chrome.").
The treatment is in `output/launch-video/treatment.md` (gitignored); the research behind it is in
`docs/research/launch-video-playbook.md`.

Standalone package (excluded from the root workspace, like `apps/site`):

```bash
cd apps/launch-video
pnpm install
pnpm prepare-assets   # footage, the Big Yahu model, fonts → public/; builds public/sound/track.wav
pnpm dev              # Remotion Studio
pnpm render           # edit check, then → output/launch-video/netnyahoo-launch.mp4 (picture + sound, for upload)
pnpm cover            # → output/launch-video/netnyahoo-launch-cover.png
```

## The edit

`src/timeline.ts` is the whole film:
- **The grid.** 72 BPM: a beat is 25 frames, a bar 100, nine bars.
- **The clips** and where they sit.
- **The camera path.** The keys are window pixels, a scale and a tilt, joined by a monotone Hermite spline
  so no move overshoots.
- **The supers.**

Every state change and super lands on a beat, and bar 9's downbeat is the only hard cut. The camera never
magnifies the 2x capture past 1:1 except inside the zoom-through, which passes through a flat white patch
of the page.

`scripts/check-edit.mjs` runs before every render and fails it if anything leaves the grid or shows for
under 12 frames.

## Where the pictures come from

Every pixel of the window is a real capture of Netnyahoo 0.2.2 (a DEV build of the same source), made in a
hidden test instance (`NETNYAHOO_BACKGROUND=1`, its own `NETNYAHOO_DATA_DIR`, CDP on 9610). The Mac's
screen was locked, so none of it goes through WindowServer:

- **Our UI** (sidebar, dropdown, pager, dialogs) is the app drawing its own window in-process
  (`nn.shell.devSnapshotWindow`, 2x), driven by the DEV harness (`scripts/capture/harness/*.js` via
  `shot.sh` and `dev.mjs`).
  - The dropdown gets one snapshot per typed letter.
  - The profile swipe is 100 steps of a two-finger gesture fed through the real tracker
    (`nnSwipe.sidebar().devSimulate`).
  - Snapshots taken mid-redraw come back blank, and `build-film.py` drops them.
- **Pages** are CDP captures (`Page.captureScreenshot`).
  - earth.nullschool.net runs on `scripts/clock.js`, stepped 1/30 s per frame.
  - The Web Store's own "Add to Netnyahoo" button is clicked through CDP (`clickloop.mjs`). The page is
    scrolled so its "Switch to Chrome" banner sits under the header, and the header stays out of frame.
- **Compositing:** `composite.py` finds each pane in the snapshot (split view has two) and places the page
  capture there, except where our UI draws over the page (dialogs). It carries a dialog's scrim onto the
  page.
- **Chrome and pointer:** the traffic lights come from a `screencapture -l` still of the same build. The
  pointer is macOS's own pointing-hand artwork.
- **Timing:** `build-film.py` builds `assets/footage/film-*.mp4` and places each state change on its beat.
  The store's 5-second install spinner is cut.
- **Not captured:** the sidebar's translucency over the desktop. It needs a WindowServer capture.
- **Big Yahu** is the site's model (`apps/site/public/models/big-yahu.glb`), rendered with three.js.

## Sound

Everything is ElevenLabs (`scripts/audio/`). The key comes from `ELEVENLABS_API_KEY` or `.env`
(gitignored); it's never printed, and errors are redacted.

- **Score:** Eleven Music `music_v2_5`, prompted as a nine-bar, 72 BPM structure with `force_instrumental`
  (`music.mjs`).
  - Composition-plan chunk text is sung as lyrics, so the structure goes in the prompt instead.
  - The chosen take was picked from four by beat tracking: it fits a 71.9 BPM grid at phase 0, and every
    bar line opens with a hit 10–50 ms late.
  - `transcribe.mjs` (Scribe v2) confirmed it has no voice.
- **Foley** (`sfx.mjs`): a field click, nine key taps, a trackpad swipe and two clicks, at the frames the
  actions happen.
- **Mix** (`scripts/make-sound.mjs`): a static gain to -14 LUFS integrated, then a 4x-oversampled limiter.
  The delivered file measures -14.0 LUFS and -1.6 dBTP.

Rights: everything was generated on a paid ElevenLabs plan (Creator), which includes a commercial license.
