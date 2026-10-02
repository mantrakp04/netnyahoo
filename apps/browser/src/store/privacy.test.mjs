// Private windows, incognito data and profile deletion: what must never reach disk, and what must leave it.
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { cleanedTabsFor } = await import("./organize.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../lib/persist.ts");
const drop = await import("../components/layout/windowDrop.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const HOUR = 3_600_000;
const OLD = () => Date.now() - 13 * HOUR;
const saved = () => stub.docs.get("session.json") ?? "";
const settle = () => new Promise((resolve) => setTimeout(resolve, 1700));

function privateWindowWith(...urls) {
  const w = S().createWindow({ incognito: true, url: urls[0] });
  const ids = [model.viewTabIds(S(), w)[0]];
  for (const url of urls.slice(1)) ids.push(S().newTab(w, { url }));
  return { w, ids };
}


test("incognito window: own profile, closing records nothing, history ignored", () => {
  S().hydrate({});
  const w = S().createWindow({ incognito: true, url: "secret.com" });
  const tab = S().tabs[model.activeTabId(S(), w)];
  assert.equal(tab.profileId, `incognito:${w}`);
  stub.historyDbs.clear();
  assert.equal(S().importHistory(tab.profileId, [{ url: "https://secret.com/", title: "S", visits: 1, lastVisit: Date.now() }]), 0);
  S().removeHistory(tab.profileId, ["https://secret.com/"]);
  assert.equal(S().history[tab.profileId], undefined);
  assert.equal(stub.historyDbs.size, 0, "nothing reaches Chrome's history, not even the default profile's");
  S().newTab(w, { url: "x.com" });
  S().closeTab(model.viewTabIds(S(), w)[1]);
  assert.equal(S().closedTabs.length, 1);
  S().closeWindow(w);
  assert.equal(S().closedTabs.length, 0);
  assert.equal(S().closedWindows.length, 0);
});

// 0.2.11: tidying up a private window saved its tabs to disk, where they could reopen as regular tabs.
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
  const data = loadSession();
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

const download = (id, profile, state = "finished") => ({
  id,
  url: `https://files.example/${id}`,
  filename: `${id}.zip`,
  path: `/tmp/${id}.zip`,
  state,
  paused: false,
  received: 1,
  total: 1,
  speed: 0,
  mimeType: "application/zip",
  profile,
});

test("incognito downloads never reach downloads.json and leave with their window", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startPersistence();
  const normal = S().createWindow();
  const incognito = S().createWindow({ incognito: true });
  const privateProfile = S().windows[incognito].profileId;
  S().upsertDownload(download("1", ""));
  S().upsertDownload(download("2", privateProfile, "downloading"));
  flushPersistence();
  const savedDownloads = JSON.parse(stub.docs.get("downloads.json")).downloads;
  assert.deepEqual(savedDownloads.map((d) => d.id), ["1"]);

  S().closeWindow(incognito);
  assert.deepEqual(S().downloads.map((d) => d.id), ["1"]);
  assert.ok(S().windows[normal]);
  S().upsertDownload(download("2", privateProfile, "cancelled"));
  assert.deepEqual(S().downloads.map((d) => d.id), ["1"]);

  const data = loadSession();
  assert.deepEqual(data.downloads.map((d) => d.id), ["saved-0"]);
  stop();
});

test("favicons: incognito icons stay in memory and in their own profile; nothing is written", async () => {
  const { noteFavicon, resolveFavicon, useFavicons } = await import("../lib/favicons.ts");
  const { webviews } = await import("../lib/webviews.ts");
  stub.docs.clear();
  const stop = startPersistence();
  const normal = S().createWindow({ url: "https://site.example/a" });
  const incognito = S().createWindow({ incognito: true, url: "https://secret.example/x" });
  const [normalTab] = S().windows[normal].tabIds;
  const [privateTab] = S().windows[incognito].tabIds;
  const privateProfile = S().windows[incognito].profileId;
  const handle = (uri) => ({ downloadFavicon: () => Promise.resolve({ uri, width: 32, height: 32 }) });
  webviews.set(normalTab, handle("data:image/png;base64,SITE"));
  webviews.set(privateTab, handle("data:image/png;base64,AAAA"));

  noteFavicon(normalTab, "https://site.example/favicon.ico");
  noteFavicon(privateTab, "https://secret.example/favicon.ico");
  // Recorded icons land with the next frame's batch.
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(resolveFavicon("https://site.example/a")?.uri, "data:image/png;base64,SITE");
  assert.equal(resolveFavicon("https://secret.example/x"), null);
  assert.equal(resolveFavicon("https://secret.example/x", null, "default"), null);
  assert.equal(resolveFavicon("https://secret.example/x", null, privateProfile)?.uri, "data:image/png;base64,AAAA");
  assert.equal(resolveFavicon("https://site.example/a", null, privateProfile)?.uri, "data:image/png;base64,SITE");

  flushPersistence();
  assert.ok(![...stub.docs.keys()].some((k) => k.startsWith("favicons")), "Chrome keeps icons; the app writes none");
  assert.ok(![...stub.docs.values()].some((v) => String(v).includes("secret.example")));

  S().closeWindow(incognito);
  assert.equal(useFavicons.getState().profiles[privateProfile], undefined);
  webviews.clear();
  stop();
});

