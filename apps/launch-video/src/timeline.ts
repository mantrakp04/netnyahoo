// Frame numbers (30 fps) for every beat.
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

export const PLEDGE_LEN = 60;

export const { beats: B, total: TOTAL } = seq({
  opener: 75, // the window, live: "Full immunity."
  toolbar: 84, // pledge 1: the toolbar folds into the sidebar
  pledges: PLEDGE_LEN * 4, // pledges 2–5 on real window captures
  offline: 54, // the Wi-Fi dies: "Chrome gives you a dinosaur."
  find: 54, // into the tab: "Find him." on the game's own clock
  cta: 84, // Big Yahu comes up out of the crowd; "Impeach Chrome."
  bridge: 26, // back out to the opener (the loop)
});

/** Round 1's clock (capture-game.mjs): 3.0 on frame 0. */
export const R1_CLOCK = 3.02;
