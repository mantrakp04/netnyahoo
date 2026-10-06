// Per-tab store reads (store/tabWatch.ts): a watcher wakes only for its own tab's changes, and a snapshot stays the
// same value while its tab does.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("./browser.ts");
const { watchTab, watchedTabs, tabSnapshot, shallowEqual } = await import("./tabWatch.ts");

const S = () => useBrowser.getState();
const setup = () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "https://b.com", background: true });
  return { w, a, b };
};

test("a watcher wakes for its tab's changes only", () => {
  const { a, b } = setup();
  const woke = { a: 0, b: 0 };
  const offA = watchTab(a, () => woke.a++);
  const offB = watchTab(b, () => woke.b++);
  S().updateTab(a, { title: "A" });
  assert.deepEqual(woke, { a: 1, b: 0 });
  S().updateLive(b, { isLoading: true });
  assert.deepEqual(woke, { a: 1, b: 0 }, "live state isn't the tab");
  S().updateTab(b, { title: "B" });
  assert.deepEqual(woke, { a: 1, b: 1 });
  S().updateSettings({ bookmarksBar: "always" });
  assert.deepEqual(woke, { a: 1, b: 1 }, "other keys don't wake it");
  offA();
  S().updateTab(a, { title: "A2" });
  assert.equal(woke.a, 1, "unsubscribed");
  offB();
  assert.equal(watchedTabs(), 0, "nothing left behind");
});

test("closing a watched tab wakes it; several watchers of one tab all wake", () => {
  const { a, b } = setup();
  const woke = [];
  const offs = [watchTab(b, () => woke.push(1)), watchTab(b, () => woke.push(2)), watchTab(a, () => woke.push("a"))];
  S().closeTab(b);
  assert.deepEqual(woke.filter((x) => x !== "a").sort(), [1, 2]);
  for (const off of offs) off();
  assert.equal(watchedTabs(), 0);
});

test("a watcher that unsubscribes another while waking doesn't break the loop", () => {
  const { a } = setup();
  const woke = [];
  let offSecond = () => {};
  const offFirst = watchTab(a, () => {
    woke.push(1);
    offSecond();
  });
  offSecond = watchTab(a, () => woke.push(2));
  S().updateTab(a, { title: "x" });
  assert.deepEqual(woke, [1, 2], "the listeners of one update are the ones there when it started");
  S().updateTab(a, { title: "y" });
  assert.deepEqual(woke, [1, 2, 1]);
  offFirst();
});

test("a snapshot keeps its value while the tab object is the same, and an equal value across changes", () => {
  const { a } = setup();
  let calls = 0;
  const get = tabSnapshot(
    a,
    (t) => {
      calls++;
      return { url: t?.url, zoom: t?.zoom ?? 1 };
    },
    shallowEqual,
  );
  const first = get();
  assert.equal(get(), first);
  assert.equal(calls, 1, "the same tab isn't selected again");
  S().updateTab(a, { title: "new title" });
  const second = get();
  assert.equal(second, first, "an equal value is the same snapshot");
  assert.equal(calls, 2);
  S().updateTab(a, { zoom: 1.25 });
  const third = get();
  assert.notEqual(third, first);
  assert.equal(third.zoom, 1.25);
  S().closeTab(a);
  assert.equal(get().url, undefined, "a closed tab reads as missing");
});

// MARK: keyedWatch, memoRead and the tab state watcher (the sidebar rows' reads)

const { keyedWatch, memoRead, watchTabState, watchedTabStates, liveWatch } = await import("./tabWatch.ts");

const manyTabs = (n) => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://t0.com" });
  const ids = [S().windows[w].tabIds[0]];
  for (let i = 1; i < n; i++) ids.push(S().newTab(w, { url: `https://t${i}.com`, background: true }));
  S().activate(ids[0]);
  return { w, ids };
};

