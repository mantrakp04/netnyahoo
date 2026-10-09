// Shared by every scene (scenes/*.js), run inside a hidden DEV instance through the dev harness.
// Hermes' eval: no async functions, so scenes are promise chains.
const OUT = "__OUT__";
const st = () => ac.store.getState();
const W = st().windowOrder[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = [];
const pages = {};
let seq = 0;
const win = () => st().windows[W];
const activeTab = () => win().activeTabIds[win().profileId];
const splitOf = (id) => Object.values(st().splits || {}).find((s) => s.tabIds.indexOf(id) >= 0);
const shownTabs = () => {
  const id = activeTab();
  const sp = splitOf(id);
  return sp ? sp.tabIds : id ? [id] : [];
};
const tabBy = (m) => Object.values(st().tabs).find((t) => t.url && t.url.indexOf(m) >= 0);
// One snapshot of the window's own layers (2x, transparent where Metal draws), with what it showed.
const snap = (label, extra) => {
  const f = OUT + "/" + String(seq++).padStart(4, "0") + ".png";
  const t = Date.now();
  return Promise.resolve(ac.shell.devSnapshotWindow(W, f, true)).then((ok) => {
    frames.push(Object.assign({ f, label, ok, t, profile: win().profileId, tabs: shownTabs(), color: (st().profiles[win().profileId] || {}).color, dark: !!st().ui.appDark }, extra || {}));
  });
};
const snapFor = (label, ms) => { const end = Date.now() + ms; const loop = () => (Date.now() > end ? Promise.resolve() : snap(label).then(loop)); return loop(); };
// The page as painted (a JPEG) and its frame in the window, per tab; kept under a key so a scene can capture a tab twice.
const pic = (tabId, key, tries) => {
  const h = ac.webviews.get(tabId);
  const left = tries === undefined ? 4 : tries;
  const retry = () => (left > 0 ? sleep(500).then(() => pic(tabId, key, left - 1)) : null);
  if (!h) return Promise.resolve(retry());
  return h.capturePicture(2).then((p) => { if (p) { pages[key || tabId] = p; return p; } return retry(); });
};
const picShown = (key) => shownTabs().reduce((c, id) => c.then(() => pic(id, key ? key + ":" + id : id)), Promise.resolve());
let chain = Promise.resolve();
const then = (fn) => { chain = chain.then(fn); };
const finish = (extra) => chain.then(() => JSON.stringify(Object.assign({ frames, pages, window: win().frame }, extra || {})));
// Profiles change through the real swipe (programmatic switches leave the pager's model layers mid-move, which the
// in-process snapshot shows as two pages on top of each other).
const WIDTH = 190;
const goProfile = (pid) => {
  const order = st().profileOrder;
  const from = order.indexOf(win().profileId);
  const to = order.indexOf(pid);
  if (from === to || to < 0) return Promise.resolve();
  const dir = to > from ? -1 : 1;
  const area = globalThis.acSwipe.sidebar(W);
  const step = (steps) => Promise.resolve(area.devSimulate(steps, { ignorePreference: true }));
  let c = Promise.resolve();
  Array.from({ length: Math.abs(to - from) }, (_, k) => k).forEach(() => {
    c = c.then(() => step([{ phase: "began", dx: 0 }]));
    [0, 1, 2, 3, 4, 5, 6, 7].forEach(() => { c = c.then(() => step([{ phase: "changed", dx: (dir * WIDTH * 1.02) / 8, delayMs: 8 }])); });
    c = c.then(() => step([{ phase: "ended", dx: 0 }])).then(() => sleep(700));
  });
  return c;
};
const unsplit = () => Object.values(st().splits || {}).forEach((s) => st().separateSplit(s.id));
// Another window (settings, import): its own snapshot, with no page in it.
const snapWin = (id, label, extra) => {
  const f = OUT + "/" + String(seq++).padStart(4, "0") + ".png";
  return Promise.resolve(ac.shell.devSnapshotWindow(id, f, true)).then((ok) => { frames.push(Object.assign({ f, label, ok, t: Date.now(), tabs: [], window: id, dark: !!st().ui.appDark }, extra || {})); });
};
// Live: page pictures and window snapshots together, as fast as they come, for `ms` (a reload, a counter rising).
let live = 0;
const snapLive = (label, ms) => {
  const end = Date.now() + ms;
  const loop = () => {
    if (Date.now() > end) return Promise.resolve();
    const key = "live" + live++;
    return picShown(key).then(() => snap(label, { pageKey: Object.fromEntries(shownTabs().map((id) => [id, key + ":" + id])) })).then(loop);
  };
  return loop();
};
// React's fibers, for driving a control through its own handler (the Studio-free way to "click" a switch).
const fibers = (from, pred) => { const out = []; const stack = [from]; while (stack.length) { const f = stack.pop(); if (!f) continue; if (pred(f)) out.push(f); if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling); } return out; };
const roots = () => [...globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__.getFiberRoots(1)];
// React Native's Animated, so a scene can slow an animation down for the 5-a-second snapshots and restore it.
const animated = () => { const mods = __r.getModules(); return __r(Number((mods instanceof Map ? [...mods.entries()] : Object.entries(mods)).find(([, m]) => /Libraries\/Animated\/Animated\.js$/.test(m.verboseName || ""))[0])).default; };
