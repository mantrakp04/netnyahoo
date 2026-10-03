// The signature: two-finger swipes between profiles in the sidebar, fed step by step through the real gesture
// tracker (nnSwipe.sidebar(W).devSimulate), one snapshot per step, so every film frame is a real frame of the pager.
// Personal → Work → Campaign, then back to Personal in one long swipe right.
const sw = globalThis.nnSwipe.sidebar(W);
const step = (steps) => Promise.resolve(sw.devSimulate(steps, { ignorePreference: true }));
const WIDTH = 190; // the sidebar, in points: one page
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
const swipe = (name, dir, n, pages) => {
  then(() => step([{ phase: "began", dx: 0 }]));
  const total = dir * WIDTH * pages * 1.02;
  // Hermes' eval shares one binding across a for-let loop's closures: forEach gives each step its own i.
  Array.from({ length: n }, (_, i) => i).forEach((i) => {
    const dx = (ease((i + 1) / n) - ease(i / n)) * total;
    then(() => step([{ phase: "changed", dx, delayMs: 8 }]).then(() => snap(name, { p: (i + 1) / n, dir })));
  });
  then(() => step([{ phase: "ended", dx: 0 }]));
  [0, 1, 2, 3, 4, 5].forEach(() => then(() => sleep(60).then(() => snap(name + ":settle"))));
  then(() => sleep(900).then(() => snap(name + ":rest")).then(() => picShown()));
};
then(() => { st().switchProfile(W, "default"); st().activate("t1"); return sleep(1500).then(() => picShown()).then(() => snap("start")); });
swipe("toWork", -1, 24, 1);
swipe("toCampaign", -1, 24, 1);
swipe("backToWork", 1, 16, 1);
swipe("backToPersonal", 1, 16, 1);
return finish();