test("keyedWatch: one store listener, a listener per key woken only when its key changed", () => {
  const store = { state: { items: { a: 1, b: 1 }, other: 0 }, listeners: new Set() };
  const readable = {
    getState: () => store.state,
    subscribe: (l) => (store.listeners.add(l), () => store.listeners.delete(l)),
  };
  const set = (patch) => {
    const prev = store.state;
    store.state = { ...prev, ...patch };
    for (const l of [...store.listeners]) l(store.state, prev);
  };
  let anyChecks = 0;
  const w = keyedWatch(
    readable,
    (k, s, prev) => s.items[k] !== prev.items[k],
    (s, prev) => (anyChecks++, s.items !== prev.items),
  );
  const woke = [];
  const offs = ["a", "b", "b"].map((k, i) => w.watch(k, () => woke.push(`${k}${i}`)));
  assert.equal(store.listeners.size, 1, "one listener however many watchers");
  set({ other: 1 });
  assert.deepEqual(woke, [], "an update to another key skips every key");
  set({ items: { ...store.state.items, b: 2 } });
  assert.deepEqual(woke, ["b1", "b2"], "both watchers of the key that changed, none of the others");
  set({ items: { ...store.state.items, c: 1 } });
  assert.equal(w.size(), 2);
  assert.deepEqual(woke, ["b1", "b2"], "a key nobody watches wakes nobody");
  for (const off of offs) off();
  assert.equal(w.size(), 0);
  assert.ok(anyChecks >= 3);
});

test("memoRead: the last value while every dependency is the same, an equal value kept across changes", () => {
  const memo = { current: null };
  let computed = 0;
  const read = (dep, equal) => memoRead(memo, [dep], () => (computed++, { n: dep.n % 2 }), equal);
  const a = { n: 1 };
  const first = read(a);
  assert.equal(read(a), first);
  assert.equal(computed, 1, "the same dependency isn't computed again");
  const second = read({ n: 3 }, (x, y) => x.n === y.n);
  assert.equal(second, first, "equal to the last value: the same object");
  assert.equal(computed, 2);
  const third = read({ n: 4 }, (x, y) => x.n === y.n);
  assert.notEqual(third, first);
  assert.equal(third.n, 0);
  assert.equal(memoRead(memo, [{ n: 4 }, "extra"], () => "longer", Object.is), "longer", "a different number of dependencies recomputes");
});

test("a tab's state watcher wakes for its tab, its live state, being active and being selected", () => {
  const { w, ids } = manyTabs(5);
  const [a, b, c] = ids;
  const woke = Object.fromEntries(ids.map((id) => [id, 0]));
  const offs = ids.map((id) => watchTabState(id, () => woke[id]++));
  const reset = () => ids.forEach((id) => (woke[id] = 0));
  const wokeIds = () => ids.filter((id) => woke[id]);

  S().updateLive(b, { isLoading: true });
  assert.deepEqual(wokeIds(), [b], "a live change wakes its tab");
  reset();
  S().updateLive(b, { isLoading: true });
  assert.deepEqual(wokeIds(), [], "no change, no wake");

  S().updateTab(c, { title: "C" });
  assert.deepEqual(wokeIds(), [c]);
  reset();

  S().activate(b);
  assert.deepEqual(wokeIds().sort(), [a, b].sort(), "a switch wakes the tab it leaves and the one it shows, not the other three");
  reset();

  S().updateSettings({ bookmarksBar: "always" });
  S().updateWindow?.(w, { sidebarOpen: false });
  assert.deepEqual(wokeIds(), [], "a window's other fields and other keys wake nobody");

  S().setSelection(w, [a, c]);
  assert.deepEqual(wokeIds().sort(), [a, c].sort(), "selecting wakes the selected tabs");
  reset();
  S().setSelection(w, [c]);
  assert.deepEqual(wokeIds(), [a], "deselecting wakes the one that left");
  reset();
  S().setSelection(w, []);
  assert.deepEqual(wokeIds(), [c]);
  reset();

  S().closeTab(c);
  assert.ok(woke[c] >= 1, "a closed tab wakes");
  for (const off of offs) off();
  assert.equal(watchedTabStates(), 0, "nothing left behind");
});

test("liveWatch wakes a tab for its live state only", () => {
  const { ids } = manyTabs(3);
  const woke = [0, 0, 0];
  const offs = ids.map((id, i) => liveWatch.watch(id, () => woke[i]++));
  S().updateTab(ids[0], { title: "x" });
  assert.deepEqual(woke, [0, 0, 0], "the tab object isn't live state");
  S().updateLive(ids[1], { isLoading: true });
  assert.deepEqual(woke, [0, 1, 0]);
  for (const off of offs) off();
});
