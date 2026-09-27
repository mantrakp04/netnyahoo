// "Pour": Netnyahoo, Eau de Chromium. A fragrance-commercial parody where the browser is the object of desire.
// 30 fps, 66.67 BPM: a beat is 27 frames, a bar 108. Nine bars, 972 frames (32.4 s). Every state change, line and
// super lands on a beat; scripts/check-pour.mjs fails the render otherwise. There are no hard cuts: each picture
// dissolves into the next under one continuous camera, and every picture is the same window at the same size, so
// a dissolve is a match.
export const FPS = 30;
export const W = 1080;
export const H = 1350;
export const BEAT = 27;
export const BAR = 4 * BEAT;
export const TOTAL = 9 * BAR;
/** Bar n (1-based), beat b (1-based), plus frames. */
export const at = (bar: number, beat = 1, plus = 0) => (bar - 1) * BAR + (beat - 1) * BEAT + plus;

/** The window, as captured (assets/pour, scripts/capture/build-pour.py): 1360×860 pt at 2x. */
export const WIN = { w: 2720, h: 1720 };

// ---- The pictures. Each plate fades in over `fade` frames ending on `from` (so the state change completes on
// the beat) and holds until the next plate has covered it.
export type Plate = { id: string; src: string; from: number; fade: number; video?: boolean; dip?: boolean };
export const PLATES: Plate[] = [
  { id: "hero", src: "pour/hero.jpg", from: 0, fade: 0 },
  // ⌘T: the command bar over the silk; "n", then "net", completed inline to netnyahoo.com
  { id: "bar-open", src: "pour/bar-open.jpg", from: at(2), fade: 8 },
  { id: "bar-n", src: "pour/bar-n.jpg", from: at(2, 2), fade: 3 },
  { id: "bar-net", src: "pour/bar-net.jpg", from: at(2, 4), fade: 3 },
  // Escape: back to the window, which the camera leaves to see whole
  { id: "hero-2", src: "pour/hero.jpg", from: at(3), fade: 14 },
  // ⌘S: the sidebar's peek slides away in slow motion and the page takes the window (FOCUS)
  { id: "focus", src: "pour/focus.mp4", from: at(4), fade: 12, video: true },
  // the ad blocker: Site Controls over a dictionary page
  { id: "block", src: "pour/block.jpg", from: at(5), fade: 14 },
  // the same silk, in an incognito window: the sidebar drains to black
  { id: "incognito", src: "pour/incognito.jpg", from: at(6), fade: 18, dip: true },
  // the source
  { id: "repo", src: "pour/repo.jpg", from: at(7), fade: 16, dip: true },
];
/** The Focus clip (assets/pour/pour.json): 12 frames of the peek at rest, then its slide (43 frames), then the page alone. */
export const FOCUS = { rest: 12, slide: 43 };
/** The peek starts to slide on the downbeat of bar 4; the clip starts `rest` frames before it. */
export const focusClipStart = () => at(4) - FOCUS.rest;

/** The window leaves (into the dark) at the end of bar 7; the flacon rises in bar 8; the last card is bar 9. */
export const WINDOW_OUT = { from: at(7, 4), to: at(8) };
export const FLACON = { from: at(8), to: TOTAL };
export const CARD = at(9);

