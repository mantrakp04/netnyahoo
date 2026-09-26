// ⌘W on a pinned tab unloads its page and keeps the tile (Dia's `.deselectPinnedIfActive`).
// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/store/pinnedClose.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../lib/persist.ts");
const stub = await import("./test-native-stub.mjs");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const view = (w) => model.viewTabIds(S(), w).map((id) => S().tabs[id].url);
const active = (w) => model.activeTabId(S(), w);

// Selections a few ms apart, so "used last" doesn't depend on the test's speed.
let clock = Date.now();
function at(fn) {
  const now = Date.now;
  Date.now = () => (clock += 1000);
  try {
    return fn();
  } finally {
    Date.now = now;
  }
}
const select = (id) => at(() => S().activate(id));

function windowWith(...hosts) {
  const w = at(() => S().createWindow({ url: `${hosts[0]}.com` }));
  const ids = [model.viewTabIds(S(), w)[0]];
  for (const h of hosts.slice(1)) ids.push(at(() => S().newTab(w, { url: `${h}.com` })));
  return { w, ids };
}

test("⌘W on a pinned tab unloads its page; the tile stays with its title, icon and pinned URL", () => {
  reset();
  const { w, ids: [p, a] } = windowWith("mail", "a");
  S().togglePin(p);
  S().updateTab(p, { title: "Inbox", favicon: "data:mail" });
  select(p);
  S().closeTab(p);
  const tile = S().tabs[p];
  assert.ok(tile, "the pinned tab still exists");
  assert.equal(tile.pinned, true);
  assert.equal(tile.url, "https://mail.com");
  assert.equal(tile.title, "Inbox");
  assert.equal(tile.favicon, "data:mail");
  assert.equal(tile.navigation, null, "no page: its web view unmounts");
  assert.equal(tile.adoptId, undefined);
  assert.equal(tile.unloaded, true);
  assert.deepEqual(view(w), ["https://mail.com", "https://a.com"]);
  assert.equal(active(w), a);
  assert.equal(S().windows[w] !== undefined, true);
});

test("an unloaded pinned tab goes back to its pinned URL, with that page's title and icon", () => {
  reset();
  const { w, ids: [p] } = windowWith("mail", "a");
  S().togglePin(p);
  S().recordVisit("default", "https://mail.com", "Inbox", "data:inbox", true);
  S().updateTab(p, { url: "https://mail.com/thread/42", title: "Re: lunch", favicon: "data:thread" });
  select(p);
  S().closeTab(p);
  const tile = S().tabs[p];
  assert.equal(tile.url, "https://mail.com");
  assert.equal(tile.title, "Inbox");
  assert.equal(tile.favicon, "data:inbox");
  assert.equal(tile.pinnedUrl, "https://mail.com");
  // Clicking the tile loads the pinned page.
  select(p);
  assert.equal(active(w), p);
  assert.equal(S().tabs[p].navigation.url, "https://mail.com");
  assert.equal(S().tabs[p].unloaded, undefined);
});

test("the window selects the regular tab it showed last, not the neighbour", () => {
  reset();
  const { w, ids: [p, q, a, b, c] } = windowWith("p", "q", "a", "b", "c");
  S().togglePin(p);
  S().togglePin(q);
  select(b);
  select(q);
  select(p);
  S().closeTab(p);
  assert.equal(active(w), b, "back to the regular tab used before the pinned ones");
  assert.ok(S().tabs[b].navigation);
  assert.equal(S().tabs[q].navigation !== null, true, "the other pinned tab keeps its page");
  void a;
  void c;
});

test("a pinned tab in a split: the other pane is selected", () => {
  reset();
  const { w, ids: [p, a, b] } = windowWith("p", "a", "b");
  S().togglePin(p);
  select(a);
  S().createSplit([p, b]);
  select(b);
  select(p);
  S().closeTab(p);
  assert.equal(active(w), b);
  assert.equal(Object.values(S().splits).length, 0, "a split left with one pane dissolves");
});

test("with only pinned tabs, ⌘W unloads and shows a New Tab page; the window stays", () => {
  reset();
  const { w, ids: [p, q] } = windowWith("p", "q");
  S().togglePin(p);
  S().togglePin(q);
  select(p);
  S().closeTab(p);
  assert.ok(S().windows[w], "the window stays");
  assert.deepEqual(view(w), ["https://p.com", "https://q.com", ""]);
  assert.equal(S().tabs[active(w)].url, "", "a New Tab page is selected");
  assert.equal(S().tabs[p].unloaded, true);
  assert.equal(S().tabs[q].unloaded, undefined, "the other pinned tab isn't touched");
});

test("closing the last regular tab doesn't wake an unloaded pinned tab when a loaded one is left", () => {
  reset();
  const { w, ids: [p, q, a] } = windowWith("p", "q", "a");
  // Tiles q, p: p is the neighbour above a.
  S().togglePin(q);
  S().togglePin(p);
  select(p);
  S().closeTab(p);
  select(a);
  S().closeTab(a);
  assert.equal(active(w), q);
  assert.equal(S().tabs[p].navigation, null);
});

