// Split view transitions. Run from apps/browser:
//   node --import ./src/store/test-loader.mjs --test src/store/splits.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { slotsOf, splitOf } = await import("./splits.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const urls = (ids) => ids.map((id) => S().tabs[id].url);

test("open split pane: new tab to the right, focused, contiguous; max three", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const b = S().newTab(w, { url: "b.com" });
  const a = model.viewTabIds(S(), w)[0];
  S().activate(a);
  const r1 = S().openSplitPane(w);
  assert.equal(r1.ok, true);
  const split = S().splits[r1.splitId];
  assert.deepEqual(split.tabIds, [a, r1.tabId]);
  assert.equal(model.activeTabId(S(), w), r1.tabId, "new pane is focused");
  assert.deepEqual(S().windows[w].tabIds, [a, r1.tabId, b], "members sit together");
  const r2 = S().openSplitPane(w, { url: "c.com", side: "left" });
  assert.equal(r2.ok, true);
  assert.deepEqual(S().splits[r1.splitId].tabIds, [a, r2.tabId, r1.tabId]);
  assert.deepEqual(S().splits[r1.splitId].sizes.map((x) => x.toFixed(3)), ["0.333", "0.333", "0.333"]);
  assert.deepEqual(S().openSplitPane(w), { ok: false, reason: "max" });
});

test("add bottom split stacks the focused pane; closing a stacked pane unstacks", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const a = model.viewTabIds(S(), w)[0];
  const { splitId, tabId: b } = S().openSplitPane(w, { url: "b.com" });
  const { tabId: c } = S().openSplitPane(w, { side: "bottom", anchorTabId: b, url: "c.com" });
  const split = S().splits[splitId];
  assert.deepEqual(split.tabIds, [a, b, c]);
  assert.deepEqual(split.stack, { index: 1, sizes: [0.5, 0.5] });
  assert.deepEqual(slotsOf(split), [[a], [b, c]]);
  assert.equal(split.sizes.length, 2);
  S().updateSplit(splitId, { sizes: [0.3, 0.7] });
  S().closeTab(b);
  const after = S().splits[splitId];
  assert.deepEqual(after.tabIds, [a, c]);
  assert.equal(after.stack, undefined);
  assert.deepEqual(after.sizes, [0.3, 0.7], "slot sizes survive");
});

test("flip, convert, move pane, focus next/previous", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const a = model.viewTabIds(S(), w)[0];
  const { splitId, tabId: b } = S().openSplitPane(w, { url: "b.com" });
  S().updateSplit(splitId, { sizes: [0.25, 0.75] });
  S().flipSplit(splitId);
  assert.deepEqual(S().splits[splitId].tabIds, [b, a]);
  assert.deepEqual(S().splits[splitId].sizes, [0.75, 0.25]);
  S().toggleSplitOrientation(splitId);
  assert.equal(S().splits[splitId].orientation, "vertical");
  S().movePane(b, 1);
  assert.deepEqual(S().splits[splitId].tabIds, [a, b]);
  S().activate(a);
  S().focusPane(w, 1);
  assert.equal(model.activeTabId(S(), w), b);
  S().focusPane(w, 1);
  assert.equal(model.activeTabId(S(), w), a, "wraps around");
});

test("split an existing tab in; it joins the anchor's group; separate / remove keep tabs", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const b = S().newTab(w, { url: "b.com" });
  const c = S().newTab(w, { url: "c.com" });
  const a = model.viewTabIds(S(), w)[0];
  const g = S().createGroup([a, b]);
  const r = S().openSplitPane(w, { anchorTabId: a, tabId: c, background: true });
  assert.equal(r.ok, true);
  assert.deepEqual(S().windows[w].tabIds, [a, c, b]);
  assert.deepEqual(S().groups[g].tabIds, [a, c, b]);
  S().removeTabFromSplit(a);
  assert.equal(splitOf(S(), c), undefined, "a one-pane split goes away");
  assert.deepEqual(urls(model.viewTabIds(S(), w)), ["https://a.com", "https://c.com", "https://b.com"]);
  const id = S().createSplit([a, b, c]);
  S().separateSplit(id);
  assert.deepEqual(S().splits, {});
});

test("hydrate drops broken splits", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const a = model.viewTabIds(S(), w)[0];
  const b = S().newTab(w, { url: "b.com" });
  const tabs = Object.values(S().tabs);
  S().hydrate({
    windows: S().windows,
    windowOrder: S().windowOrder,
    tabs: S().tabs,
    splits: {
      ok: { id: "ok", windowId: w, tabIds: [a, b], orientation: "horizontal", sizes: [0.5, 0.5] },
      stale: { id: "stale", windowId: w, tabIds: [a, "gone"], orientation: "horizontal", sizes: [0.5, 0.5] },
    },
  });
  assert.equal(tabs.length, 2);
  assert.deepEqual(Object.keys(S().splits), ["ok"]);
});

test("tab layout toggles per window and becomes the default", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  S().toggleTabLayout(w);
  assert.equal(S().windows[w].tabLayout, "top");
  assert.equal(S().settings.tabLayout, "top");
  S().toggleTabLayout(w);
  assert.equal(S().windows[w].tabLayout, "sidebar");
});

test("an empty pane picks an existing tab: it takes the pane's place, the New Tab page closes", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const a = model.viewTabIds(S(), w)[0];
  const c = S().newTab(w, { url: "c.com", background: true });
  const { splitId, tabId: empty } = S().openSplitPane(w);
  assert.equal(S().tabs[empty].url, "");
  S().replaceSplitPane(empty, c);
  assert.equal(S().tabs[empty], undefined);
  assert.deepEqual(S().splits[splitId].tabIds, [a, c]);
  assert.deepEqual(S().windows[w].tabIds, [a, c]);
  assert.equal(model.activeTabId(S(), w), c);
  assert.equal(S().closedTabs.length, 0, "a New Tab page isn't reopenable");
});
