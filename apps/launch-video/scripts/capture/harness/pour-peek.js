// "Pour": Focus mode. ⌘S hides the sidebar (the page takes the window); the sidebar's peek then slides in over
// the page and away again, in slow motion: React Native's Animated.timing is slowed SLOW times for this run only
// (the peek's own 180 ms eased slide, sampled as fast as the snapshot hook allows), then restored.
// The peek is driven through its own onMouseEnter / onMouseLeave handlers (found in the fiber tree), since a
// hidden test instance has no pointer.
const DIR = "pour-peek";
const SLOW = 40;
const mods = __r.getModules();
const A = __r(Number((mods instanceof Map ? [...mods.entries()] : Object.entries(mods)).find(([, m]) => /Libraries\/Animated\/Animated\.js$/.test(m.verboseName || ""))[0])).default;
const timing = A.timing;
A.timing = (v, cfg) => timing(v, { ...cfg, duration: (cfg.duration || 0) * SLOW });
const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const fibers = (from, pred) => { const out = []; const st = [from]; while (st.length) { const f = st.pop(); if (!f) continue; if (pred(f)) out.push(f); if (f.child) st.push(f.child); if (f.sibling) st.push(f.sibling); } return out; };
const peek = () => [...hook.getFiberRoots(1)].flatMap((r) => fibers(r.current, (f) => f.type && f.type.name === "SidebarPeek"))[0];
const handler = (name) => { const p = peek(); const hosts = fibers(p.child, (f) => typeof f.type === "string" && f.memoizedProps && f.memoizedProps[name]); return hosts[name === "onMouseEnter" ? hosts.length - 1 : 0].memoizedProps[name]; };
const s = nn.store.getState();
if (!s.windows[W].sidebarOpen) s.toggleSidebar(W);
return sleep(800).then(() => snap(DIR, "docked"))
  .then(() => { log.push({ hideSidebar: Date.now() }); nn.store.getState().toggleSidebar(W); return sleep(1200).then(() => snap(DIR, "hidden")); })
  .then(() => { log.push({ peekIn: Date.now() }); handler("onMouseEnter")({}); return snapFor(DIR, "in", 180 * SLOW + 700); })
  .then(() => { log.push({ peekOut: Date.now() }); handler("onMouseLeave")({}); return snapFor(DIR, "out", 120 + 180 * SLOW + 900); })
  .then(() => snap(DIR, "after"))
  .then(() => JSON.stringify({ log, SLOW }))
  .finally(() => { A.timing = timing; });
