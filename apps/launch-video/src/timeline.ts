// Frame numbers (30 fps) for every beat. Rounds use the captured game frames 1:1.
export const FPS = 30;
export const W = 1080;
export const H = 1350;

/** The game's clock starts at 3.02 s so frame 0 reads 3.0 and frame 89 reads 0.0 (see capture-game.mjs). */
export const CLOCK = 3.02;

const seq = <T extends Record<string, number>>(lengths: T) => {
  let at = 0;
  const out = {} as { [K in keyof T]: { from: number; dur: number; to: number } };
  for (const k of Object.keys(lengths) as (keyof T)[]) {
    out[k] = { from: at, dur: lengths[k], to: at + lengths[k] };
    at += lengths[k];
  }
  return { beats: out, total: at };
};

export const { beats: B, total: TOTAL } = seq({
  r1: 108, // level 1: 60 frames of searching, the click, the game's found animation
  r2: 114, // level 4: 69 frames of searching, then found
  r3: 90, // level 10: the whole clock, no reveal
  timeUp: 36, // frozen on 0.0
  twist: 105, // pull back: it's the browser's offline page
  receipts: 148, // four lines, 37 frames each
  end: 108, // Big Yahu, the name, the line
  bridge: 30, // back into round 1, frame 0 (the loop)
});

export const R1_CLICK = 60;
export const R2_CLICK = 69;
