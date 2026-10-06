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
