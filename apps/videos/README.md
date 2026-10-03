# Videos

Remotion videos for Netnyahoo, a Remocn Studio project. Each folder in `src/videos` is a composition, named after the
folder. Render one with `pnpm -C apps/videos render <id>`, which writes `out/<id>.mp4` (gitignored).

`render` runs `scripts/deliver.sh`. Remotion's own AAC carries 2048 samples of encoder priming with no edit list, so
every hit would land 43 ms late. The script keeps Remotion's video, re-encodes the score from its WAV with ffmpeg
(whose mp4 muxer trims the priming) and checks the result with `scripts/check-sync.py`, which must report a lag of
0 samples.

## The launch film: "The asks"

| Composition | Size | Length |
| --- | --- | --- |
| `launch-16x9` | 1920 × 1080 | 44.8 s |
| `launch-9x16` | 1080 × 1920 | 44.8 s |
| `teaser-16x9` | 1920 × 1080 | 14.9 s |
| `teaser-9x16` | 1080 × 1920 | 14.9 s |

Every other browser asks for something. Four brass stabs carry "SIGN IN. / TRY AI. / ACCEPT ALL. / UPGRADE.",
each over a site interrupting you in a real Netnyahoo window: a login wall sliding up, an AI copilot panel sliding
in over an article, a cookie wall, an "upgrade to keep typing" modal, with a pointer heading for each button. Then
the asks get stamped onto it on a snare roll. Big Yahu rises behind the
pile and swats it off as "NETNYAHOO — THE SIDEBAR BROWSER FOR MAC" lands, then stamps "ASKS FOR NOTHING."

The product follows, live:
- clicking down the tabs and scrolling a page;
- the profile swipe (Personal → Work → Campaign → Side Project), each profile's name and colour switching on the
  frame its page changes;
- split view with the divider dragged, Big Yahu popping up for "NO COALITION TALKS.";
- the built-in blocker switched off and on, its count climbing;
- "IT'S ACTUALLY CHROMIUM.".

The window waits on the stock's colour, two fingers settle on a trackpad, the first drag starts inside a beat of
true silence, and the page change *is* drop B: five profiles in eight beats, each named on the frame it lands, the
paper taking each profile's colour. Then:
- "ANY CHROME EXTENSION." with "NO THANKS." stamped on Chrome's own prompt;
- "SEVEN APP ICONS. ONE FACE.";
- four "NO" cards;
- netnyahoo.com typed into the address bar, the camera diving into the site's "Full immunity.";
- the end card: the icon, the name, DOWNLOAD FREE / NETNYAHOO.COM and the GitHub address, with Big Yahu doing the
  griddy and landing a flex on the last brass button.

The film uses about 80 words on screen. The type is the site's poster system on warm stock: Archivo, Newsreader and
Martian Mono, with the tie's blue and the stamp's red.

`src/lib/nn-launch` holds the film:

- `cuts.json` holds the tempo (128.57 BPM, so a beat is exactly 14 frames at 30 fps), each cut's arrangement,
  silent windows and sound effects in beats, and the master's loudness. The score and the edit both read it.
- `plan.ts` is the edit as data: the shots in beats and every text and placed object with its defaults for both
  aspects. It has no imports. Portrait keeps everything that matters inside y 220–1480 and x 60–940, clear of
  Reels, TikTok and Shorts captions.
- `shots.tsx` has one component per shot: camera moves and cuts, footage frame choice, swipes timed so each page
  change lands on its beat, the pointer, and Big Yahu.
- `kit.tsx` has the window (real footage, the macOS corner and shadow, a camera that can aim a window's corner at
  the frame, and motion blur used only on the dive), the pointer, the trackpad glyph, the type styles, the springs
  and the paper.
- `Yahu3D.tsx` renders the site's rigged Big Yahu with three.js, pure in time. `remotion.config.ts` enables ANGLE
  for WebGL.
- `Film.tsx` places the shots on the beat grid and plays the score. `footage.json` indexes the captured frames;
  `scripts/capture/composite.py` writes it.

### Editing in Remocn Studio

