// Sidebar organisation: placement, pinned base URLs, groups, ⌘-click groups, clean up.
// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/store/organize.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const organize = await import("./organize.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const urls = (ids) => ids.map((id) => S().tabs[id].url);
const view = (w) => urls(model.viewTabIds(S(), w));

function windowWith(...hosts) {
  const w = S().createWindow({ url: `${hosts[0]}.com` });
  const ids = [model.viewTabIds(S(), w)[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `${h}.com` }));
  return { w, ids };
}

test("placeTabs: reorder, pin at a slot, drop into and out of groups", () => {
  reset();
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "c", "d");
  S().placeTabs([d], { pinned: false, beforeId: b });
  assert.deepEqual(view(w), ["https://a.com", "https://d.com", "https://b.com", "https://c.com"]);
  S().placeTabs([c], { pinned: true });
  assert.equal(S().tabs[c].pinned, true);
  assert.equal(S().tabs[c].pinnedUrl, "https://c.com");
  assert.equal(view(w)[0], "https://c.com");
  // Unpin by dropping into the list before a.
  S().placeTabs([c], { pinned: false, beforeId: a });
  assert.equal(S().tabs[c].pinned, false);
  assert.equal(S().tabs[c].pinnedUrl, null);
  const g = S().groupTabs([a, b], { pinned: false });
  S().placeTabs([d], { pinned: false, groupId: g });
  assert.deepEqual(S().groups[g].tabIds, [a, b, d]);
  // A drop between two members of a group (without joining) lands after it.
  S().placeTabs([c], { pinned: false, beforeId: b });
  assert.deepEqual(S().groups[g].tabIds, [a, b, d]);
  const order = S().windows[w].tabIds;
  assert.ok(order.indexOf(c) > order.indexOf(d), "group stays contiguous");
  // Out of the group, to the end of the list.
  S().placeTabs([a], { pinned: false });
  assert.deepEqual(S().groups[g].tabIds, [b, d]);
  assert.equal(S().windows[w].tabIds.at(-1), a);
});

test("multi-tab placement keeps the tabs' order and the selection prunes on close", () => {
  reset();
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "c", "d");
  S().setSelection(w, [d, b]);
  assert.deepEqual(organize.selectedTabIds(S(), w), [b, d]);
  S().placeTabs([d, b], { pinned: false, beforeId: a });
  assert.deepEqual(view(w), ["https://b.com", "https://d.com", "https://a.com", "https://c.com"]);
  S().closeTab(b);
  assert.deepEqual(S().selection[w], [d]);
});

test("pinned tabs keep a base URL: badge, ⌘↩, replace, edit", () => {
  reset();
  const { w, ids: [a] } = windowWith("a", "b");
  S().togglePin(a);
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com");
  S().updateTab(a, { url: "https://a.com/inbox#x" });
  assert.equal(organize.awayFromPin(S().tabs[a]), true);
  S().updateTab(a, { url: "https://a.com/#top" });
  assert.equal(organize.awayFromPin(S().tabs[a]), false, "fragment / trailing slash don't count");
  S().updateTab(a, { url: "https://other.com/page" });
  S().returnToPinnedUrl(a);
  assert.equal(S().tabs[a].navigation.url, "https://a.com");
  S().updateTab(a, { url: "https://other.com/page" });
  S().setPinnedUrl(a);
  assert.equal(S().tabs[a].pinnedUrl, "https://other.com/page");
  S().setPinnedUrl(a, "https://edited.com/");
  assert.equal(S().tabs[a].pinnedUrl, "https://edited.com/");
  assert.equal(S().tabs[a].navigation.url, "https://edited.com/");
  // A pinned New Tab page adopts the first page it loads.
  const n = S().newTab(w, { pinned: true });
  assert.equal(S().tabs[n].pinnedUrl, null);
  S().updateTab(n, { url: "https://first.com/" });
  assert.equal(S().tabs[n].pinnedUrl, "https://first.com/");
  // Duplicating a pinned tab makes a regular one.
  const copy = S().duplicateTab(a);
  assert.equal(S().tabs[copy].pinned, false);
  assert.equal(S().tabs[copy].pinnedUrl, null);
});

