// "Full Immunity", a :31 campaign spot (output/launch-video/treatment.md). Frames at 30 fps.
// The picture is cut to the score. The morning cue (assets/sound/music-morning.mp3, 96 BPM, a bar is 2.51 s)
// starts on the turn; its band enters two bars in, the feature cuts land on bar lines, the montage on half
// bars, and its last hit lands on the portrait.
export const FPS = 30;
export const W = 1080;
export const H = 1350;

const at = (s: number) => Math.round(s * FPS);

export const SHOTS = {
  cookie: [0, 90], // Exhibit A: the cookie wall's own words
  tally: [90, 222], // Exhibit B: the forecast page and its ads; 22 ad companies
  since: [222, 270], // the same page, stamped: same browser since 2008
  turn: [270, 422], // hard cut to colour on the downbeat: the same page, clean. FULL IMMUNITY.
  addr: [422, 497], // band enters: the sidebar address bar
  swipe: [497, 573], // profiles
  store: [573, 648], // Chrome Web Store
  aquarium: [648, 663], // three beats of heavy pages
  earth: [663, 678],
  yahu: [678, 693],
  cleared: [693, 787], // the notarization verdict; CLEARED
  portrait: [787, 841], // last chord: Big Yahu. IMPEACH CHROME.
  end: [841, 930], // the disclaimer, black and white like frame 0 (the loop)
} as const satisfies Record<string, readonly [number, number]>;
export type ShotId = keyof typeof SHOTS;
export const TOTAL = SHOTS.end[1];

/** Sound cues (seconds): the narrator's takes, the score and the foley (scripts/make-sound.mjs). */
export const CUES = {
  vo: {
    privacy: 0.35,
    forecast: 3.1,
    immunity: 9.35,
    cleared: 23.2,
    impeach: 26.75,
    disclaimer: 28.1,
  },
  music: { attack: 0, attackFadeOut: [7.7, 8.7] as const, morning: SHOTS.turn[0] / FPS },
  // The counter ticks from "called" to "twenty-two" (forecast take: called @2.24, 22 @2.78).
  tally: { from: 3.1 + 2.24, to: 3.1 + 2.8, count: 22 },
  stamps: [SHOTS.since[0] / FPS + 5 / FPS, 23.2 + 1.78],
  // In the address-bar clip: the field opens at frame 12, letters appear at these clip frames.
  addrOpen: 12,
  addrLetters: [35, 38, 41, 44, 47, 51, 54, 57, 61],
  swipeStart: 8, // swipe clip frame where the drag begins
  storePress: 32, // store clip frame of the click
};

export const t = at;
