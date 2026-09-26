const P = nn.store.getState().profileOrder[1];
const sw = globalThis.nnSwipe.sidebar(W);
const step = (steps) => sw.devSimulate(steps, { ignorePreference: true });
// An eased two-finger drag: 28 steps, total ≈ 230 pt, fastest in the middle.
const N = 40; const total = 420;
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
const dxs = Array.from({ length: N }, (_, i) => -(ease((i + 1) / N) - ease(i / N)) * total);
let chain = snapFor("swipe", "start", 300).then(() => step([{ phase: "began", dx: 0 }]));
dxs.forEach((dx, i) => { chain = chain.then(() => step([{ phase: "changed", dx, delayMs: 16 }])).then(() => snap("swipe", "drag" + i)); });
return chain.then(() => step([{ phase: "ended", dx: 0 }])).then(() => snapFor("swipe", "settle", 1600))
  .then(() => JSON.stringify({ log, profile: nn.store.getState().windows[W].profileId }));
