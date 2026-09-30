// Runs the real ProfilePager (src/components/layout/profilePager.ts) with only its dependencies mocked:
// a settle queued behind a pending rebase must not start once a new drag has halted it.
// Usage: node apps/browser/scripts/profile-pager-race-test.mjs [--source=<profilePager.ts>]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../src/components/layout/", import.meta.url);
const sourceArg = process.argv.find((a) => a.startsWith("--source="))?.split("=")[1];
const source = sourceArg ? pathToFileURL(resolve(sourceArg)).href : new URL("profilePager.ts", root).href;

// Deterministic timers: the pager's linger and rebase run only when the test advances time.
let now = 0;
let timers = [];
globalThis.setTimeout = (fn, ms = 0) => {
  const t = { fn, at: now + ms, id: Symbol() };
  timers.push(t);
  return t.id;
};
globalThis.clearTimeout = (id) => void (timers = timers.filter((t) => t.id !== id));
globalThis.requestAnimationFrame = (fn) => globalThis.setTimeout(fn, 16);
function advance(ms) {
  const end = now + ms;
  for (;;) {
    const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    timers = timers.filter((t) => t !== due);
    now = due.at;
    due.fn();
  }
  now = end;
}

// Animated: springs are recorded when started and finish only when the test runs them.
const springs = [];
class Value {
  constructor(v) { this.v = v; this.listeners = []; }
  setValue(v) { this.v = v; this.listeners.forEach((l) => l({ value: v })); }
  addListener(l) { this.listeners.push(l); }
  stopAnimation() { springs.filter((s) => s.value === this && s.running).forEach((s) => { s.running = false; s.done?.({ finished: false }); }); }
}
const Animated = {
  Value,
  spring: (value, config) => ({
    start(done) { springs.push({ value, toValue: config.toValue, running: true, done, startedAt: now }); },
  }),
  multiply: () => ({}),
  add: () => ({}),
};
function runSpring(s) {
  s.running = false;
  s.value.setValue(s.toValue);
  s.done?.({ finished: true });
}

function createStore(init) {
  let state;
  const listeners = new Set();
  const api = {
    getState: () => state,
    setState: (patch) => {
      const prev = state;
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      listeners.forEach((l) => l(state, prev));
    },
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
  };
  state = init(api.setState, api.getState);
  return Object.assign(() => state, api);
}
const useBrowser = createStore((set, get) => ({
  windows: { w1: { profileId: "a", incognito: false, activeTabIds: {} } },
  profileOrder: ["a", "b"],
  profiles: { a: {}, b: {} },
  tabs: {},
  switchProfile: (windowId, profileId) => set({ windows: { ...get().windows, [windowId]: { ...get().windows[windowId], profileId } } }),
}));
globalThis.__pagerMocks = {
  Animated,
  unstable_batchedUpdates: (f) => f(),
  create: (init) => createStore(init),
  useBrowser,
  swipeHaptic: () => {},
};

const stub = (names) => `data:text/javascript,${encodeURIComponent(names.map((n) => `export const ${n} = globalThis.__pagerMocks.${n};`).join("\n") + "\nexport const useEffect = () => {}, useLayoutEffect = () => {}, useMemo = (f) => f();")}`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "react-native") return { url: stub(["Animated", "unstable_batchedUpdates"]), shortCircuit: true };
    if (specifier === "react") return { url: stub([]), shortCircuit: true };
    if (specifier === "zustand") return { url: stub(["create"]), shortCircuit: true };
    if (specifier === "@netnyahoo/cef") return { url: stub(["swipeHaptic"]), shortCircuit: true };
    if (specifier.endsWith("/store/browser")) return { url: stub(["useBrowser"]), shortCircuit: true };
    // The real motion math, wherever --source lives.
    if (specifier === "./swipeMotion") return { url: new URL("swipeMotion.ts", root).href, shortCircuit: true };
    return next(specifier, context);
  },
});

// Node's type stripping rejects parameter properties, so the real sources are transpiled as they are.
const ts = createRequire(new URL("../../../package.json", import.meta.url))("typescript");
registerHooks({
  load(url, context, next) {
    if (!url.startsWith("file:") || !url.endsWith(".ts")) return next(url, context);
    const { outputText } = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});

globalThis.__DEV__ = false;
const { pagerFor } = await import(source);
const pager = pagerFor("w1");
const profile = () => useBrowser.getState().windows.w1.profileId;
const running = () => springs.filter((s) => s.running);
const swipe = (phase, direction, distance, velocity) => ({ phase, direction, distance, velocity, dy: 0, available: true, width: 190 });
function gesture(direction, distance, velocity) {
  pager.beginDrag();
  pager.track(swipe("began", direction, 8, 0));
  pager.track(swipe("changed", direction, distance, velocity));
  pager.release(swipe("ended", direction, distance, velocity), false);
}

// The sidebar surface is mounted, so arrange() leaves the rebase to applyShift (the layout effect in the app).
pager.attach();

// 1. Forward flick settles on b; the linger then ends the session and rebases by one page (a pending shift).
gesture("forward", 120, 3000);
assert.equal(running().length, 1, "first release starts its spring");
runSpring(running()[0]);
assert.equal(profile(), "b", "first swipe switches to b");
advance(150);
assert.ok(pager.shift, "end() leaves a rebase pending");

// 2. Back flick inside the rebase window: its settle is queued behind the shift, not started.
const before = springs.length;
gesture("back", 120, 3000);
assert.equal(springs.length, before, "settle is queued while the shift is pending");
assert.equal(pager.afterShift.length, 1, "one queued settle");

// 3. A new drag starts before the shift applies; then the layout effect applies it.
pager.beginDrag();
pager.applyShift();
const stale = springs.slice(before);
assert.deepEqual(stale.map((s) => s.toValue), [], `the halted settle must not start during the new drag (started: ${JSON.stringify(stale.map((s) => s.toValue))})`);

// 4. The new drag still releases and settles normally: a back flick lands on a.
pager.track(swipe("began", "back", 8, 0));
pager.track(swipe("changed", "back", 120, 3000));
pager.release(swipe("ended", "back", 120, 3000), false);
assert.equal(running().length, 1, "the new release starts exactly one spring");
const settle = running()[0];
runSpring(settle);
assert.equal(profile(), "a", "the new release switches back to a");
advance(1000);
assert.equal(running().length, 0, "nothing left animating");
assert.equal(profile(), "a", "no stale settle switches afterwards");
console.log(`PASS queued settle is dropped after a new drag (${sourceArg ?? "src/components/layout/profilePager.ts"})`);