test("incognito windows neither give nor take dragged tabs", () => {
  S().hydrate({});
  const b = S().createWindow({ url: "c.com" });
  S().setWindowFrame(b, [1000, 100, 800, 600]);
  const i = S().createWindow({ incognito: true, url: "d.com" });
  S().newTab(i, { url: "e.com" });
  S().setWindowFrame(i, [0, 100, 800, 600]);
  const [tab] = model.viewTabIds(S(), i);
  assert.deepEqual(drop.windowUnder(S(), i, 1200, 300), { outside: true, overWindow: null });
  assert.equal(drop.dropTabsOutside([tab], i, 1200, 300), null);
  assert.equal(S().tabs[tab].windowId, i);
});

test("clearing a time range removes visits, not pages", () => {
  S().hydrate({});
  const t0 = 1_700_000_000_000;
  const entry = (url, times) => ({ url, title: url, favicon: null, visits: times.length, lastVisit: times.at(-1), visitTimes: times });
  S().hydrate({ history: { default: [entry("https://b.com/", [t0 - 5 * 60_000]), entry("https://a.com/", [t0 - 5 * HOUR, t0 - 10 * 60_000])] } });
  assert.deepEqual(S().history.default.map((h) => [h.url, h.visits]), [["https://b.com/", 1], ["https://a.com/", 2]]);

  S().clearHistory("default", t0 - HOUR);
  const [a, ...rest] = S().history.default;
  assert.equal(rest.length, 0, "b.com was only visited in the last hour");
  assert.equal(a.url, "https://a.com/");
  assert.equal(a.visits, 1);
  assert.equal(a.lastVisit, t0 - 5 * HOUR);
  assert.deepEqual(a.visitTimes, [t0 - 5 * HOUR]);

  S().clearHistory("default");
  assert.deepEqual(S().history.default, []);
});

// 0.2.11: deleting "Personal" removed it from the sidebar but kept its history, cookies and passwords on disk.
test("deleting the original profile queues Chrome's default profile for deletion", () => {
  S().hydrate({});
  const work = S().createProfile({ name: "Work" });
  S().deleteProfile("default");
  assert.deepEqual(S().orphanedProfileData, [""]);
  S().deleteProfile(work);
  assert.deepEqual(S().orphanedProfileData, [""], "the last profile can't be deleted");
});

test("a profile sharing another's data leaves nothing to delete until the last one goes", () => {
  S().hydrate({});
  const shared = S().createProfile({ name: "Shared", shareWith: "default" });
  const other = S().createProfile({ name: "Other" });
  S().deleteProfile("default");
  assert.deepEqual(S().orphanedProfileData, []);
  S().deleteProfile(shared);
  assert.deepEqual(S().orphanedProfileData, [""]);
  S().createProfile({ name: "New" });
  S().deleteProfile(other);
  assert.deepEqual(S().orphanedProfileData, ["", other]);
});

test("queued profile data is deleted once, and stays queued in session.json until that succeeds", async () => {
  stub.docs.clear();
  stub.deletedProfileData.length = 0;
  stub.profileDataLeft.set("", ["passwords"]);
  S().hydrate({});
  const stop = startPersistence();
  const work = S().createProfile({ name: "Work" });
  S().createWindow({ profileId: work, url: "https://work.example/" });
  S().deleteProfile("default");
  await settle();
  assert.deepEqual(stub.deletedProfileData, [""]);
  assert.deepEqual(S().orphanedProfileData, [""], "a failed deletion stays queued");
  flushPersistence();
  stop();
  assert.deepEqual(loadSession().orphanedProfileData, [""]);

  // Next launch: it's tried again and leaves the queue once it succeeds.
  stub.profileDataLeft.clear();
  const again = startPersistence();
  await settle();
  assert.deepEqual(stub.deletedProfileData, ["", ""]);
  assert.deepEqual(S().orphanedProfileData, []);
  flushPersistence();
  assert.deepEqual(loadSession().orphanedProfileData, []);
  again();
});

test("deleting a profile keeps the data others share", () => {
  S().hydrate({});
  const a = S().createProfile({ name: "A" });
  S().importHistory(a, [{ url: "https://a.com/", title: "A", visits: 1, lastVisit: 2 }]);
  const bookmark = S().addBookmark({ profileId: a, url: "https://b.com/", title: "B" });
  const b = S().createProfile({ name: "B", shareWith: a });
  S().deleteProfile(a);
  assert.equal(S().profiles[a], undefined);
  assert.equal(model.engineProfile(b), a, "still on A's engine context");
  assert.ok(S().bookmarks.nodes[bookmark], "shared bookmarks stay");
  assert.deepEqual(S().history[b].map((h) => h.url), ["https://a.com/"]);
  S().importHistory(b, [{ url: "https://c.com/", title: "C", visits: 1, lastVisit: 3 }]);
  assert.equal(S().history[b].length, 2);
  S().deleteProfile(b);
  assert.equal(S().bookmarks.nodes[bookmark], undefined);
});
