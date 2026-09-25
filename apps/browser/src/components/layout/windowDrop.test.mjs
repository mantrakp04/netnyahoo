// Dragging tabs out of a window (layout/windowDrop.ts, used by layout/tabDrag.ts): onto another window, or torn off into a new one.
// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/components/layout/windowDrop.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../../store/browser.ts");
const model = await import("../../store/model.ts");
const drop = await import("./windowDrop.ts");

const S = () => useBrowser.getState();

/** Two side-by-side windows (Cocoa frames: bottom-left origin), the first with two tabs. */
function setup() {
  S().hydrate({});
  const a = S().createWindow({ url: "a.com" });
  S().newTab(a, { url: "b.com" });
  const b = S().createWindow({ url: "c.com" });
  S().setWindowFrame(a, [0, 100, 800, 600]);
  S().setWindowFrame(b, [1000, 100, 800, 600]);
  const [t1, t2] = model.viewTabIds(S(), a);
  return { a, b, t1, t2 };
}

test("a tab dropped on another window moves there", () => {
  const { a, b, t2 } = setup();
  // 1200 pt right of window a's left edge, 300 pt below its top: inside window b.
  assert.deepEqual(drop.windowUnder(S(), a, 1200, 300), { outside: true, overWindow: b });
  assert.equal(drop.dropTabsOutside([t2], a, 1200, 300), b);
  assert.equal(S().tabs[t2].windowId, b);
  assert.equal(model.viewTabIds(S(), a).length, 1);
});

test("a tab dropped outside every window tears off into a new window under the pointer", () => {
  const { a, b, t1 } = setup();
  assert.deepEqual(drop.windowUnder(S(), a, 900, 300), { outside: true, overWindow: null });
  const w = drop.dropTabsOutside([t1], a, 900, 300);
  assert.equal(S().tabs[t1].windowId, w);
  assert.ok(w !== a && w !== b);
  // Screen point (900, 100 + 600 - 300 = 400): the new window's top-left sits just above-left of it.
  assert.deepEqual(S().windows[w].frame, [810, 400 - 600 + 70, 800, 600]);
});

test("inside the window is the tab list's own drop; a window's only tabs don't tear off", () => {
  const { a, t1, t2 } = setup();
  assert.deepEqual(drop.windowUnder(S(), a, 400, 300), { outside: false, overWindow: null });
  assert.equal(drop.dropTabsOutside([t1, t2], a, 900, 300), null);
  assert.equal(S().tabs[t1].windowId, a);
});

test("incognito windows neither give nor take dragged tabs", () => {
  const { b } = setup();
  const i = S().createWindow({ incognito: true, url: "d.com" });
  S().newTab(i, { url: "e.com" });
  S().setWindowFrame(i, [0, 100, 800, 600]);
  const [tab] = model.viewTabIds(S(), i);
  assert.deepEqual(drop.windowUnder(S(), i, 1200, 300), { outside: true, overWindow: null });
  assert.equal(drop.dropTabsOutside([tab], i, 1200, 300), null);
  assert.equal(S().tabs[tab].windowId, i);
  assert.notEqual(S().tabs[tab].windowId, b);
});
