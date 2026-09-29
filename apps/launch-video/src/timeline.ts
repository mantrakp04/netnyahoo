export const FPS = 30;
export const W = 1080;
export const H = 1350;
export const BEAT = 25;
export const BAR = 100;
export const TOTAL = 9 * BAR;
export const at = (bar: number, beat = 1, plus = 0) => (bar - 1) * BAR + (beat - 1) * BEAT + plus;

export const CLIPS = [
  { src: "footage/film-personal.mp4", from: at(1), to: at(3) },
  { src: "footage/film-swipe.mp4", from: at(3), to: at(4) },
  { src: "footage/film-split.mp4", from: at(4), to: at(5, 1, 9) },
  { src: "footage/film-store.mp4", from: at(5, 1, 9), to: at(6) },
  { src: "footage/film-hero.mp4", from: at(6), to: at(8) },
] as const;

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

export type Key = { f: number; x: number; y: number; s: number; rx: number; ry: number };
export const CAMERA: Key[] = [
  { f: 0, x: 1330, y: 900, s: 0.43, rx: 7, ry: -15 },
  { f: 95, x: 760, y: 700, s: 0.64, rx: 4, ry: -8 },
  { f: 128, x: 560, y: 470, s: 0.95, rx: 2, ry: -4 },
  { f: 188, x: 545, y: 450, s: 1, rx: 1, ry: -2 },
  { f: 218, x: 560, y: 660, s: 0.92, rx: 2, ry: -4 },
  { f: 292, x: 600, y: 720, s: 0.86, rx: 2, ry: -6 },
  { f: 335, x: 1620, y: 900, s: 0.5, rx: 3, ry: -6 },
  { f: 392, x: 2300, y: 1100, s: 0.62, rx: 1, ry: -2 },
  { f: 398, x: 2368, y: 1120, s: 0.8, rx: 0, ry: 0 },
  { f: 408, x: 2368, y: 1120, s: 8, rx: 0, ry: 0 },
  { f: 409, x: 1835, y: 470, s: 6, rx: 0, ry: 0 },
  { f: 418, x: 1835, y: 470, s: 0.95, rx: 0, ry: 0 },
  { f: 428, x: 1990, y: 1216, s: 0.68, rx: 0, ry: 0 },
  { f: 452, x: 1995, y: 1216, s: 0.68, rx: 0, ry: 0 },
  { f: 470, x: 1870, y: 1210, s: 0.69, rx: 1, ry: -1 },
  { f: 500, x: 1885, y: 1200, s: 0.7, rx: 1, ry: -2 },
  { f: 528, x: 1440, y: 900, s: 0.36, rx: 8, ry: -16 },
  { f: 598, x: 1440, y: 900, s: 0.38, rx: 6, ry: -9 },
  { f: 650, x: 1080, y: 600, s: 0.94, rx: 2, ry: -4 },
  { f: 698, x: 1100, y: 590, s: 1, rx: 1, ry: -2 },
  { f: 716, x: 2692, y: 1477, s: 9, rx: 0, ry: 0 },
  { f: 800, x: 2692, y: 1477, s: 9, rx: 0, ry: 0 },
];

export const CAMERA_BREAKS = [409];

export const SUPERS = [
  { from: at(1, 2), to: at(2, 1, -4), text: "The sidebar browser." },
  { from: at(5, 2), to: at(6, 1, -4), text: "Every Chrome extension." },
  { from: at(6, 2), to: at(7, 1, -4), text: "No account. No AI." },
  { from: at(7, 2), to: at(8, 1, -4), text: "Open source. Free." },
] as const;
