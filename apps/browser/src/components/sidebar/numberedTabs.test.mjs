// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/components/sidebar/numberedTabs.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../../store/browser.ts");
const model = await import("../../store/model.ts");
const { numberedTabs } = await import("./entries.ts");

const S = () => useBrowser.getState();
const host = (id) => S().tabs[id].url.replace(/^https:\/\//, "");
const urls = (ids) => ids.map(host);

function windowWith(...names) {
  S().hydrate({});
  const w = S().createWindow({ url: `${names[0]}.com` });
  for (const name of names.slice(1)) S().newTab(w, { url: `${name}.com` });
  const id = (name) => model.viewTabIds(S(), w).find((t) => host(t) === `${name}.com`);
  return { w, id };
}

test("pinned tiles first, then pinned groups, then the list with groups in place", () => {
  const { w, id } = windowWith("a", "b", "c", "d", "e", "f");
  S().togglePin(id("e"));
  const group = S().createGroup([id("b"), id("c")]);
  const pinnedGroup = S().createGroup([id("f")]);
  S().updateGroup(pinnedGroup, { pinned: true });
  assert.deepEqual(urls(numberedTabs(S(), w)), ["e.com", "f.com", "a.com", "b.com", "c.com", "d.com"]);
  S().updateGroup(group, { collapsed: true });
  assert.deepEqual(urls(numberedTabs(S(), w)), ["e.com", "f.com", "a.com", "b.com", "c.com", "d.com"]);
});

test("a split view is one row: its pane used last", () => {
  const { w, id } = windowWith("a", "b", "c");
  S().activate(id("a"));
  const { tabId: pane } = S().openSplitPane(w, { url: "p.com" });
  const rows = numberedTabs(S(), w);
  assert.deepEqual(urls(rows), ["p.com", "b.com", "c.com"]);
  S().activate(id("a"));
  assert.deepEqual(urls(numberedTabs(S(), w)), ["a.com", "b.com", "c.com"]);
  assert.ok(pane);
});

test("⌘9 is the last row", () => {
  const { w, id } = windowWith("a", "b");
  S().togglePin(id("b"));
  assert.deepEqual(urls(numberedTabs(S(), w)), ["b.com", "a.com"]);
  assert.equal(numberedTabs(S(), w).at(-1), id("a"));
});