test("⌘-click groups the link with its opener; the group ungroups at one tab", () => {
  reset();
  const { w, ids: [a, b] } = windowWith("a", "b");
  const c1 = S().newTab(w, { url: "a.com/1", openerId: a, background: true });
  const g = organize.groupOf(S(), a);
  assert.ok(g && g.autoUngroup);
  assert.deepEqual(g.tabIds, [a, c1]);
  const c2 = S().newTab(w, { url: "a.com/2", openerId: c1, background: true });
  assert.deepEqual(organize.groupOf(S(), a).tabIds, [a, c1, c2]);
  assert.equal(model.activeTabId(S(), w), b, "opened in the background");
  S().closeTab(c1);
  S().closeTab(c2);
  assert.equal(organize.groupOf(S(), a), undefined, "single-tab ⌘-click group ungrouped");
  // Setting off: a plain background tab.
  S().updateSettings({ cmdClickCreatesTabGroup: false });
  S().newTab(w, { url: "a.com/3", openerId: a, background: true });
  assert.equal(organize.groupOf(S(), a), undefined);
  // Explicit groups survive with one tab.
  const g2 = S().groupTabs([a, b]);
  S().closeTab(b);
  assert.deepEqual(S().groups[g2].tabIds, [a]);
});

test("pinned groups sit above the list; new tabs at top go below them", () => {
  reset();
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  const g = S().groupTabs([c]);
  assert.equal(S().groups[g].pinned, true, "groups made on purpose are pinned");
  assert.deepEqual(view(w), ["https://c.com", "https://a.com", "https://b.com"]);
  S().updateSettings({ newTabPosition: "top" });
  const t = S().newTab(w, { url: "top.com" });
  assert.equal(S().windows[w].tabIds.indexOf(t), 1);
  // Unpinned, it heads the list.
  S().updateGroup(g, { pinned: false });
  assert.deepEqual(view(w).slice(0, 2), ["https://c.com", "https://top.com"]);
  S().moveGroup(g, { pinned: true });
  assert.equal(view(w)[0], "https://c.com");
  S().moveGroup(g, { pinned: false, beforeId: b });
  assert.deepEqual(view(w), ["https://top.com", "https://a.com", "https://c.com", "https://b.com"]);
  assert.equal(S().groups[g].pinned, false);
});

test("closing a group goes to Recently Closed Groups and restores; duplicate; new tab in group", () => {
  reset();
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  const g = S().groupTabs([b, c], { name: "Work", pinned: false });
  S().updateGroup(g, { icon: "🔥" });
  const dup = S().duplicateGroup(g);
  assert.equal(S().groups[dup].name, "Work");
  assert.equal(S().groups[dup].icon, "🔥");
  assert.deepEqual(urls(S().groups[dup].tabIds), ["https://b.com", "https://c.com"]);
  S().closeGroup(dup);
  assert.equal(S().groups[dup], undefined);
  const nt = S().newTabInGroup(g);
  assert.deepEqual(S().groups[g].tabIds, [b, c, nt]);
  S().closeTab(nt);
  const closedTabsBefore = S().closedTabs.length;
  S().closeGroup(g);
  assert.equal(S().closedTabs.length, closedTabsBefore, "not on the tab stack");
  const entry = S().closedGroups.at(-1);
  assert.equal(entry.group.name, "Work");
  assert.equal(entry.tabs.length, 2);
  S().reopenClosed(w);
  const restored = Object.values(S().groups).find((x) => x.name === "Work");
  assert.ok(restored);
  assert.equal(restored.icon, "🔥");
  assert.deepEqual(urls(restored.tabIds), ["https://b.com", "https://c.com"]);
  assert.equal(S().closedGroups.length, 1, "the duplicate's entry is still there");
  assert.ok(S().tabs[a]);
});

