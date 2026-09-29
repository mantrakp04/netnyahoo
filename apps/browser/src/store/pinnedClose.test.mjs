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

test("with only pinned tabs, ⌘W selects the loaded pinned tab used last, then a New Tab page", () => {
  reset();
  const { w, ids: [p, q, r] } = windowWith("p", "q", "r");
  S().togglePin(p);
  S().togglePin(q);
  S().togglePin(r);
  select(q);
  select(r);
  select(p);
  S().closeTab(p);
  assert.equal(active(w), r, "the loaded pinned tab used last");
  assert.ok(S().tabs[r].navigation, "its page is the one it had");
  assert.deepEqual(view(w), ["https://p.com", "https://q.com", "https://r.com"], "no New Tab page");
  S().closeTab(r);
  assert.equal(active(w), q);
  S().closeTab(q);
  assert.ok(S().windows[w], "the window stays");
  assert.deepEqual(view(w), ["https://p.com", "https://q.com", "https://r.com", ""]);
  assert.equal(S().tabs[active(w)].url, "", "no loaded page left: a New Tab page is selected");
  assert.deepEqual([p, q, r].map((id) => S().tabs[id].navigation), [null, null, null], "no unloaded page woke");
});

test("holding ⌘W over pinned tiles ends by closing the window: no unloaded page wakes", () => {
  reset();
  const { w, ids: [x, a] } = windowWith("x", "a");
  S().togglePin(x);
  select(x);
  const wakes = [];
  for (let i = 0; i < 10 && S().windows[w]; i++) {
    const before = S().tabs[x].navigation;
    S().closeTab(active(w));
    if (S().windows[w] && !before && S().tabs[x].navigation) wakes.push(i);
  }
  assert.deepEqual(wakes, [], "x.com never loads again");
  assert.equal(S().windows[w], undefined, "the window closed, as in Dia");
  assert.deepEqual(S().parkedPins.default.tabs.map((t) => t.id), [x], "the tile waits for the profile's next window");
  void a;
});

const sidebar = (w) =>
  model.viewTabIds(S(), w).filter((id) => model.inPinnedContainer(S(), id)).map((id) => {
    const t = S().tabs[id];
    const g = Object.values(S().groups).find((g) => g.tabIds.includes(id));
    return `${g ? `${g.name}/` : ""}${t.url}${t.navigation || t.adoptId ? " (loaded)" : ""}`;
  });

function pinnedWindow() {
  const { w, ids: [mail, docs, jira, wiki, a] } = windowWith("mail", "docs", "jira", "wiki", "a");
  S().togglePin(mail);
  S().togglePin(docs);
  const work = S().groupTabs([jira, wiki], { pinned: true });
  S().updateGroup(work, { name: "Work" });
  select(a);
  select(mail);
  return { w, mail, docs, jira, wiki, a, work };
}
const PINS = ["https://mail.com", "https://docs.com", "Work/https://jira.com", "Work/https://wiki.com"];

test("⌘W until the window closes, then ⌘N: the pinned tabs and pinned groups are back, in order, unloaded", () => {
  reset();
  const { w, mail, work } = pinnedWindow();
  assert.deepEqual(sidebar(w), ["https://mail.com (loaded)", "https://docs.com (loaded)", "Work/https://jira.com (loaded)", "Work/https://wiki.com (loaded)"]);
  for (let i = 0; i < 12 && S().windows[w]; i++) S().closeTab(model.activeTabId(S(), w));
  assert.equal(S().windows[w], undefined, "the window closed");
  const n = S().createWindow();
  assert.deepEqual(sidebar(n), PINS, "same tiles, same order, the group still pinned, nothing loaded");
  assert.equal(S().tabs[model.activeTabId(S(), n)].url, "", "the new window shows a New Tab page");
  assert.equal(S().tabs[mail].windowId, n, "same tab id (its key in sync)");
  assert.equal(S().groups[work].pinned, true);
  assert.deepEqual(S().parkedPins, {}, "the park is empty");
  const n2 = S().createWindow();
  assert.deepEqual(sidebar(n2), []);
});

test("the close button (closeWindow) parks them too; a Dock click or a link from another app gets them back", () => {
  reset();
  const { w } = pinnedWindow();
  S().closeWindow(w);
  const linked = S().createWindow({ url: "https://news.com" });
  assert.deepEqual(sidebar(linked), PINS);
  assert.equal(S().tabs[model.activeTabId(S(), linked)].url, "https://news.com", "the link is the tab shown");
});