test("Unpin, then Close Tab, removes it", () => {
  reset();
  const { w, ids: [p] } = windowWith("p", "a");
  S().togglePin(p);
  select(p);
  S().togglePin(p);
  S().closeTab(p);
  assert.equal(S().tabs[p], undefined);
  assert.deepEqual(view(w), ["https://a.com"]);
});

test("bulk close (a multi-selection) unloads its pinned tabs and closes the rest", () => {
  reset();
  const { w, ids: [p, a, b] } = windowWith("p", "a", "b");
  S().togglePin(p);
  select(b);
  select(p);
  S().closeTabs([p, b]);
  assert.deepEqual(view(w), ["https://p.com", "https://a.com"]);
  assert.equal(S().tabs[p].unloaded, true);
  assert.equal(active(w), a, "the regular tab being closed with it isn't picked");
});

test("⇧⌘T brings the unloaded page back into its tile, with its back/forward list", () => {
  reset();
  const { w, ids: [p] } = windowWith("mail", "a");
  S().togglePin(p);
  S().updateTab(p, { url: "https://mail.com/thread/42", title: "Re: lunch" });
  select(p);
  S().closeTab(p);
  assert.equal(S().closedTabs.at(-1).pinnedTile, true);
  S().reopenClosed(w);
  assert.deepEqual(view(w), ["https://mail.com/thread/42", "https://a.com"], "no second tab");
  assert.equal(active(w), p);
  assert.equal(S().tabs[p].adoptId, `restore:${p}`);
  assert.equal(S().tabs[p].title, "Re: lunch");
  assert.equal(S().tabs[p].pinnedUrl, "https://mail.com");
  assert.equal(S().closedTabs.length, 0);
});

test("an unloaded pinned tab has nothing more to unload: ⌘W isn't recorded twice", () => {
  reset();
  const { ids: [p] } = windowWith("p", "a");
  S().togglePin(p);
  select(p);
  S().closeTab(p);
  S().closeTab(p);
  assert.equal(S().closedTabs.length, 1);
  assert.equal(S().tabs[p].pinned, true);
});

test("⌘W on a tab of a pinned group unloads it where it is; its row stays in the group", () => {
  reset();
  const { w, ids: [g1, g2, a] } = windowWith("g1", "g2", "a");
  const groupId = S().groupTabs([g1, g2], { pinned: true });
  S().updateTab(g1, { url: "https://g1.com/deep", title: "Deep" });
  select(a);
  select(g1);
  S().closeTab(g1);
  assert.ok(S().tabs[g1], "the tab still exists");
  assert.deepEqual(S().groups[groupId].tabIds, [g1, g2], "still in its group");
  assert.equal(S().tabs[g1].url, "https://g1.com/deep", "no pinned URL: it stays on its page");
  assert.equal(S().tabs[g1].title, "Deep");
  assert.equal(S().tabs[g1].navigation, null);
  assert.equal(S().tabs[g1].unloaded, true);
  assert.equal(active(w), a, "back to the regular tab used last, not the group's other tab");
  assert.ok(S().tabs[g2].navigation, "the group's other tab isn't touched");
  assert.equal(S().closedTabs.at(-1).pinnedTile, true);
  // ⇧⌘T loads it back into its row.
  S().reopenClosed(w);
  assert.equal(active(w), g1);
  assert.deepEqual(S().groups[groupId].tabIds, [g1, g2]);
});

test("a tab of an unpinned group still closes", () => {
  reset();
  const { w, ids: [g1, g2] } = windowWith("g1", "g2", "a");
  const groupId = S().groupTabs([g1, g2], { pinned: false });
  select(g1);
  S().closeTab(g1);
  assert.equal(S().tabs[g1], undefined);
  assert.deepEqual(S().groups[groupId].tabIds, [g2]);
  void w;
});

test("bulk close unloads a pinned group's tabs and closes the rest; the only tab left unloaded doesn't close the window", () => {
  reset();
  const { w, ids: [g1, g2, a] } = windowWith("g1", "g2", "a");
  const groupId = S().groupTabs([g1, g2], { pinned: true });
  select(g1);
  S().closeTabs([g1, g2, a]);
  assert.deepEqual(S().groups[groupId].tabIds, [g1, g2]);
  assert.equal(S().tabs[g1].unloaded, true);
  assert.equal(S().tabs[a], undefined);
  assert.equal(S().tabs[active(w)].url, "", "a New Tab page is selected");
  select(g2);
  S().closeTab(g2);
  assert.ok(S().windows[w], "closing a pinned group's tab never closes the window");
  assert.equal(S().tabs[g2].unloaded, true);
});

// Last: persistence stays subscribed to the store.
test("session restore keeps unloaded pinned tabs unloaded", () => {
  stub.docs.clear();
  startPersistence();
  const { w, ids: [p, a] } = windowWith("p", "a");
  S().togglePin(p);
  select(p);
  S().closeTab(p);
  flushPersistence();
  const saved = JSON.parse(stub.docs.get("session.json"));
  assert.equal(saved.tabs.find((t) => t.id === p).unloaded, true);
  S().hydrate(loadSession().data);
  assert.equal(S().tabs[p].unloaded, true);
  assert.equal(S().tabs[p].navigation, null, "no page after a relaunch");
  assert.equal(active(w), a);
  assert.ok(S().tabs[a].navigation, "the selected tab loads");
});
