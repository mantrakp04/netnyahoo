// Store transitions and the v1 → v2 session migration. See test-loader.mjs for how to run.
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { loadSession } = await import("../lib/persist.ts");
const stub = await import("./test-native-stub.mjs");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const view = (w) => model.viewTabIds(S(), w).map((id) => S().tabs[id].url);

test("window lifecycle: new tabs, last tab closes window, reopen", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  assert.deepEqual(view(w), ["https://a.com"]);
  const t2 = S().newTab(w, { url: "b.com" });
  assert.equal(model.activeTabId(S(), w), t2);
  S().newTab(w, { url: "c.com", background: true });
  assert.equal(model.activeTabId(S(), w), t2);
  assert.deepEqual(view(w), ["https://a.com", "https://b.com", "https://c.com"]);
  S().closeTab(t2);
  // neighbour below becomes active
  assert.equal(S().tabs[model.activeTabId(S(), w)].url, "https://c.com");
  S().reopenClosed(w);
  assert.deepEqual(view(w), ["https://a.com", "https://b.com", "https://c.com"]);
  // close all tabs one by one: last closes the window
  for (const id of model.viewTabIds(S(), w).slice(1)) S().closeTab(id);
  S().closeTab(model.viewTabIds(S(), w)[0]);
  assert.equal(S().windows[w], undefined);
  assert.equal(S().closedWindows.length, 1);
  S().reopenClosed();
  const w2 = S().windowOrder.at(-1);
  assert.deepEqual(view(w2), ["https://a.com"]);
  assert.ok(S().tabs[model.activeTabId(S(), w2)].navigation, "restored active tab loads");
});

test("closeTabs keeps a New Tab page, pins sort first, moveTab within section", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const b = S().newTab(w, { url: "b.com" });
  const c = S().newTab(w, { url: "c.com" });
  S().togglePin(c);
  assert.deepEqual(view(w), ["https://c.com", "https://a.com", "https://b.com"]);
  S().moveTab(b, 0);
  assert.deepEqual(view(w), ["https://c.com", "https://b.com", "https://a.com"]);
  S().closeTabs(model.viewTabIds(S(), w));
  assert.deepEqual(view(w), [""]);
});

test("profiles: switch, move tab, delete; isolation of views", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const p = S().createProfile({ name: "Work" });
  S().switchProfile(w, p);
  assert.equal(S().windows[w].profileId, p);
  assert.deepEqual(view(w), [""]);
  const work = S().newTab(w, { url: "work.com" });
  assert.equal(S().tabs[work].profileId, p);
  S().switchProfile(w, "default");
  assert.deepEqual(view(w), ["https://a.com"]);
  const a = model.viewTabIds(S(), w)[0];
  S().moveTabToProfile(a, p);
  assert.equal(S().windows[w].profileId, p);
  assert.ok(view(w).includes("https://a.com"));
  assert.ok(S().tabs[a].navigation, "moved tab reloads");
  S().deleteProfile(p);
  assert.equal(S().profiles[p], undefined);
  assert.equal(S().windows[w].profileId, "default");
  assert.ok(Object.values(S().tabs).every((t) => t.profileId === "default"));
  assert.ok(S().bookmarks.roots[p] === undefined);
});

test("incognito window: own profile, closing records nothing, history ignored", () => {
  reset();
  const w = S().createWindow({ incognito: true, url: "secret.com" });
  const tab = S().tabs[model.activeTabId(S(), w)];
  assert.equal(tab.profileId, `incognito:${w}`);
  S().recordVisit(tab.profileId, "https://secret.com", "S", null, true);
  assert.equal(S().history[tab.profileId], undefined);
  S().newTab(w, { url: "x.com" });
  S().closeTab(model.viewTabIds(S(), w)[1]);
  assert.equal(S().closedTabs.length, 1);
  S().closeWindow(w);
  assert.equal(S().closedTabs.length, 0);
  assert.equal(S().closedWindows.length, 0);
});

test("move tab to window / merge windows / new window from tab", () => {
  reset();
  const w1 = S().createWindow({ url: "a.com" });
  S().newTab(w1, { url: "b.com" });
  const w2 = S().createWindow({ url: "c.com" });
  const b = model.viewTabIds(S(), w1)[1];
  S().moveTabsToWindow([b], w2);
  assert.deepEqual(view(w1), ["https://a.com"]);
  assert.deepEqual(view(w2), ["https://c.com", "https://b.com"]);
  assert.equal(model.activeTabId(S(), w2), b);
  const w3 = S().moveTabsToWindow([b], null);
  assert.deepEqual(view(w3), ["https://b.com"]);
  S().mergeAllWindows(w1);
  assert.deepEqual(S().windowOrder, [w1]);
  assert.deepEqual(view(w1).sort(), ["https://a.com", "https://b.com", "https://c.com"]);
});

test("groups stay contiguous; splits need two panes", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const b = S().newTab(w, { url: "b.com" });
  const c = S().newTab(w, { url: "c.com" });
  const a = model.viewTabIds(S(), w)[0];
  const g = S().createGroup([a, c], { name: "G" });
  assert.deepEqual(S().windows[w].tabIds, [a, c, b]);
  assert.deepEqual(S().groups[g].tabIds, [a, c]);
  S().addTabsToGroup(g, [b]);
  assert.deepEqual(S().groups[g].tabIds, [a, c, b]);
  S().closeTab(c);
  assert.deepEqual(S().groups[g].tabIds, [a, b]);
  const sp = S().createSplit([a, b]);
  S().closeTab(b);
  assert.equal(S().splits[sp], undefined);
  S().closeTab(a); // last tab: window closes, group record kept in closed window
  assert.equal(S().closedWindows.at(-1).groups.length, 1);
});

