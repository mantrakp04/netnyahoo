// Pinned tabs are the profile's (store/pinMirror.ts): every regular window of a profile shows the same pinned tiles
// and pinned groups, in the same order; each window has its own copy, and its own page. The owner's 0.2.27 report: a
// new window showed none of the pinned tabs the first window had.
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../lib/persist.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const pinned = (w) =>
  model.viewTabIds(S(), w).filter((id) => model.inPinnedContainer(S(), id)).map((id) => {
    const t = S().tabs[id];
    const g = Object.values(S().groups).find((g) => g.tabIds.includes(id));
    return `${g ? `${g.name}/` : ""}${t.customTitle ?? ""}${t.pinnedUrl || t.url}`;
  });
const regular = (w) => model.viewTabIds(S(), w).filter((id) => !model.inPinnedContainer(S(), id)).map((id) => S().tabs[id].url);
const loaded = (id) => !!S().tabs[id].navigation || !!S().tabs[id].adoptId;
const tileOf = (w, url) => model.viewTabIds(S(), w).find((id) => S().tabs[id].pinned && S().tabs[id].pinnedUrl === url);

function twoWindows() {
  const a = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[a].tabIds;
  const docs = S().newTab(a, { url: "https://docs.com" });
  S().newTab(a, { url: "https://a.com" });
  S().pinTabs([mail, docs], true);
  const b = S().createWindow({ url: "https://b.com" });
  return { a, b, mail, docs };
}
const PINS = ["https://mail.com", "https://docs.com"];

test("⌘N while a window is open: the new window shows the profile's pinned tabs, unloaded, in order", () => {
  reset();
  const { a, b, mail } = twoWindows();
  assert.deepEqual(pinned(b), PINS);
  assert.deepEqual(pinned(a), PINS, "the first window keeps them");
  assert.deepEqual(regular(b), ["https://b.com"], "the new window shows its New Tab page's tab, not a pinned one");
  assert.equal(S().tabs[model.activeTabId(S(), b)].url, "https://b.com");
  const copy = tileOf(b, "https://mail.com");
  assert.notEqual(copy, mail, "its own copy");
  assert.equal(loaded(copy), false, "unloaded until clicked");
  assert.equal(loaded(mail), true, "the first window's page is untouched");
  S().activate(copy);
  assert.equal(loaded(copy), true, "clicking it in the new window loads its own page");
  assert.equal(loaded(mail), true, "and the first window keeps its page");
  assert.deepEqual(pinned(a), PINS);
});

test("staleness: pin in A shows in B; unpin in B is gone in A; reorder, rename and pinned URL follow", () => {
  reset();
  const { a, b } = twoWindows();
  const x = S().newTab(a, { url: "https://x.com" });
  S().pinTabs([x], true);
  assert.deepEqual(pinned(b), [...PINS, "https://x.com"], "create → shows in the other window");

  S().pinTabs([tileOf(b, "https://docs.com")], false);
  assert.deepEqual(pinned(a), ["https://mail.com", "https://x.com"], "delete in B → gone in A");
  assert.deepEqual(pinned(b), ["https://mail.com", "https://x.com"]);
  assert.ok(regular(b).includes("https://docs.com"), "B's own copy stays as a regular tab there");
  assert.ok(regular(a).includes("https://docs.com"), "A's copy had a page: it stays as a regular tab, nothing closes under the user");

  S().moveTab(tileOf(a, "https://x.com"), 0);
  assert.deepEqual(pinned(b), ["https://x.com", "https://mail.com"], "update (order) → B follows");

  S().updateTab(tileOf(b, "https://mail.com"), { customTitle: "Inbox " });
  assert.deepEqual(pinned(a), ["https://x.com", "Inbox https://mail.com"], "update (name) → A follows");

  S().setPinnedUrl(tileOf(a, "https://x.com"), "https://x.com/home");
  assert.equal(S().tabs[model.viewTabIds(S(), b)[0]].pinnedUrl, "https://x.com/home", "update (pinned URL) → B follows");
  assert.equal(S().tabs[model.viewTabIds(S(), b)[0]].url, "https://x.com/home", "B's unloaded copy shows the new address");
});