test("move group to Bookmarks Bar makes a folder and closes the group", () => {
  reset();
  const { ids: [, b, c] } = windowWith("a", "b", "c");
  const g = S().groupTabs([b, c], { name: "Reading" });
  S().moveGroupToBookmarksBar(g);
  const roots = S().bookmarks.roots.default;
  const bar = S().bookmarks.nodes[roots.bar];
  const folder = S().bookmarks.nodes[bar.children.at(-1)];
  assert.equal(folder.title, "Reading");
  assert.deepEqual(folder.children.map((id) => S().bookmarks.nodes[id].url), ["https://b.com", "https://c.com"]);
  assert.equal(S().groups[g], undefined);
});

test("clean up closes duplicates and stale tabs into Recently Cleaned, and restores", () => {
  reset();
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "a", "d");
  const e = S().newTab(w, { url: "e.com" });
  S().pinTabs([d], true);
  const old = Date.now() - 13 * 3600_000;
  S().updateTab(b, { lastActiveAt: old });
  S().updateTab(d, { lastActiveAt: old }); // pinned: kept
  S().activate(a);
  assert.deepEqual(organize.cleanUpCandidates(S(), w), [b, c]);
  assert.equal(S().cleanUpTabs(w), 2);
  assert.deepEqual(view(w).sort(), ["https://a.com", "https://d.com", "https://e.com"]);
  assert.equal(S().cleanedTabs.length, 2);
  S().restoreCleaned();
  assert.equal(S().cleanedTabs.length, 0);
  assert.equal(view(w).length, 5);
  assert.ok(S().tabs[e]);
});

test("abandoned New Tab pages close; the selected one stays", () => {
  reset();
  const { w } = windowWith("a");
  const n1 = S().newTab(w);
  S().newTab(w, { url: "b.com" });
  const n2 = S().newTab(w);
  S().closeAbandonedNewTabs();
  assert.equal(S().tabs[n1], undefined);
  assert.ok(S().tabs[n2]);
});

test("abandoned New Tab cleanup never closes a window or the tab it shows", () => {
  reset();
  // A window of nothing but New Tab pages keeps the one it shows.
  const w = S().createWindow();
  S().newTab(w, { background: true });
  const shown = S().newTab(w);
  S().closeAbandonedNewTabs();
  assert.deepEqual(S().windows[w].tabIds, [shown]);
  // Another profile's selected tab in the same window stays too.
  const p = S().createProfile({ name: "Work" });
  S().switchProfile(w, p);
  const work = model.activeTabId(S(), w);
  S().switchProfile(w, "default");
  S().closeAbandonedNewTabs();
  assert.ok(S().tabs[work] && S().tabs[shown]);
  // Even with a stale selection (nothing in the window selected), the window survives.
  const w2 = S().createWindow();
  S().newTab(w2);
  useBrowser.setState((s) => ({ windows: { ...s.windows, [w2]: { ...s.windows[w2], activeTabIds: {} } } }));
  S().closeAbandonedNewTabs();
  assert.equal(S().windows[w2].tabIds.length, 1);
});

test("site mute covers the site's tabs and follows navigation", () => {
  reset();
  const { w, ids: [a, b] } = windowWith("a", "b");
  const a2 = S().newTab(w, { url: "a.com/other" });
  S().setSiteMuted(a, true);
  assert.equal(S().tabs[a].muted, true);
  assert.equal(S().tabs[a2].muted, true);
  assert.equal(S().tabs[b].muted, false);
  S().updateTab(b, { url: "https://a.com/x" });
  assert.equal(S().tabs[b].muted, true, "navigating to a muted site mutes");
  S().updateTab(b, { url: "https://b.com/" });
  assert.equal(S().tabs[b].muted, false, "leaving it unmutes");
  S().setSiteMuted(a, false);
  assert.deepEqual(S().settings.mutedSites, []);
});

test("MRU order for the tab switcher skips tabs untouched for a while", () => {
  reset();
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "c", "d");
  const now = Date.now();
  S().updateTab(a, { lastActiveAt: now - 1000 });
  S().updateTab(b, { lastActiveAt: now - 3000 });
  S().updateTab(c, { lastActiveAt: now - 2000 });
  S().updateTab(d, { lastActiveAt: now - 20 * 3600_000 });
  assert.deepEqual(organize.recentTabIds(S(), w, now), [a, c, b]);
});