test("bookmarks tree: toggle, folders, move, remove", async () => {
  reset();
  const bm = await import("./bookmarks.ts");
  const page = { url: "https://a.com", title: "A", favicon: null };
  assert.equal(S().toggleBookmark("default", page), true);
  assert.ok(bm.isBookmarked(S().bookmarks, "default", page.url));
  const roots = S().bookmarks.roots.default;
  const folder = S().addBookmarkFolder({ profileId: "default", title: "F" });
  const id = bm.bookmarksByUrl(S().bookmarks, "default").get(page.url)[0];
  S().moveBookmark(id, folder);
  assert.deepEqual(S().bookmarks.nodes[folder].children, [id]);
  S().moveBookmark(folder, folder); // into itself: ignored
  assert.equal(S().bookmarks.nodes[folder].parentId, roots.bar);
  assert.equal(S().toggleBookmark("default", page), false);
  assert.ok(!bm.isBookmarked(S().bookmarks, "default", page.url));
  S().removeBookmark(folder);
  assert.deepEqual(S().bookmarks.nodes[roots.bar].children, []);
  S().removeBookmark(roots.bar); // roots can't be removed
  assert.ok(S().bookmarks.nodes[roots.bar]);
});

test("v1 session migrates to v2 and round-trips", () => {
  stub.docs.clear();
  stub.docs.set("session.json", JSON.stringify({
    version: 1,
    tabs: [
      { url: "https://b.com", title: "B", favicon: null, pinned: true, muted: false, zoom: 1 },
      { url: "https://a.com", title: "A", favicon: null, pinned: false, muted: true, zoom: 1.5 },
    ],
    activeIndex: 1, closedUrls: ["https://gone.com"],
    history: [{ url: "https://a.com", title: "A", favicon: null, visits: 2, lastVisit: 1 }],
    bookmarks: [{ url: "https://a.com", title: "A", favicon: null }],
    sidebarOpen: false, showFullUrl: true,
  }));
  const { data, migrated } = loadSession();
  assert.ok(migrated);
  S().hydrate(data);
  const w = S().windowOrder[0];
  assert.equal(S().windows[w].sidebarOpen, false);
  assert.equal(S().settings.showFullUrl, true);
  const active = S().tabs[model.activeTabId(S(), w)];
  assert.equal(active.url, "https://a.com");
  assert.equal(active.zoom, 1.5);
  assert.equal(active.muted, true);
  assert.ok(active.navigation, "active tab loads");
  assert.equal(S().tabs[model.viewTabIds(S(), w)[0]].navigation, null, "others lazy");
  assert.equal(S().closedTabs[0].tab.url, "https://gone.com");
  assert.equal(S().history.default.length, 1);
  const bar = S().bookmarks.nodes[S().bookmarks.roots.default.bar];
  assert.equal(S().bookmarks.nodes[bar.children[0]].url, "https://a.com");
  assert.ok(stub.docs.get("session.v1.backup.json"));
});

test("reopened tabs go back to their index and group", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const b = S().newTab(w, { url: "b.com" });
  S().newTab(w, { url: "c.com" });
  const a = model.viewTabIds(S(), w)[0];
  const g = S().createGroup([a, b], { name: "G" });
  S().closeTab(b);
  assert.deepEqual(view(w), ["https://a.com", "https://c.com"]);
  S().reopenClosedTab(w);
  assert.deepEqual(view(w), ["https://a.com", "https://b.com", "https://c.com"]);
  assert.equal(S().groups[g].tabIds.length, 2);
});

test("hydrate repairs dangling references", () => {
  S().hydrate({
    profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } },
    windows: {
      w1: { id: "w1", profileId: "gone", incognito: false, tabIds: ["t1", "missing"], activeTabIds: { gone: "missing" }, sidebarOpen: true, frame: null, createdAt: 0 },
      w2: { id: "w2", profileId: "default", incognito: false, tabIds: [], activeTabIds: {}, sidebarOpen: true, frame: null, createdAt: 0 },
    },
    tabs: {
      t1: { id: "t1", windowId: "w1", profileId: "default", url: "https://a.com", title: "", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, navigation: null, openerId: null, createdAt: 0, lastActiveAt: 0 },
      t2: { id: "t2", windowId: "nowhere", profileId: "default", url: "https://b.com", title: "", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, navigation: null, openerId: null, createdAt: 0, lastActiveAt: 0 },
    },
    groups: { g: { id: "g", windowId: "w1", profileId: "default", name: "", icon: null, color: null, collapsed: false, pinned: false, tabIds: ["missing"], createdAt: 0 } },
  });
  assert.deepEqual(S().windowOrder, ["w1"]);
  assert.equal(S().windows.w1.profileId, "default");
  assert.equal(model.activeTabId(S(), "w1"), "t1");
  assert.equal(S().tabs.t2, undefined);
  assert.deepEqual(S().groups, {});
});

test("new tab position setting and opener placement", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const a = model.viewTabIds(S(), w)[0];
  S().newTab(w, { url: "b.com" });
  S().newTab(w, { url: "child1.com", openerId: a, background: true });
  S().newTab(w, { url: "child2.com", openerId: a, background: true });
  assert.deepEqual(view(w), ["https://a.com", "https://child1.com", "https://child2.com", "https://b.com"]);
  S().updateSettings({ newTabPosition: "top" });
  S().newTab(w, { url: "top.com" });
  assert.equal(view(w)[0], "https://top.com");
});
