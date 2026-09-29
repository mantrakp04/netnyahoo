// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/store/privateWindows.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { cleanedTabsFor } = await import("./organize.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../lib/persist.ts");
const stub = await import("./test-native-stub.mjs");

const S = () => useBrowser.getState();
const OLD = () => Date.now() - 13 * 3600_000;
const saved = () => stub.docs.get("session.json") ?? "";

function privateWindowWith(...urls) {
  const w = S().createWindow({ incognito: true, url: urls[0] });
  const ids = [model.viewTabIds(S(), w)[0]];
  for (const url of urls.slice(1)) ids.push(S().newTab(w, { url }));
  return { w, ids };
}

test("cleaning up a private window keeps its tabs in memory, out of session.json, and in that window", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startPersistence();
  const normal = S().createWindow({ url: "https://public.example/" });
  const { w, ids: [, stale, dupe] } = privateWindowWith("https://secret.example/a", "https://secret.example/old", "https://secret.example/a");
  S().activate(model.viewTabIds(S(), w)[0]);
  S().updateTab(stale, { lastActiveAt: OLD() });
  assert.equal(S().cleanUpTabs(w), 2);
  assert.ok(!S().tabs[stale] && !S().tabs[dupe]);

  assert.equal(S().cleanedTabs.length, 0, "the saved list never sees private tabs");
  assert.equal(cleanedTabsFor(S(), w).length, 2);
  assert.equal(cleanedTabsFor(S(), normal).length, 0, "a regular window doesn't list them");
  flushPersistence();
  assert.ok(saved().includes("public.example"));
  assert.ok(!saved().includes("secret.example"));

  // Restoring from a regular window never pulls a private tab into it.
  S().restoreCleaned(undefined, normal);
  S().restoreCleaned(cleanedTabsFor(S(), w)[0].id, normal);
  assert.equal(model.viewTabIds(S(), normal).length, 1);
  assert.equal(cleanedTabsFor(S(), w).length, 1, "an entry id alone still restores into its own window");
  S().restoreCleaned(undefined, w);
  assert.equal(cleanedTabsFor(S(), w).length, 0);
  assert.equal(model.viewTabIds(S(), w).length, 3);
  assert.ok(model.viewTabIds(S(), w).every((id) => model.isIncognitoProfile(S().tabs[id].profileId)));

  S().updateTab(model.viewTabIds(S(), w)[1], { lastActiveAt: OLD() });
  S().cleanUpTabs(w);
  assert.equal(cleanedTabsFor(S(), w).length, 1);
  S().closeWindow(w);
  assert.deepEqual(S().privateCleanedTabs, {}, "closing the window forgets them");
  flushPersistence();
  assert.ok(!saved().includes("secret.example"));
  stop();
});

test("a private window closed by its last tab forgets its cleanup records and mutes too", () => {
  S().hydrate({});
  S().createWindow({ url: "https://public.example/" });
  const { w, ids: [a, b] } = privateWindowWith("https://secret.example/", "https://other.example/");
  S().activate(a);
  S().updateTab(b, { lastActiveAt: OLD() });
  S().cleanUpTabs(w);
  S().setSiteMuted(a, true);
  S().closeTab(a);
  assert.equal(S().windows[w], undefined);
  assert.deepEqual(S().privateCleanedTabs, {});
  assert.deepEqual(S().privateSiteMutes, {});
});

test("muting a site in a private window stays in that window and out of settings", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startPersistence();
  const normal = S().createWindow({ url: "https://secret.example/x" });
  const [publicTab] = model.viewTabIds(S(), normal);
  const { w, ids: [a, b] } = privateWindowWith("https://secret.example/", "https://other.example/");
  const other = privateWindowWith("https://secret.example/");

  S().setSiteMuted(a, true);
  assert.equal(S().tabs[a].muted, true);
  assert.deepEqual(S().settings.mutedSites, [], "the saved list is untouched");
  assert.equal(S().tabs[publicTab].muted, false);
  assert.equal(S().tabs[other.ids[0]].muted, false, "another private window isn't affected");
  S().updateTab(b, { url: "https://secret.example/page" });
  assert.equal(S().tabs[b].muted, true, "navigating to the muted site in that window mutes");
  S().updateTab(b, { url: "https://other.example/" });
  assert.equal(S().tabs[b].muted, false);

  flushPersistence();
  assert.deepEqual(JSON.parse(saved()).settings.mutedSites, []);

  S().closeWindow(w);
  assert.equal(S().privateSiteMutes[w], undefined);
  S().closeWindow(other.w);
  stop();
});

