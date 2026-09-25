// Injected before the game loads: a clock the capture script steps by hand (rAF, performance.now,
// setTimeout and CSS animations all follow it), so each captured frame is exactly 1/30 s apart.
(() => {
  let manual = false, vt = 0, rafs = [], tid = 1e6;
  const timers = new Map(), anims = new Map();
  const rN = performance.now.bind(performance), rRAF = requestAnimationFrame.bind(window);
  const rST = setTimeout.bind(window), rCT = clearTimeout.bind(window);
  performance.now = () => (manual ? vt : rN());
  window.requestAnimationFrame = (cb) => {
    if (manual) { rafs.push(cb); return 0; }
    return rRAF(() => (manual ? rafs.push(cb) : cb(rN())));
  };
  window.setTimeout = (fn, ms = 0, ...a) => {
    if (!manual) return rST(fn, ms, ...a);
    const id = ++tid;
    timers.set(id, { at: vt + ms, fn: () => fn(...a) });
    return id;
  };
  window.clearTimeout = (id) => { if (timers.has(id)) timers.delete(id); else rCT(id); };
  window.__clock = {
    /** Freezes real time; resolves once the page's pending animation frame has moved onto this clock. */
    enter() {
      vt = rN();
      manual = true;
      return new Promise((res) => rRAF(() => rRAF(res)));
    },
    step(ms) {
      vt += ms;
      for (const [id, t] of [...timers]) if (t.at <= vt) { timers.delete(id); t.fn(); }
      const c = rafs; rafs = []; c.forEach((f) => f(vt));
      for (const a of document.getAnimations()) {
        if (!anims.has(a)) anims.set(a, vt - (a.currentTime || 0));
        a.pause();
        a.currentTime = vt - anims.get(a);
      }
      return vt;
    },
  };
})();
