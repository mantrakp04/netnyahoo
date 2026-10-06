// Page progress apart from the browser store (store/pageProgress.ts): a report wakes its own tab's bar only, never
// the store, and a bar shown later reads the value as it is.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("./browser.ts");
const { setPageProgress, pageProgressOf, watchPageProgress } = await import("./pageProgress.ts");

test("a tab's progress wakes its own watchers, not the store or other tabs", () => {
  let storeUpdates = 0;
  const stop = useBrowser.subscribe(() => storeUpdates++);
  const woke = { a: 0, b: 0 };
  const offA = watchPageProgress("a", () => woke.a++);
  const offB = watchPageProgress("b", () => woke.b++);
  setPageProgress("a", 0.3);
  setPageProgress("a", 0.3);
  setPageProgress("a", 0.7);
  assert.deepEqual(woke, { a: 2, b: 0 }, "an unchanged value wakes nobody");
  assert.equal(storeUpdates, 0);
  offA();
  offB();
  stop();
});

test("a bar that appears later reads the latest report: a hidden tab's progress is never stale", () => {
  setPageProgress("hidden", 0.2);
  setPageProgress("hidden", 0.9);
  assert.equal(pageProgressOf("hidden"), 0.9);
  assert.equal(pageProgressOf("never-reported"), 0);
  setPageProgress("hidden", 0);
  assert.equal(pageProgressOf("hidden"), 0);
});
