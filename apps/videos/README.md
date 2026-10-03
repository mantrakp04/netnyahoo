# Videos

Remotion videos for Netnyahoo, a Remocn Studio project. Each folder in `src/videos` is a composition, named after the
folder. Render one with `pnpm -C apps/videos render <id>`, which writes `out/<id>.mp4` (gitignored).

## The launch film: "The asks"

| Composition | Size | Length |
| --- | --- | --- |
| `launch-16x9` | 1920 × 1080 | 44.8 s |
| `launch-9x16` | 1080 × 1920 | 44.8 s |
| `teaser-16x9` | 1920 × 1080 | 16.8 s |
| `teaser-9x16` | 1080 × 1920 | 16.8 s |

The film works like a campaign spot. Every other browser asks for something: sign in, try AI, accept all, upgrade.
Then the asks pile up, and Netnyahoo shows up asking for nothing. After that comes the product at speed, cut to an
original score: tabs down the side, the profile swipe (the signature, shown twice), split view, the address bar
dissolving into the sidebar, the built-in blocker, profile colours, Chromium, the Web Store, privacy settings, the app
icons, and four "no" cards. It ends on the site's own "Full immunity." and Big Yahu's victory dance. The look is
the site's poster system: Archivo, Newsreader and Martian Mono on warm stock, with the tie's blue and the stamp's red.

`src/lib/nn-launch` holds the film:

- `cuts.json` holds the tempo (128.57 BPM, so a beat is exactly 14 frames at 30 fps), each cut's musical
  arrangement and its sound effects in beats. The score script and the edit both read it.
- `plan.ts` is the edit as data. It lists the shots in beats and every text and window with its defaults for both
  aspects. It has no imports.
- `shots.tsx` holds one component per kind of shot: camera moves, footage frame choice, swipes, pointer clicks.
- `kit.tsx` holds the window (real footage with the macOS corner, shadow, camera and motion blur), the pointer, the
  type styles (slam, stamp, label, lede, words), springs and the paper.
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

`public/footage`, `public/music`, `public/fonts`, `public/brand` and `.capture` are gitignored. To rebuild them:

```bash
cd apps/videos
scripts/prepare-assets.sh          # brand fonts and Big Yahu from apps/site, macOS pointers (AppKit)
python3 scripts/music/score.py     # public/music/launch.wav, teaser.wav (numpy + scipy)
# footage: a DEV build, captured hidden (needs Metro on :8081, like any DEV instance)
../../scripts/agent/build-app --as videos
scripts/capture/run-all.sh ../browser/build-videos/Build/Products/Debug/Netnyahoo.app <scratch dir> [scene…]
```

### How the footage is made

Every UI pixel comes from Netnyahoo itself, never a mock-up. `run-all.sh` launches a hidden DEV instance
(`NETNYAHOO_BACKGROUND=1`, a scratch `NETNYAHOO_DATA_DIR`, `--session` from `scripts/capture/session.mjs`). That
session has three profiles (Personal in plum, Work in blue, Campaign in orange), each with six real sites, the
address bar in the sidebar, and dark appearance. The script runs each scene in `scripts/capture/scenes` through the
dev harness (`cap.mjs` with `prelude.js`).

- **The window** is the app drawing its own layers in-process (`nn.shell.devSnapshotWindow`, 2x). This works with
  the screen locked; on 2026-10-03 the screen was locked, so WindowServer captures came back black.
- **The pages** are each tab's own picture of itself (`WebViewHandle.capturePicture(2)`), with its frame in the
  window.
- **Profile swipes** are fed step by step through the real gesture tracker (`nnSwipe.sidebar(W).devSimulate`), one
  snapshot per step, so every film frame of a swipe is a real frame of the pager. Profiles always change through
  the swipe: a programmatic switch leaves the pager's model layers mid-move, and the snapshot then shows two pages
  on top of each other.
- **Compositing** (`composite.py`): the snapshot is transparent where the app draws with Metal (the window tint),
  so the profile's tint goes underneath. The tint is sampled from the snapshot's opaque edge and cross-faded by the
  pager's position during a swipe, as the app does. Each page's picture goes where the snapshot shows its
  placeholder, and our own UI over a page stays on top. The traffic lights are AppKit's own buttons, drawn
  offscreen as an active window (`lights.swift`) at the position `NETNYAHOO_TRAFFIC_LIGHTS_LOG` reports. The
  pointer is AppKit's own `NSCursor` artwork (`cursor.swift`).
- **Not captured:** the sidebar's translucency over the desktop and the New Tab's Metal light. Both need a
  WindowServer capture.

## Music and sound: an original score

`scripts/music/score.py` synthesizes the whole track from oscillators and noise. It uses no samples, loops, presets
or third-party audio. The track is a campaign-rally anthem in F minor at 128.57 BPM. The hook is four brass stabs,
then a marching-snare roll and a riser. The first drop has four-on-the-floor drums, a supersaw chord bed, a rolling
sidechained bass and a tresillo brass riff. A two-bar break follows, then a bigger second drop with a lead melody,
then an end hit, march taps and a final brass button. The sound effects (stamps, whooshes, swipes and clicks) are
synthesized in the same script, at the beats `cuts.json` gives, and mixed into the score. The master is -14 LUFS
integrated, peaking around -5 dBFS (ITU-R BS.1770 gating in the script; checked on the renders with
`ffmpeg -af ebur128`).

**License:** the score and its sound effects are original works made for this project by this script. They contain
no third-party material, so the owner can publish them anywhere, commercially included. Re-running the script with
the same `cuts.json` reproduces the same audio (the noise is seeded).

Other assets: the fonts are Archivo, Newsreader and Martian Mono (SIL Open Font License, via apps/site's
Fontsource packages). Big Yahu is the site's own render of the mascot. The pages shown are public sites as they
appeared on 2026-10-03.

## Checking a render

```bash
pnpm exec tsc --noEmit
pnpm -C apps/videos render launch-16x9
ffmpeg -i out/launch-16x9.mp4 -af ebur128=peak=true -f null - 2>&1 | tail -12   # about -14 LUFS
```

Then extract a contact sheet (one frame per beat: `select='not(mod(n\,14))'`, tiled) and look at it.
