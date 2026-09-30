// Runs the real ProfilePager (src/components/layout/profilePager.ts) with only its dependencies mocked,
// through the handoffs between native-driven settles and new input.
// Usage: node apps/browser/scripts/profile-pager-race-test.mjs [--source=<profilePager.ts>] [--only=<name substring>]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../src/components/layout/", import.meta.url);
const sourceArg = process.argv.find((a) => a.startsWith("--source="))?.split("=")[1];
const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const source = sourceArg ? pathToFileURL(resolve(sourceArg)).href : new URL("profilePager.ts", root).href;

// Deterministic timers: the pager's linger, rebase, warm-up and frame callbacks run only when the test advances time.
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

// Animated, as the native driver behaves: a native spring moves the value without calling JS listeners,
// and its completion and stopAnimation's snapshot reach JS later, when the test flushes the bridge.
const springs = [];
let bridge = [];
const flushBridge = () => {
  while (bridge.length) bridge.shift()();
};
class Value {
  constructor(v, config) {
    this.v = v;
    this.native = !!config?.useNativeDriver;
    this.listeners = [];
    this.writes = [];
    this.snapshots = 0;
  }
  setValue(v) {
    this.stopRunning();
    this.v = v;
    this.writes.push(v);
    this.listeners.forEach((l) => l({ value: v }));
  }
  addListener(l) { this.listeners.push(l); }
  stopRunning() {
    for (const s of springs.filter((s) => s.value === this && s.running)) {
      s.running = false;
      if (s.native) bridge.push(() => s.done?.({ finished: false }));
      else s.done?.({ finished: false });
    }
  }
  stopAnimation(callback) {
    this.stopRunning();
    if (!callback) return;
    this.snapshots++;
    const at = this.v;
    if (this.native) bridge.push(() => callback(at));
    else callback(at);
  }
}
const Animated = {
  Value,
  spring: (value, config) => ({
    start(done) {
      springs.push({ value, toValue: config.toValue, native: !!config.useNativeDriver, running: true, done });
    },
  }),
  multiply: () => ({}),
  add: () => ({}),
};
// Moves a running spring; a JS-driven one calls listeners each frame, a native one does not.
function progress(s, x) {
  s.value.v = x;
  if (!s.native) s.value.listeners.forEach((l) => l({ value: x }));
}
// Lands a spring; a native completion is queued on the bridge until flushed.
function land(s) {
  s.running = false;
  progress(s, s.toValue);
  if (s.native) bridge.push(() => s.done?.({ finished: true }));
  else s.done?.({ finished: true });
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
const windowIds = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9"];
const useBrowser = createStore((set, get) => ({
  windows: Object.fromEntries(windowIds.map((id) => [id, { profileId: "a", incognito: false, activeTabIds: {} }])),
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
const { PAGING_TRACKING_SCALE } = await import(new URL("swipeMotion.ts", root).href);
const WIDTH = 190;
const profile = (w) => useBrowser.getState().windows[w].profileId;
const swipe = (phase, direction, distance, velocity) => ({ phase, direction, distance, velocity, dy: 0, available: true, width: WIDTH });
const running = (pager) => springs.filter((s) => s.value === pager.pos && s.running);
const started = (pager) => springs.filter((s) => s.value === pager.pos);
const close = (a, b) => Math.abs(a - b) < 1e-9;
function fresh(windowId) {
  const pager = pagerFor(windowId);
  // The sidebar surface is mounted, so arrange() leaves a rebase to applyShift (the layout effect in the app).
  const detach = pager.attach();
  return { pager, detach };
}
function gesture(pager, direction, distance, velocity) {
  pager.beginDrag();
  pager.track(swipe("began", direction, 8, 0));
  pager.track(swipe("changed", direction, distance, velocity));
  pager.release(swipe("ended", direction, distance, velocity), false);
}
// A forward flick whose native spring is left running at `at`, headed for b.
function midSettle(pager, at) {
  gesture(pager, "forward", 120, 3000);
  const [spring] = running(pager);
  assert.ok(spring, "the flick starts a spring");
  progress(spring, at);
  return spring;
}

const failures = [];
let passed = 0;
function test(name, fn) {
  if (only && !name.includes(only)) return;
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error.message.split("\n")[0]}`);
  }
}

test("the position and every settle use the native driver", () => {
  const { pager } = fresh("w1");
  assert.equal(pager.pos.native, true, "the pager's value should be native from mount");
  midSettle(pager, 0.2);
  assert.ok(started(pager).every((s) => s.native), "every settle spring should use the native driver");
});

test("a settle queued behind a pending rebase is dropped by a new drag", () => {
  const { pager } = fresh("w2");
  gesture(pager, "forward", 120, 3000);
  land(running(pager)[0]);
  flushBridge();
  assert.equal(profile("w2"), "b", "the landed spring commits b");
  advance(150);
  assert.ok(pager.shift, "end() leaves a rebase pending");
  const before = started(pager).length;
  gesture(pager, "back", 120, 3000);
  assert.equal(started(pager).length, before, "settle is queued while the shift is pending");
  assert.equal(pager.afterShift.length, 1, "one queued settle");
  pager.beginDrag();
  pager.applyShift();
  assert.equal(started(pager).length, before, "the halted settle must not start during the new drag");
  pager.track(swipe("changed", "back", 120, 3000));
  pager.release(swipe("ended", "back", 120, 3000), false);
  assert.equal(running(pager).length, 1, "the new release starts exactly one spring");
  land(running(pager)[0]);
  flushBridge();
  assert.equal(profile("w2"), "a", "the new release switches back to a");
  advance(1000);
  assert.equal(profile("w2"), "a", "no stale settle switches afterwards");
});

test("interrupting a native settle starts from the exact stopped position with buffered input", () => {
  const { pager } = fresh("w3");
  const first = midSettle(pager, 0.6);
  const writes = pager.pos.writes.length;
  pager.beginDrag();
  pager.track(swipe("began", "back", 8, 0));
  pager.track(swipe("changed", "back", 40, 0));
  pager.track(swipe("changed", "back", 60, 0));
  pager.release(swipe("ended", "back", 60, 1500), false);
  assert.equal(pager.pos.snapshots, 1, "the stop asks native for its position");
  assert.equal(pager.pos.writes.length, writes, "nothing moves before the snapshot");
  assert.equal(started(pager).length, 1, "no spring before the snapshot");
  flushBridge();
  const x = 0.6 - (60 * PAGING_TRACKING_SCALE) / WIDTH;
  assert.ok(close(pager.pos.writes.at(-1), x), `the drag continues from 0.6 with the latest cumulative distance (${pager.pos.writes.at(-1)} vs ${x})`);
  const [back] = running(pager);
  assert.ok(back && back !== first && back.toValue === 0, "the buffered back flick settles on a");
  land(back);
  flushBridge();
  assert.equal(profile("w3"), "a", "the interrupted target b is never committed");
});

test("a double reversal before any snapshot uses only the newest one", () => {
  const { pager } = fresh("w4");
  midSettle(pager, 0.5);
  pager.beginDrag();
  pager.track(swipe("changed", "back", 50, 0));
  pager.release(swipe("ended", "back", 50, 2000), false);
  pager.beginDrag();
  assert.equal(pager.pos.snapshots, 2, "the second stop still asks for its own snapshot");
  pager.track(swipe("changed", "forward", 100, 0));
  pager.release(swipe("ended", "forward", 100, 2500), false);
  flushBridge();
  const x = 0.5 + (100 * PAGING_TRACKING_SCALE) / WIDTH;
  assert.ok(close(pager.pos.writes.at(-1), x), "only the newest drag is applied");
  const settles = running(pager);
  assert.equal(settles.length, 1, "exactly one new spring");
  assert.equal(settles[0].toValue, 1, "the newest flick settles on b");
  land(settles[0]);
  flushBridge();
  assert.equal(profile("w4"), "b");
});

test("a rebase while the snapshot is pending waits for it", () => {
  const { pager } = fresh("w5");
  gesture(pager, "forward", 120, 3000);
  land(running(pager)[0]);
  flushBridge();
  assert.equal(profile("w5"), "b");
  gesture(pager, "back", 20, 0);
  const [spring] = running(pager);
  assert.ok(spring, "a slow back swipe settles home on b");
  progress(spring, 0.8);
  pager.beginDrag();
  // Harness control: a rebase landing while the snapshot is pending, as end() would make it.
  pager.rebase(1);
  pager.state.setState({ pages: null });
  const writes = pager.pos.writes.length;
  pager.applyShift();
  assert.equal(pager.pos.writes.length, writes, "applyShift must wait for the snapshot");
  flushBridge();
  assert.ok(close(pager.pos.writes[writes], -0.2), `the rebase applies to the snapshot first (${pager.pos.writes[writes]})`);
  assert.equal(pager.shift, 0);
  pager.release(swipe("ended", "back", 0, 0), true);
  const [home] = running(pager);
  assert.equal(home?.toValue, 0, "the cancelled drag settles on b's rebased slot");
  land(home);
  flushBridge();
  assert.equal(profile("w5"), "b");
});

test("a completion queued before the stop does not commit its target", () => {
  const { pager } = fresh("w6");
  const spring = midSettle(pager, 0.9);
  land(spring);
  pager.beginDrag();
  flushBridge();
  assert.equal(profile("w6"), "a", "the stale completion must not commit b");
  pager.release(swipe("ended", "forward", 0, 0), true);
  land(running(pager)[0]);
  flushBridge();
  assert.equal(profile("w6"), "a");
});

test("a click interrupts a native settle from its stopped position", () => {
  const { pager } = fresh("w7");
  midSettle(pager, 0.5);
  const writes = pager.pos.writes.length;
  pager.switchTo("a");
  assert.equal(profile("w7"), "b", "the click commits the pending target first");
  flushBridge();
  assert.equal(pager.pos.writes.length, writes, "no jump before the click's settle");
  advance(16);
  const [back] = running(pager);
  assert.equal(back?.toValue, 0, "the click settles on a from where the spring stopped");
  assert.equal(profile("w7"), "a", "a New Tab profile commits at once");
  land(back);
  flushBridge();
  assert.equal(profile("w7"), "a");
});

test("a click back to the current profile cancels a pending click", () => {
  const { pager } = fresh("w9");
  gesture(pager, "forward", 120, 3000);
  land(running(pager)[0]);
  flushBridge();
  assert.equal(profile("w9"), "b");
  gesture(pager, "back", 20, 0);
  const [home] = running(pager);
  assert.ok(home, "a slow back swipe settles home on b");
  progress(home, 0.8);
  const writes = pager.pos.writes.length;
  const before = started(pager).length;
  pager.switchTo("a");
  pager.switchTo("b");
  flushBridge();
  advance(16);
  assert.equal(profile("w9"), "b", "the superseded click to a never commits");
  assert.equal(pager.pos.writes.length, writes, "no jump from the stopped position");
  const settles = started(pager).slice(before);
  assert.equal(settles.length, 1, "only the newest click starts a spring");
  assert.equal(settles[0].toValue, pager.slotOf("b"), "the newest click settles home on b");
  assert.equal(pager.pos.snapshots, 2, "the second click supersedes the first with its own stop");
  land(settles[0]);
  flushBridge();
  advance(1000);
  assert.equal(profile("w9"), "b");
  assert.equal(running(pager).length, 0);
});

test("reset and dispose ignore late callbacks", () => {
  const { pager, detach } = fresh("w8");
  const spring = midSettle(pager, 0.4);
  pager.beginDrag();
  pager.release(swipe("ended", "forward", 0, 3000), false);
  land(spring);
  detach();
  assert.equal(pager.pos.writes.at(-1), 0, "reset writes 0");
  const writes = pager.pos.writes.length;
  flushBridge();
  advance(1000);
  assert.equal(pager.pos.writes.length, writes, "late snapshots and completions do nothing");
  assert.equal(running(pager).length, 0);
  assert.equal(profile("w8"), "a");
  pager.attach();
  midSettle(pager, 0.3);
  pager.beginDrag();
  useBrowser.setState({ windows: Object.fromEntries(Object.entries(useBrowser.getState().windows).filter(([id]) => id !== "w8")) });
  flushBridge();
  advance(1000);
  assert.equal(running(pager).length, 0, "a disposed pager starts nothing");
  assert.notEqual(pagerFor("w8"), pager, "dispose forgets the pager");
});

console.log(`${failures.length ? "FAIL" : "PASS"} ${passed}/${passed + failures.length} cases (${sourceArg ?? "src/components/layout/profilePager.ts"})`);
process.exitCode = failures.length ? 1 : 0;
