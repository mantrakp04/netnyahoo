// "The sidebar browser": the Netnyahoo launch film. 30 fps, 72 BPM: a beat is 25 frames, a bar 100.
// Nine bars, 900 frames (30.0 s). Every state change and every cut lands on a beat; the only hard cut is
// bar 9's downbeat. The score (assets/sound/music-film.mp3) hits on every bar line.
export const FPS = 30;
export const W = 1080;
export const H = 1350;
export const BEAT = 25;
export const BAR = 100;
export const TOTAL = 9 * BAR;
/** Bar n (1-based), beat b (1-based), plus frames. */
export const at = (bar: number, beat = 1, plus = 0) => (bar - 1) * BAR + (beat - 1) * BEAT + plus;

/** The window clips (assets/footage, built by scripts/capture/build-film.py) and where they sit on the timeline. */
export const CLIPS = [
  { src: "footage/film-personal.mp4", from: at(1), to: at(3) },
  { src: "footage/film-swipe.mp4", from: at(3), to: at(4) },
  { src: "footage/film-split.mp4", from: at(4), to: at(5, 1, 9) },
  { src: "footage/film-store.mp4", from: at(5, 1, 9), to: at(6) },
  { src: "footage/film-hero.mp4", from: at(6), to: at(8) },
] as const;

/** Events inside the clips (film frames; assets/footage/film.json). */
export const EV = {
  addrOpen: at(2),
  addrLetters: [106, 110, 114, 118, 122, 126, 130, 134, 138],
  addrClose: 188,
  swipeStart: at(3, 1, 3),
  split: at(4),
  storePress: at(5, 3),
  storeDone: at(6),
  repoClick: at(6, 2),
};

// ---- The camera: a point on the window (window px, 2880×1800), how many frame px per window px, and a
// tilt (degrees). A Catmull-Rom spline through the keys, so the move never stops dead unless a key repeats.
export type Key = { f: number; x: number; y: number; s: number; rx: number; ry: number };
// Never closer than 1:1 with the 2x capture (s ≤ 1), except inside the two zoom-throughs' flat colour.
export const CAMERA: Key[] = [
  // bar 1: the whole window, its page full of weather, turning toward us; then in toward the sidebar
  { f: 0, x: 1330, y: 900, s: 0.43, rx: 7, ry: -15 },
  { f: 95, x: 760, y: 700, s: 0.64, rx: 4, ry: -8 },
  // bar 2: onto the address field as Arc's dropdown opens
  { f: 128, x: 560, y: 470, s: 0.95, rx: 2, ry: -4 },
  { f: 188, x: 545, y: 450, s: 1, rx: 1, ry: -2 },
  // bar 3: the sidebar, whole, for the swipe
  { f: 218, x: 560, y: 660, s: 0.92, rx: 2, ry: -4 },
  { f: 292, x: 600, y: 720, s: 0.86, rx: 2, ry: -6 },
  // bar 4: across to the split
  { f: 335, x: 1620, y: 900, s: 0.5, rx: 3, ry: -6 },
  { f: 392, x: 2300, y: 1100, s: 0.62, rx: 1, ry: -2 },
  // bar 5: into the widest flat white on the docs page (no text within 159 px) and back out of the store's
  // (244 px): straight in and straight out, the pan only once the frame is readable again
  { f: 398, x: 2368, y: 1120, s: 0.8, rx: 0, ry: 0 },
  { f: 408, x: 2368, y: 1120, s: 8, rx: 0, ry: 0 },
  { f: 409, x: 1835, y: 470, s: 6, rx: 0, ry: 0 },
  { f: 418, x: 1835, y: 470, s: 0.95, rx: 0, ry: 0 },
  // one framing for the install: the button (and the cursor) top right, our dialog centre; the store's
  // header (and its Sign in) stays above the frame
  { f: 428, x: 1990, y: 1216, s: 0.68, rx: 0, ry: 0 },
  { f: 452, x: 1995, y: 1216, s: 0.68, rx: 0, ry: 0 },
  { f: 470, x: 1870, y: 1210, s: 0.69, rx: 1, ry: -1 },
  { f: 500, x: 1885, y: 1200, s: 0.7, rx: 1, ry: -2 },
  // bar 6: out to the whole window, floating
  { f: 528, x: 1440, y: 900, s: 0.36, rx: 8, ry: -16 },
  { f: 598, x: 1440, y: 900, s: 0.38, rx: 6, ry: -9 },
  // bar 7: in on the repository, 1:1
  { f: 650, x: 1080, y: 600, s: 0.94, rx: 2, ry: -4 },
  { f: 698, x: 1100, y: 590, s: 1, rx: 1, ry: -2 },
  // bar 8: through the page's dark background, to black
  { f: 716, x: 2692, y: 1477, s: 9, rx: 0, ry: 0 },
  { f: 800, x: 2692, y: 1477, s: 9, rx: 0, ry: 0 },
];

// Cuts inside the camera path that jump (the zoom-throughs hand over inside a flat colour); the spline restarts
// on each side of them.
export const CAMERA_BREAKS = [409];

/** The supers: few, large, on beats. */
export const SUPERS = [
  { from: at(1, 2), to: at(2, 1, -4), text: "The sidebar browser." },
  { from: at(5, 2), to: at(6, 1, -4), text: "Every Chrome extension." },
  { from: at(6, 2), to: at(7, 1, -4), text: "No account. No AI." },
  { from: at(7, 2), to: at(8, 1, -4), text: "Open source. Free." },
] as const;