// ---- The camera over the window: a point on it (window px), frame px per window px, and a tilt (degrees).
// A monotone Hermite spline through the keys; the scale is interpolated in log space. The 2x capture is never
// magnified past 1.45 (only inside the focus band, where the grain and the blur around it hide the softness).
export type Key = { f: number; x: number; y: number; s: number; rx: number; ry: number };
export const CAMERA: Key[] = [
  // bar 1: extreme macro, sliding down the sidebar's tabs toward "Silk"
  { f: 0, x: 250, y: 250, s: 1.45, rx: 9, ry: -20 },
  { f: at(1, 4), x: 260, y: 400, s: 1.36, rx: 7, ry: -15 },
  // bar 2: across to the command bar's field as it opens; the completion, centred
  { f: at(2, 2), x: 830, y: 110, s: 1.3, rx: 5, ry: -9 },
  { f: at(3), x: 860, y: 118, s: 1.36, rx: 4, ry: -7 },
  // bar 3: out, slowly, to the whole window turning toward us
  { f: at(3, 3), x: 1360, y: 860, s: 0.37, rx: 7, ry: -16 },
  { f: at(4), x: 1360, y: 860, s: 0.36, rx: 5, ry: -10 },
  // bar 4: the undressing, square on, a slow push into the silk
  { f: at(4, 3), x: 1380, y: 900, s: 0.43, rx: 1, ry: -2 },
  { f: at(4, 4), x: 1440, y: 900, s: 0.47, rx: 0, ry: 0 },
  // bar 5: in to the ad blocker's row, the dissolve happening on the way in (so the page behind is never seen whole)
  { f: at(5), x: 2250, y: 560, s: 0.95, rx: 2, ry: 6 },
  { f: at(5, 2), x: 2370, y: 510, s: 1.25, rx: 3, ry: 8 },
  { f: at(5, 4), x: 2390, y: 520, s: 1.34, rx: 2, ry: 6 },
  // bar 6: out to the window as it turns incognito, then in on "Incognito"
  { f: at(6, 1, 10), x: 1360, y: 860, s: 0.44, rx: 4, ry: -6 },
  { f: at(6, 3), x: 320, y: 150, s: 1.3, rx: 6, ry: -14 },
  { f: at(7), x: 340, y: 170, s: 1.36, rx: 5, ry: -12 },
  // bar 7: along the repository's name
  { f: at(7, 2), x: 690, y: 262, s: 1.35, rx: 4, ry: -9 },
  { f: at(7, 4), x: 780, y: 270, s: 1.42, rx: 3, ry: -7 },
  { f: at(8), x: 800, y: 272, s: 1.45, rx: 3, ry: -6 },
];

/** Where the lens is sharp (frame px): a point the plane of focus passes through, and how far the light falls
 * off outside it (`dim`, 0 → 1), per key. */
export const FOCUS_POINT: { f: number; x: number; y: number; r: number; dim: number }[] = [
  { f: 0, x: 470, y: 560, r: 380, dim: 0.34 },
  { f: at(2, 2), x: 540, y: 560, r: 420, dim: 0.34 },
  { f: at(3, 2), x: 540, y: 675, r: 900, dim: 0.34 },
  { f: at(4, 4), x: 540, y: 675, r: 900, dim: 0.34 },
  { f: at(5), x: 560, y: 675, r: 360, dim: 0.85 },
  // the dictionary page behind the popover is white: it falls into shadow, the popover alone in the light
  { f: at(5, 2), x: 560, y: 675, r: 360, dim: 0.78 },
  { f: at(5, 4), x: 560, y: 675, r: 360, dim: 0.78 },
  { f: at(6, 1, 10), x: 540, y: 675, r: 900, dim: 0.34 },
  { f: at(6, 3), x: 520, y: 675, r: 400, dim: 0.34 },
  { f: at(8), x: 520, y: 675, r: 420, dim: 0.34 },
];

// ---- The voice (assets/sound/pour-vo-*.mp3, scripts/audio/voice.mjs): each line's first sound lands on its frame.
// The subtitle under it shows from the same beat.
export const LINES = [
  { id: "name", at: at(1, 2), text: "Netnyahoo.", until: at(2) },
  { id: "finishes", at: at(2, 2), text: "It finishes what you start.", until: at(3, 3) },
  { id: "between", at: at(4, 3), text: "Nothing between you.", until: at(5) },
  { id: "protection", at: at(5, 2), text: "Protection. Always on.", until: at(6) },
  { id: "discreet", at: at(6, 2), text: "Discreet.", until: at(7) },
  { id: "strings", at: at(7, 2), text: "No strings attached.", until: at(8) },
  { id: "immunity", at: at(8, 3), text: "Full immunity.", until: at(9) },
] as const;

/** The supers besides the subtitles: wide-tracked caps, few and small. */
export const SUPERS = [
  { from: at(7, 3), to: at(8), text: "No account · No AI · Open source" },
  { from: at(8, 2), to: at(9), text: "NETNYAHOO", kind: "name" },
  { from: at(8, 2), to: at(9), text: "Eau de Chromium", kind: "sub" },
] as const;

/** Events the edit check holds to the grid (film frames). */
export const EV = {
  barOpen: at(2),
  typedN: at(2, 2),
  typedNet: at(2, 4),
  barClose: at(3),
  focusSlide: at(4),
  block: at(5),
  incognito: at(6),
  repo: at(7),
  flacon: FLACON.from,
  card: CARD,
};