Each video has a `studio.json`, the Studio document. It covers every text (copy, size, colour, plate and box) and
every window's rest pose (x, y, size, rotation), in that video's own coordinates. Each object is bound on the
canvas, so the owner can retype a line, drag a window or resize a box in place. Animation is added on top of the
saved values: a camera zoom or a slam's entrance never overwrites them, and slams shrink to fit their box, so an
edited line never runs out of the frame. Timing stays in `plan.ts`.

The runtimes are copied from Studio: `src/lib/studio-objects-v6` (the provider, with deletion) over
`studio-objects-v5` (readers, geometry, text bindings). `node scripts/studio-docs.mts` adds any object `plan.ts`
declares that a document lacks. It keeps existing values, removals and operation history.

## Recreating the media (not in git)

`public/footage`, `public/music`, `public/fonts`, `public/brand`, `public/models` and `.capture` are gitignored. To rebuild them:

```bash
cd apps/videos
scripts/prepare-assets.sh          # fonts, Big Yahu's model, the app icon, macOS pointers (AppKit)
python3 scripts/capture/sites/fetch-images.py   # CC0 / public-domain photos for the stand-in sites
scripts/music/fetch-samples.sh     # the CC0 samples (public/music/samples)
python3 scripts/music/score.py     # public/music/launch.wav, teaser.wav (numpy + scipy)
# footage: a DEV build, captured hidden (needs Metro on :8081, like any DEV instance)
../../scripts/agent/build-app --as videos
scripts/capture/run-all.sh ../browser/build-videos/Build/Products/Debug/Netnyahoo.app <scratch dir> [scene…]
```

### How the footage is made

Every UI pixel comes from Netnyahoo itself, never a mock-up. `run-all.sh` launches a hidden DEV instance
(`NETNYAHOO_BACKGROUND=1`, a scratch `NETNYAHOO_DATA_DIR`, `--session` from `scripts/capture/session.mjs`). That
session has five profiles, each with real sites, in light appearance with the address in the toolbar, so each
profile's name sits next to the traffic lights in its colour:
- Personal (plum)
- Work (blue)
- Campaign (orange)
- Side Project (green)
- Weekend (yellow)

The script runs each scene in `scripts/capture/scenes` through the dev harness (`cap.mjs` with `prelude.js`).
The screen was locked when these were made (2026-10-03), so WindowServer recording came back black and everything
is captured in-process, frame by frame:

- **The window** is the app drawing its own layers (`nn.shell.devSnapshotWindow`, 2x).
- **Stand-in sites.** The hook's four interruptions and the blocker's dictionary page are pages built for the film
  in `scripts/capture/sites/` (moodwall.example, dailyledger.example, crumbs.example, docpad.example and
  lexicon.example). They carry no real brand, logo, headline or photo. `sites/serve.mjs` serves them, and the
  instance maps `*.example` to it with `--host-resolver-rules`, so the address bar shows their names.
  - Their photos are CC0 or public-domain files from Wikimedia Commons, fetched and licence-checked by
    `sites/fetch-images.py` (gitignored; `sites/SOURCES.md` lists each one).
  - Each interruption is the page's own animation, stepped through `window.__t(0…1)`, with a page picture taken
    every step.
  - The dictionary loads the usual ad and tracker tags. Its house "ads" fill only once the ad network's tag has
    loaded, so switching the blocker on really empties them, and the count reads "13 blocked on this page".
- **The end card's icon cycle** uses the seven app icons cut from the real Settings › Appearance capture
  (`icons.py`).
- **The pages** are each tab's own picture of itself (`WebViewHandle.capturePicture(2)`), taken again for every
  frame where the page moves.
- **Live motion**, one real state per film frame:
  - **Profile swipes:** fed step by step through the real gesture tracker (`nnSwipe.sidebar(W).devSimulate`).
    Profiles always change through the swipe, because a programmatic switch leaves the pager mid-move.
  - **Typing:** netnyahoo.com typed a key at a time through the window's key path (DEV `type:`), with the
    field's inline completion, then Return.
  - **Scrolling:** the page scrolled step by step with a picture each step.
  - **The split divider:** the panes' sizes set step by step as the divider's drag sets them, both panes
    re-pictured each step.
  - **The blocker:** Site Controls' Block Ads & Trackers switch flipped through its own `onChange`, its knob
    animation slowed 12x, with the page reloading and the blocked count climbing, snapshotted as fast as they come.