test("⇧⌘T after the close, then ⌘N: no second set of pinned tabs", () => {
  reset();
  const { w } = pinnedWindow();
  S().closeWindow(w);
  S().reopenClosed(null);
  const restored = S().ui.focusedWindowId;
  assert.notEqual(restored, w);
  assert.deepEqual(sidebar(restored), PINS, "the reopened window has them");
  assert.deepEqual(model.viewTabIds(S(), restored).filter((id) => !model.inPinnedContainer(S(), id)).map((id) => S().tabs[id].url), ["https://a.com"]);
  const n = S().createWindow();
  assert.deepEqual(sidebar(n), [], "⌘N: none again");
  assert.equal(Object.values(S().tabs).filter((t) => t.url === "https://mail.com").length, 1);
});

test("⌘N, then ⇧⌘T: the reopened window doesn't bring them a second time", () => {
  reset();
  const { w } = pinnedWindow();
  S().closeWindow(w);
  const n = S().createWindow();
  S().reopenClosedWindow();
  const restored = S().ui.focusedWindowId;
  assert.notEqual(restored, n);
  assert.deepEqual(sidebar(n), PINS);
  assert.deepEqual(sidebar(restored), [], "they're in the ⌘N window already");
  assert.equal(Object.values(S().tabs).filter((t) => t.url === "https://mail.com").length, 1);
});

test("⇧⌘T of a pinned tab's page after its window closed: its tile comes back with the page, and the others", () => {
  reset();
  const { w, mail } = pinnedWindow();
  S().updateTab(mail, { url: "https://mail.com/inbox/7" });
  S().closeTab(mail);
  S().closeWindow(w);
  S().reopenClosedTab(null);
  const back = S().tabs[mail];
  assert.ok(back, "the tile, same id");
  assert.equal(back.adoptId, `restore:${mail}`, "with its page");
  assert.deepEqual(sidebar(back.windowId).length, 4);
  assert.equal(model.activeTabId(S(), back.windowId), mail);
});

test("switching a window to a profile whose window closed brings its pinned tabs, without loading them", () => {
  reset();
  const { w } = pinnedWindow();
  const other = S().createProfile({ name: "Work" });
  const o = S().createWindow({ profileId: other });
  S().closeWindow(w);
  S().switchProfile(o, "default");
  assert.deepEqual(sidebar(o), PINS);
  assert.equal(S().tabs[model.activeTabId(S(), o)].url, "", "a New Tab page, not a tile");
});

test("with two windows of a profile, each keeps its pins; closing one parks its pins for the next window", () => {
  reset();
  const { w } = pinnedWindow();
  const b = S().createWindow({ url: "https://b.com" });
  const bTile = S().newTab(b, { url: "https://tools.com" });
  S().togglePin(bTile);
  assert.deepEqual(sidebar(b), ["https://tools.com (loaded)"], "B has only its own pin");
  S().closeWindow(w);
  assert.deepEqual(sidebar(b), ["https://tools.com (loaded)"], "B doesn't change");
  const n = S().createWindow();
  assert.deepEqual(sidebar(n), PINS);
});

test("an incognito window has no pins to park and takes none", () => {
  reset();
  const { w } = pinnedWindow();
  S().closeWindow(w);
  const i = S().createWindow({ incognito: true });
  assert.deepEqual(sidebar(i), []);
  assert.ok(S().parkedPins.default, "still parked");
});

test("closing the last regular tab when only unloaded pinned tiles are left closes the window", () => {
  reset();
  const { w, ids: [p, a] } = windowWith("p", "a");
  S().togglePin(p);
  select(p);
  S().closeTab(p);
  assert.equal(active(w), a);
  assert.equal(model.closesWindow(S(), a), true);
  S().closeTab(a);
  assert.equal(S().windows[w], undefined);
});

test("closing every regular tab at once over unloaded pinned tiles leaves a New Tab page, not a woken tile", () => {
  reset();
  const { w, ids: [p, a, b] } = windowWith("p", "a", "b");
  S().togglePin(p);
  select(p);
  S().closeTab(p);
  S().closeTabs([a, b]);
  assert.ok(S().windows[w]);
  assert.equal(S().tabs[active(w)].url, "", "a New Tab page is selected");
  assert.equal(S().tabs[p].navigation, null, "the unloaded tile stays unloaded");
});

test("closing the last regular tab doesn't wake an unloaded pinned tab when a loaded one is left", () => {
  reset();
  const { w, ids: [p, q, a] } = windowWith("p", "q", "a");
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

test("quit and relaunch after the window closed: the next window has the pinned tabs", () => {
  reset();
  const { w } = pinnedWindow();
  S().closeWindow(w);
  flushPersistence();
  S().hydrate(loadSession().data);
  assert.equal(S().windowOrder.length, 0, "no window restored");
  const n = S().createWindow();
  assert.deepEqual(sidebar(n), PINS);
});