test("an unloaded copy unpinned elsewhere goes; nothing ever ping-pongs between windows", () => {
  reset();
  const { a, b } = twoWindows();
  const c = S().createWindow({ url: "https://c.com" });
  let writes = 0;
  const off = useBrowser.subscribe(() => writes++);
  S().pinTabs([tileOf(c, "https://mail.com")], false);
  off();
  assert.ok(writes <= 3, `settles at once (${writes} writes)`);
  assert.deepEqual(pinned(a), ["https://docs.com"]);
  assert.deepEqual(pinned(b), ["https://docs.com"]);
  assert.ok(!regular(b).includes("https://mail.com"), "B's copy never loaded: it's gone, not a stray tab");
});

test("closing a window keeps the pins in the others and parks nothing; the last window parks them for the next", () => {
  reset();
  const { a, b } = twoWindows();
  S().closeWindow(a);
  assert.deepEqual(pinned(b), PINS, "still in B");
  assert.deepEqual(S().parkedPins, {});
  const n = S().createWindow();
  assert.deepEqual(pinned(n), PINS, "⌘N after: from B");
  S().closeWindow(n);
  S().closeWindow(b);
  assert.deepEqual(S().parkedPins.default.tabs.map((t) => t.pinnedUrl), PINS, "one set parked, not one per window");
  const m = S().createWindow();
  assert.deepEqual(pinned(m), PINS);
});

test("relaunch: every restored window shows the pins; a 0.2.27 session whose windows differ gets the union", () => {
  stub.docs.clear();
  reset();
  const stop = startPersistence();
  const { a, b } = twoWindows();
  flushPersistence();
  stop();
  S().hydrate(loadSession());
  assert.deepEqual(pinned(a), PINS);
  assert.deepEqual(pinned(b), PINS);

  // 0.2.27: each window had its own pins, and two had pinned the same site on their own.
  const tab = (id, windowId, url, pinned) => ({ id, windowId, profileId: "default", url, title: "", favicon: null, pinned, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: pinned ? url : null, navigation: null, openerId: null, createdAt: 0, lastActiveAt: 0 });
  const win = (id, tabIds) => ({ id, profileId: "default", incognito: false, tabIds, activeTabIds: { default: tabIds.at(-1) }, sidebarOpen: true, frame: null, createdAt: 0 });
  S().hydrate({
    windows: { w1: win("w1", ["x1", "m1", "r1"]), w2: win("w2", ["y2", "x2", "r2"]) },
    windowOrder: ["w1", "w2"],
    focusedWindowId: "w1",
    tabs: Object.fromEntries(
      [tab("x1", "w1", "https://x.com/", true), tab("m1", "w1", "https://mail.com/", true), tab("r1", "w1", "https://r1.com/", false),
       tab("y2", "w2", "https://y.com/", true), tab("x2", "w2", "https://x.com/", true), tab("r2", "w2", "https://r2.com/", false)].map((t) => [t.id, t]),
    ),
  });
  const union = ["https://x.com/", "https://mail.com/", "https://y.com/"];
  assert.deepEqual(pinned("w1"), union, "nothing lost: the windows' pins together, x.com once");
  assert.deepEqual(pinned("w2"), union);
  assert.equal(S().tabs.x2.pinned, true, "w2 keeps its own x.com tile as the copy");
});