- **Compositing** (`composite.py`):
  - The snapshot is transparent where the app draws with Metal (the window tint), so the profile's tint goes
    underneath, sampled from the snapshot and cross-faded by the pager's position during a swipe.
  - Each page's picture goes where the snapshot shows its placeholder. Blank pictures (a page captured before it
    repainted) are skipped.
  - The traffic lights are AppKit's own buttons, drawn offscreen as an active window (`lights.swift`). The
    pointer is AppKit's `NSCursor` artwork (`cursor.swift`).
- **Big Yahu** is drawn as a printed illustration: three-tone toon shading over his own colours (the scan's texture
  smoothed and flattened), a fine ink outline (three.js `OutlineEffect`) and a contact shadow. On the netnyahoo.com
  frames the site's own glossy render is covered with this one, so the film shows one Big Yahu; the site itself is
  untouched. The model is the site's rigged one (`apps/site/public/models/big-yahu.glb`, clips "Griddy" and "Default
  Dance"), rendered in the film.
- **Not captured:** the sidebar's translucency over the desktop. It needs a WindowServer capture.

## Music and sound

`scripts/music/score.py` is a sampler. It plays recorded instruments on the film's beat grid: a campaign-rally
anthem in F minor at 128.57 BPM, with brass stabs, a march-snare roll, two drops, a break that cuts to silence, an
end hit, march taps and a final brass button.

- **The main stab** is a designed hybrid: unison saws with a filter envelope, a short noise transient and the sampled
  brass as its body, saturated, glued and sent to a room and a plate. It plays the intro stabs, the four NO-run hits,
  the end hit and the button.
- **Produced layers:** a driving saw bass and the 909 kit carry the drops, sidechained, with a pluck in drop A. The
  score uses no recorded voices.
- **Swipe sound:** a filtered noise sweep timed to peak on the frame each swipe commits.
- **For a composer:** `MUSIC-BRIEF.md` maps the grid, hits, silences and the button, so a produced track can drop in.
- **Feel:** inner notes are humanised (seeded jitter and velocity, two dynamic layers, round robins). The
  `breaths` field in `cuts.json` drops the kick, bass and hats under brass stabs (the NO run), then slams back.
- **Sources:**
  - Brass, timpani, cymbals and the concert bass drum come from VSCO 2 Community Edition.
  - The rope-tension march snare, claps, tom, slapstick and woodblock come from the Versilian Community Sample
    Library (both by Versilian Studios).
  - The 909 kick, clap and hats come from MckSamplePacks' TR-8 recordings.
- **Licence:** all three are CC0 1.0 (public domain), so the score can be published anywhere, commercially
  included, without credit. `scripts/music/samples.md` lists every file with its upstream commit and licence.
- **Synthesized parts:** only the sub under the kick and bass, the riser, and the whoosh and swipe noise.
- **Timing and master:** the arrangement, sound effects and silent windows come from `cuts.json`. The master is
  -11 LUFS integrated with true peak at most -1.6 dBTP, so it stays under -1 dBTP after AAC encoding.

To recreate the audio:
1. Run `scripts/music/fetch-samples.sh`. It downloads and checks the samples into the gitignored
   `public/music/samples`.
2. Run `python3 scripts/music/score.py` (needs numpy, scipy and ffmpeg).
3. `python3 scripts/music/analyze.py` measures the result.

Other assets: the fonts are Archivo, Newsreader and Martian Mono (SIL Open Font License, via apps/site's
Fontsource packages). Big Yahu and the app icon are the project's own. The pages shown are public sites as they
appeared on 2026-10-03.

## Checking a render

```bash
pnpm exec tsc --noEmit
pnpm -C apps/videos render launch-16x9
ffmpeg -i out/launch-16x9.mp4 -af ebur128=peak=true -f null - 2>&1 | tail -12   # -11 LUFS, true peak under -1 dBTP
```

Then extract a contact sheet (one frame per beat: `select='not(mod(n\,14))'`, tiled) and look at it.