test("a private window can unmute a site the regular profile mutes, without changing the saved list", () => {
  S().hydrate({ settings: { mutedSites: ["loud.example"] } });
  S().createWindow({ url: "https://quiet.example/" });
  const { ids: [a] } = privateWindowWith("https://quiet.example/");
  S().updateTab(a, { url: "https://loud.example/" });
  assert.equal(S().tabs[a].muted, true, "the regular mutes still apply in private");
  S().setSiteMuted(a, false);
  assert.equal(S().tabs[a].muted, false);
  S().updateTab(a, { url: "https://quiet.example/" });
  S().updateTab(a, { url: "https://loud.example/again" });
  assert.equal(S().tabs[a].muted, false, "the window's own choice wins");
  assert.deepEqual(S().settings.mutedSites, ["loud.example"]);
});

test("private entries an older build saved are dropped when the session loads, and never written again", () => {
  stub.docs.clear();
  const privateEntry = {
    kind: "tab", id: "ct-old", windowId: "w-private", index: 0, group: null, closedAt: 1,
    tab: { url: "https://secret.example/", title: "Secret", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, profileId: "incognito:w-private" },
  };
  const publicEntry = { ...privateEntry, id: "ct-ok", tab: { ...privateEntry.tab, url: "https://public.example/", profileId: "default" } };
  stub.docs.set("session.json", JSON.stringify({ version: 2, profiles: {}, profileOrder: [], settings: {}, windows: [], windowOrder: [], focusedWindowId: null, tabs: [], groups: [], splits: [], closedTabs: [], closedWindows: [], cleanedTabs: [privateEntry, publicEntry] }));
  const stop = startPersistence();
  assert.deepEqual(S().cleanedTabs.map((c) => c.id), ["ct-ok"]);
  S().createWindow({ url: "https://public.example/" });
  flushPersistence();
  assert.ok(!saved().includes("secret.example"));
  stop();
  const { data } = loadSession();
  assert.deepEqual(data.cleanedTabs.map((c) => c.id), ["ct-ok"]);
});

test("session.json filters private tabs out of every closed and parked list", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startPersistence();
  S().createWindow({ url: "https://public.example/" });
  const snap = { url: "https://secret.example/", title: "", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, profileId: "incognito:w-x" };
  useBrowser.setState({
    closedTabs: [{ kind: "tab", id: "c1", tab: snap, windowId: "w-x", index: 0, group: null, closedAt: 1 }],
    closedWindows: [{ kind: "window", id: "c2", window: { profileId: "incognito:w-x", sidebarOpen: true, frame: null }, tabs: [{ ...snap, active: true }], groups: [], closedAt: 1 }],
    closedGroups: [{ kind: "group", id: "c3", group: { id: "g", name: "", icon: null, color: null, pinned: false }, tabs: [snap], windowId: "w-x", index: 0, closedAt: 1 }],
    deletedGroups: [{ kind: "group", id: "c4", group: { id: "g", name: "", icon: null, color: null, pinned: false }, tabs: [snap], windowId: "w-x", index: 0, closedAt: Date.now() }],
    parkedPins: { "incognito:w-x": { tabs: [{ ...snap, id: "t", groupId: null }], groups: [] } },
  });
  flushPersistence();
  assert.ok(saved().includes("public.example"));
  assert.ok(!saved().includes("secret.example"));
  assert.ok(!saved().includes("incognito:"));
  stop();
});

test("deleting a profile drops its cleaned tabs, closed and deleted groups, and never-translate list", () => {
  S().hydrate({});
  const work = S().createProfile({ name: "Work" });
  const w = S().createWindow({ profileId: work, url: "https://work.example/" });
  const [first] = model.viewTabIds(S(), w);
  const stale = S().newTab(w, { url: "https://work.example/old" });
  const grouped = S().newTab(w, { url: "https://work.example/g" });
  S().activate(first);
  S().updateTab(stale, { lastActiveAt: OLD() });
  S().cleanUpTabs(w);
  assert.equal(S().cleanedTabs.length, 1);
  const deletedTab = S().newTab(w, { url: "https://work.example/d" });
  S().closeGroup(S().groupTabs([grouped], { pinned: false }));
  S().deleteGroup(S().groupTabs([deletedTab], { pinned: false }));
  assert.equal(S().closedGroups.length + S().deletedGroups.length, 2);
  S().updateSettings({ neverTranslateSites: { [work]: ["work.example"] } });
  S().createWindow({ url: "https://home.example/" });
  S().deleteProfile(work);
  assert.equal(S().cleanedTabs.length, 0);
  assert.deepEqual([S().closedGroups.length, S().deletedGroups.length], [0, 0]);
  assert.equal(S().settings.neverTranslateSites[work], undefined);
});