test("pinned groups are mirrored too, and unpinning a group unpins it everywhere", () => {
  reset();
  const a = S().createWindow({ url: "https://jira.com" });
  const [jira] = S().windows[a].tabIds;
  const wiki = S().newTab(a, { url: "https://wiki.com" });
  S().newTab(a, { url: "https://a.com" });
  const work = S().groupTabs([jira, wiki], { pinned: true });
  S().updateGroup(work, { name: "Work" });
  const b = S().createWindow({ url: "https://b.com" });
  assert.deepEqual(pinned(b), ["Work/https://jira.com", "Work/https://wiki.com"]);
  const bWork = Object.values(S().groups).find((g) => g.windowId === b && g.pinned);
  S().updateGroup(bWork.id, { name: "Job" });
  assert.deepEqual(pinned(a), ["Job/https://jira.com", "Job/https://wiki.com"], "rename follows");
  S().updateGroup(work, { pinned: false });
  assert.deepEqual(pinned(b), [], "unpinned in A: gone from B (B's copies never loaded)");
});

test("moving a pinned tab's page to another window moves the page, not the pin; Merge All Windows keeps one of each", () => {
  reset();
  const { a, b, mail } = twoWindows();
  S().moveTabsToWindow([mail], b);
  assert.equal(S().tabs[mail].windowId, b);
  assert.deepEqual(pinned(b), PINS, "B: one mail tile, now the moved page");
  assert.equal(tileOf(b, "https://mail.com"), mail);
  assert.deepEqual(pinned(a), PINS, "A keeps the tile, unloaded");
  assert.equal(loaded(tileOf(a, "https://mail.com")), false);

  const c = S().createWindow({ url: "https://c.com" });
  S().mergeAllWindows(c);
  assert.deepEqual(Object.keys(S().windows), [c]);
  assert.deepEqual(pinned(c), PINS, "one tile per pin after the merge");
  assert.equal(tileOf(c, "https://mail.com"), mail, "the tile with a page wins");
  assert.equal(Object.values(S().tabs).filter((t) => t.pinned).length, 2, "no stray copies left");
});

test("a tile torn off into its own window keeps its place in the first window", () => {
  reset();
  const { a, docs } = twoWindows();
  const n = S().moveTabsToWindow([docs], null);
  assert.deepEqual(pinned(a), PINS);
  assert.deepEqual(pinned(n), PINS, "the new window shows every pin, in the same order");
  assert.equal(tileOf(n, "https://docs.com"), docs);
});

test("private windows and Small Yahu show no pinned tabs; paging a window to another profile shows that profile's", () => {
  reset();
  const { a } = twoWindows();
  const p = S().createWindow({ incognito: true, url: "https://secret.com" });
  assert.deepEqual(pinned(p), []);
  const small = S().createWindow({ small: true, url: "https://s.com" });
  assert.deepEqual(pinned(small), []);
  assert.deepEqual(pinned(a), PINS);

  const work = S().createProfile({ name: "Work" });
  const w = S().createWindow({ profileId: work, url: "https://work.com" });
  const t = S().newTab(w, { url: "https://jira.com" });
  S().pinTabs([t], true);
  S().switchProfile(a, work);
  assert.deepEqual(pinned(a), ["https://jira.com"], "A paged to Work shows Work's pins");
  S().switchProfile(a, "default");
  assert.deepEqual(pinned(a), PINS, "and its own again");
});

test("moving a pinned group's unloaded tab to a window that has its copy shows it there, in the group", () => {
  reset();
  const a = S().createWindow({ url: "https://jira.com" });
  const [jira] = S().windows[a].tabIds;
  const wiki = S().newTab(a, { url: "https://wiki.com" });
  S().newTab(a, { url: "https://a.com" });
  S().groupTabs([jira, wiki], { pinned: true });
  const b = S().createWindow({ url: "https://b.com" });
  const bWiki = model.viewTabIds(S(), b).find((id) => S().tabs[id].url === "https://wiki.com");
  S().moveTabsToWindow([bWiki], a);
  assert.equal(model.activeTabId(S(), a), bWiki, "the moved tab is the one shown");
  assert.deepEqual(pinned(a), ["/https://jira.com", "/https://wiki.com"], "one wiki in A's group");
  assert.deepEqual(pinned(b), ["/https://jira.com", "/https://wiki.com"], "B keeps its member, unloaded");
});
