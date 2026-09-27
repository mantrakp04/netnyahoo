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

# The second film: "Pour"

"Netnyahoo — Eau de Chromium": a 32-second fragrance-commercial parody, 4:5 (1080×1350) with a 9:16 cut
(1080×1920). The browser is the object of desire, shot like a perfume bottle: extreme macro slides with a
shallow depth of field, a warm light gliding over the glass, slow motion, dissolves instead of cuts, a sultry
score and a whispered voice. Every line is a double entendre that is literally true of a feature. Big Yahu, the
app icon (his face) and netnyahoo.com (his portrait) stay out of it. The treatment is in
`output/launch-video/pour-treatment.md` (gitignored).

```bash
pnpm prepare-assets     # also copies assets/pour → public/pour and builds public/sound/pour.wav
pnpm render:pour        # edit check (scripts/check-pour.mjs), then → output/launch-video/netnyahoo-pour.mp4
pnpm render:pour-phone  # → output/launch-video/netnyahoo-pour-phone.mp4
```

`src/pour/timeline.ts` is the whole edit:
- **The grid.** 66.67 BPM: a beat is 27 frames, a bar 108, nine bars.
- **The plates.** Each picture is the same window at the same size, so a dissolve under the one continuous
  camera is a match; a change that would double-expose text dips through the dark instead.
- **The camera** (a monotone spline, never past 1.45x the 2x capture) and **the focus**, drawn as three
  screen-space layers of the window (sharp, soft, very soft and darker), masked around the focus point.
- **The lines, subtitles and supers.** `scripts/check-pour.mjs` fails the render if any of them, or any picture
  change, leaves the grid, if anything shows for under 12 frames, or if a line is still speaking when the next
  starts.

The dark behind the window is procedural smoke (`src/pour/Smoke.tsx`, a shader). The flacon at the end
(`src/pour/Flacon.tsx`) is the window made into a perfume bottle in three.js: glass in the window's proportions,
amber inside, a lacquer cap, the traffic lights as three engraved dots (one in the brand red), lit by a procedural
studio of softboxes. Palette: warm near-black, champagne, and the red once. Type: Archivo, wide-tracked caps for
the name and the supers, light sentence case for the subtitles.

## Where its pictures come from

Every UI pixel is Netnyahoo drawing its own window in-process (`devSnapshotWindow`, 2x), in a hidden DEV
instance (`NETNYAHOO_BACKGROUND=1`, a throwaway `NETNYAHOO_DATA_DIR`, CDP on its own port), with each page's
CDP capture placed in the page's area by `scripts/capture/build-pour.py`. The layout is the default one (the
address in the toolbar), the profile is Orange, and the appearance dark. The harness scripts are
`scripts/capture/harness/pour-*.js`, run with `shot.sh`:

- **Command bar** (`pour-bar`): "n" and "net" typed into ⌘T's bar, completed inline from history to
  netnyahoo.com. A hidden instance gets no keystrokes, so each letter is put into the native field first and then
  reported through the bar's DEV driver; the bar's own completion request then finds the field showing what it
  typed, as with real typing. Search suggestions are off. "ne" never completes this way and isn't used.
- **Focus mode** (`pour-peek`): ⌘S hides the sidebar; the sidebar's peek then slides in and away again. Its own
  180 ms eased slide is slowed 40 times for the run (React Native's `Animated.timing` is wrapped, then restored)
  and snapshotted about 8 times a second; the peek is driven through its own mouse handlers, found in the fiber
  tree. `build-pour.py` speed-ramps the slide to ease in and out by picking, for each frame, the snapshot nearest
  the moment the peek reached that position. Nothing is interpolated.
- **The ad blocker** (`pour-block`): Site Controls open on Merriam-Webster's "protection" page ("Block Ads &
  Trackers", on, "3 blocked on this page"). The page stays out of focus.
- **Incognito** (`pour-incog`): ⌘⇧N, on the same silk; **the source** (`pour-repo`): the repository's page.
- **The page** is a photograph of black silk from Unsplash (photo-1705674337411, Unsplash License), opened
  directly, its tab renamed "Silk" with the app's own Rename.

Not captured: the sidebar's translucency (the snapshot draws the window's backdrop opaque, even with
`transparent`); the light that sweeps the glass stands in for it.

## Its sound

- **Score:** Eleven Music `music_v2_5`, instrumental (`music.mjs pour`): sultry trip-hop / slow R&B at 67 BPM,
  bars 3–4 sparse and nearly silent at the end of bar 4 for the Focus reveal, the groove back on bar 5, a last
  low hit on bar 9. Take 3 of four, picked by beat tracking: it fits 66.43 BPM with its downbeat at 0.034 s, and
  it's the only take with the bar-4 drop. `make-pour-sound.mjs` stretches it 0.36% onto the 66.67 BPM grid.
- **Voice:** eleven_v3, "Casanova" from the voice library (deep, hushed, breathy), `[whispers]`, four takes a
  line (`voice.mjs`), checked with Scribe. Each line's first sound lands on its beat; the score dips 4 dB under it.
- **No sound effects**: the subtractive pass left only the score and the voice.
- **Mix:** -14 LUFS integrated, under -1 dBTP, like the first film.
