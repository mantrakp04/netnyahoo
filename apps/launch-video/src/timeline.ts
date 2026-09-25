// Frame numbers (30 fps) for every beat. Rounds use the captured game frames 1:1.
export const FPS = 30;
export const W = 1080;
export const H = 1350;

const seq = <T extends Record<string, number>>(lengths: T) => {
  let at = 0;
  const out = {} as { [K in keyof T]: { from: number; dur: number; to: number } };
  for (const k of Object.keys(lengths) as (keyof T)[]) {
    out[k] = { from: at, dur: lengths[k], to: at + lengths[k] };
    at += lengths[k];
  }
  return { beats: out, total: at };
};

/** Each round's clock (see capture-game.mjs): N.0 on frame 0, 0.0 on frame 30·N − 1, out on 30·N. */
export const ROUNDS = {
  r1: { clock: 3.02, search: 90 },
  r2: { clock: 2.02, search: 60 },
  r3: { clock: 1.02, search: 30 },
} as const;

export const { beats: B, total: TOTAL } = seq({
  r1: 90 + 40, // 3 s to look, then the game shows where he was
  r2: 60 + 32, // 2 s, then the reveal again, shorter
  r3: 30 + 54, // 1 s, 503 suspects, no reveal: hold on 0.0
  twist: 96, // pull back to the window: it's the offline page
  end: 66, // the name, inside the same window
  bridge: 26, // back into the tab: round 1, frame 0 (the loop)
});

/** Twist: camera out to the whole window, then in on its header; the second line and Big Yahu. */
export const TWIST = { out: [0, 18], hold: 30, in: [30, 54], line2: 54 } as const;
