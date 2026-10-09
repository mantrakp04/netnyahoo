// The launch's first page (store/launchTab.ts): the hint session.json keeps for the engine, and what a launch claims of
// it once hydrated. The hint and the claim must name the same tab for a plain session, and nothing the app doesn't load.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("./browser.ts");
const { launchTab } = await import("./launchTab.ts");
const { loadSession, flushPersistence, startPersistence } = await import("../lib/persist.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
// Saving follows the store from here on (it hydrates from the empty documents first).
startPersistence();
const tab = (id, windowId, url, profileId = "default") => ({
  id, windowId, profileId, url, title: "", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null,
  pinnedUrl: null, navigation: null, openerId: null, createdAt: 0, lastActiveAt: 0,
});
const win = (id, tabIds, active, extra = {}) => ({
  id, profileId: "default", incognito: false, tabIds, activeTabIds: { default: active }, sidebarOpen: true, frame: null, createdAt: 0, ...extra,
});
const PROFILES = {
  default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
  work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 },
};
const hydrate = (windows, tabs, extra = {}) =>
  S().hydrate({ profiles: PROFILES, windows: Object.fromEntries(windows.map((w) => [w.id, w])), tabs: Object.fromEntries(tabs.map((t) => [t.id, t])), ...extra });

test("the focused window's active web page, under its engine profile", () => {
  hydrate([win("w1", ["a", "b"], "b"), win("w2", ["c"], "c")], [tab("a", "w1", "https://a.com/"), tab("b", "w1", "https://b.com/x"), tab("c", "w2", "http://c.com/")], { focusedWindowId: "w1" });
  assert.deepEqual(launchTab(S(), S().ui.focusedWindowId), { id: "b", url: "https://b.com/x", profile: "" });
  assert.deepEqual(launchTab(S(), "w2"), { id: "c", url: "http://c.com/", profile: "" });
  // Hydrate woke it: the page the window's view loads is that URL.
  assert.equal(S().tabs.b.navigation?.url, "https://b.com/x");
});

test("another profile's tab names that profile's engine profile", () => {
  hydrate([win("w1", ["a"], null, { profileId: "work", activeTabIds: { work: "a" } })], [tab("a", "w1", "https://a.com/", "work")], { focusedWindowId: "w1" });
  assert.deepEqual(launchTab(S(), "w1"), { id: "a", url: "https://a.com/", profile: "work" });
});

test("nothing for a page the engine doesn't load at launch", () => {
  for (const url of ["", "about:blank", "arcadia://history", "chrome://settings", "file:///tmp/x.html", "javascript:alert(1)"]) {
    hydrate([win("w1", ["a"], "a")], [tab("a", "w1", url)], { focusedWindowId: "w1" });
    assert.equal(launchTab(S(), "w1"), null, url);
  }
  hydrate([win("w1", ["a"], "a")], [tab("a", "w1", "https://a.com/")], { focusedWindowId: "w1" });
  assert.equal(launchTab(S(), null), null, "no focused window");
  assert.equal(launchTab(S(), "gone"), null);
  assert.equal(launchTab({ ...S(), settings: { ...S().settings, restoreSession: false } }, "w1"), null, "a session the user doesn't restore");
  assert.equal(launchTab({ ...S(), windows: { w1: { ...S().windows.w1, incognito: true } } }, "w1"), null, "private");
  assert.equal(launchTab({ ...S(), windows: { w1: { ...S().windows.w1, kind: "small" } } }, "w1"), null, "Little Arcadia");
});

test("session.json's hint is what the next launch claims", () => {
  hydrate([win("w1", ["a", "b"], "a"), win("w2", ["c"], "c")], [tab("a", "w1", "https://a.com/"), tab("b", "w1", "https://b.com/"), tab("c", "w2", "https://c.com/")], { focusedWindowId: "w2" });
  S().activate("b");
  S().setFocusedWindow("w1");
  flushPersistence();
  const saved = JSON.parse(stub.docs.get("session.json"));
  assert.deepEqual(saved.launchTab, { id: "b", url: "https://b.com/", profile: "" });
  // The next launch: hydrated from that file, it claims the same tab.
  S().hydrate(loadSession());
  assert.deepEqual(launchTab(S(), S().ui.focusedWindowId), saved.launchTab);
});

test("no hint when the next launch won't restore the session", () => {
  hydrate([win("w1", ["a"], "a")], [tab("a", "w1", "https://a.com/")], { focusedWindowId: "w1" });
  S().updateSettings({ restoreSession: false });
  flushPersistence();
  assert.equal(JSON.parse(stub.docs.get("session.json")).launchTab, null);
});

// Staleness: the hint is written with the session it names, so the page the engine starts is the one this session
// shows, whatever changed before the quit (or before the last save, after a crash).
const savedHint = () => (flushPersistence(), JSON.parse(stub.docs.get("session.json")).launchTab);

test("staleness: a navigation, a switch, a close and a window change all move the hint", () => {
  hydrate([win("w1", ["a", "b"], "a"), win("w2", ["c"], "c")], [tab("a", "w1", "https://a.com/"), tab("b", "w1", "https://b.com/"), tab("c", "w2", "https://c.com/")], { focusedWindowId: "w1" });
  assert.deepEqual(savedHint(), { id: "a", url: "https://a.com/", profile: "" });
  S().navigated("a", { url: "https://a.com/next", title: "Next" }, { isLoading: false, canGoBack: true, canGoForward: false });
  assert.equal(savedHint().url, "https://a.com/next", "navigated");
  S().activate("b");
  assert.equal(savedHint().id, "b", "switched");
  S().closeTab("b");
  assert.equal(savedHint().id, "a", "closed: the tab shown next");
  S().setFocusedWindow("w2");
  assert.equal(savedHint().id, "c", "another window in front");
  S().updateTab("c", { url: "arcadia://history" });
  assert.equal(savedHint(), null, "now one of the app's own pages");
});

test("staleness: after a crash the file read at launch has the hint of its own session", () => {
  hydrate([win("w1", ["a"], "a")], [tab("a", "w1", "https://a.com/")], { focusedWindowId: "w1" });
  flushPersistence();
  // Changes after the last save that never reach the file (the app died): the next launch reads the old file whole.
  S().navigated("a", { url: "https://a.com/lost", title: "" }, { isLoading: false, canGoBack: true, canGoForward: false });
  const onDisk = JSON.parse(stub.docs.get("session.json"));
  S().hydrate(loadSession());
  assert.deepEqual(launchTab(S(), S().ui.focusedWindowId), onDisk.launchTab);
  assert.equal(onDisk.launchTab.url, "https://a.com/");
});

test("switched off (launchTab): no hint is saved, so the engine starts nothing", async () => {
  const ks = await import("../lib/killSwitches.ts");
  hydrate([win("w1", ["a"], "a")], [tab("a", "w1", "https://a.com/")], { focusedWindowId: "w1" });
  stub.docs.set("switches-cache.json", JSON.stringify({ version: 1, switches: { launchTab: false } }));
  ks.reloadSwitches();
  try {
    S().navigated("a", { url: "https://a.com/off", title: "" }, { isLoading: false, canGoBack: true, canGoForward: false });
    assert.equal(savedHint(), null);
  } finally {
    stub.docs.delete("switches-cache.json");
    ks.reloadSwitches();
  }
  S().navigated("a", { url: "https://a.com/on", title: "" }, { isLoading: false, canGoBack: true, canGoForward: false });
  assert.equal(savedHint().url, "https://a.com/on");
});
