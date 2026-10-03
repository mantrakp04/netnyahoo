// The signature: two-finger swipes between profiles in the sidebar, fed step by step through the real gesture
// tracker (nnSwipe.sidebar(W).devSimulate), one snapshot per step, so every film frame is a real frame of the pager.
// Personal → Work → Campaign → Side Project → Weekend, slowly; then back to Personal, one page at a time.
const sw = globalThis.nnSwipe.sidebar(W);
const step = (steps) => Promise.resolve(sw.devSimulate(steps, { ignorePreference: true }));
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
// The pager's own position (in pages) at each frame, so the film can slide the page exactly with the sidebar.
const pos = () => { const st8 = globalThis.expo.modules.NetnyahooSwipe.pagerState(W); return st8 ? st8.position : null; };
const swipe = (name, dir, n) => {
  let from;
  then(() => { from = pos(); return step([{ phase: "began", dx: 0 }]); });
  // The tracker moves the pager about half a page per sidebar width dragged: drag far enough that the pager is nearly
  // home before the release, so the film's slide has frames all the way to the commit.
  const total = dir * WIDTH * 1.9;
  // Hermes' eval shares one binding across a for-let loop's closures: forEach gives each step its own i.
  Array.from({ length: n }, (_, i) => i).forEach((i) => {
    const dx = (ease((i + 1) / n) - ease(i / n)) * total;
    then(() => step([{ phase: "changed", dx, delayMs: 8 }]).then(() => snap(name, { p: (i + 1) / n, dir, pos: pos(), from })));
  });
  then(() => step([{ phase: "ended", dx: 0 }]));
  [0, 1, 2, 3, 4, 5].forEach(() => then(() => sleep(60).then(() => snap(name + ":settle", { dir, pos: pos(), from }))));
  // A page just shown again repaints in stages: wait, and keep the second picture.
  then(() => sleep(2200).then(() => picShown(name)).then(() => sleep(600)).then(() => picShown(name)).then(() => snap(name + ":rest", { pageKey: Object.fromEntries(shownTabs().map((id) => [id, name + ":" + id])) })));
};
// Side Project shows the TypeScript handbook (Tailwind's paints too late after a swipe to be captured).
then(() => { unsplit(); return goProfile("side"); });
then(() => { st().activate("t21"); return sleep(3000); });
// Every profile's page once before the take (a page first shown by a swipe in a hidden instance can stay unpainted
// for a while): a "pre" frame each, whose picture the compositor reuses for that tab.
// The Grand Canyon page's newsletter popup is dismissed first ("No Thanks"), as a reader would.
const dismiss = (id) => { const h = nn.webviews.get(id); return Promise.resolve(h && h.executeJavaScript("[...document.querySelectorAll('button,a')].filter(e=>/no thanks/i.test(e.textContent)).forEach(e=>e.click())")); };
["work", "campaign", "side", "weekend"].forEach((pid) => then(() => goProfile(pid).then(() => sleep(2500)).then(() => dismiss(activeTab())).then(() => sleep(800)).then(() => picShown("pre-" + pid)).then(() => snap("pre:" + pid, { pageKey: Object.fromEntries(shownTabs().map((id) => [id, "pre-" + pid + ":" + id])) }))));
then(() => goProfile("default"));
then(() => { st().activate("t1"); return sleep(2500).then(() => picShown("start")).then(() => snap("start", { pageKey: { t1: "start:t1" } })); });
swipe("toWork", -1, 24);
swipe("toCampaign", -1, 24);
swipe("toSide", -1, 24);
swipe("toWeekend", -1, 24);
swipe("backToSide", 1, 14);
swipe("backToCampaign", 1, 14);
swipe("backToWork", 1, 14);
swipe("backToPersonal", 1, 14);
return finish();
