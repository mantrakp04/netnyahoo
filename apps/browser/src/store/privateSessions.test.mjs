// Private windows are the off-the-record profile of the regular profile they were opened from (Chrome's
// GetPrimaryOTRProfile): one session per profile, shared by its private windows, never another profile's.
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { downloadVisibleIn, downloadsIn } = await import("./ui.ts");
const { lastActiveProfile, privateWindowProfile } = await import("./small.ts");
const { flushPersistence, startPersistence } = await import("../lib/persist.ts");
const { extensionProfile } = await import("../components/extensions/store.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

// Personal in window A, Work (profile 2) in window B, which is in front.
function twoProfiles() {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const work = S().createProfile({ name: "Work" });
  const a = S().createWindow({ url: "https://a.example/" });
  const b = S().createWindow({ profileId: work, url: "https://b.example/" });
  S().setFocusedWindow(b);
  return { work, a, b };
}
const engine = (w) => model.engineProfile(S().windows[w].profileId);
const session = (w) => model.privateSession(S().windows[w].profileId);
const download = (id, profile, offTheRecord) => ({
  id, url: `https://dl.example/${id}`, filename: id, path: `/tmp/${id}`, state: "downloading", paused: false, received: 0, total: 1,
  speed: 0, mimeType: "", profile, offTheRecord,
});

test("⇧⌘N from a profile-2 window opens profile 2's private session; Personal's is another", () => {
  const { work, a, b } = twoProfiles();
  const p2 = S().createWindow({ incognito: true });
  assert.equal(S().windows[p2].originalProfileId, work);
  assert.equal(S().tabs[S().windows[p2].tabIds[0]].profileId, S().windows[p2].profileId, "its tabs are its private profile's");
  assert.equal(engine(p2), `incognito:${p2}@${work}`, "the engine makes it from Work's off-the-record profile");
  assert.equal(session(p2), work);

  // From the private window itself: the same session.
  S().setFocusedWindow(p2);
  const p2b = S().createWindow({ incognito: true });
  assert.equal(session(p2b), work);
  assert.notEqual(engine(p2b), engine(p2), "each window has its own name; the engine shares the profile");

  // From Personal's window (the command names its window): Personal's session ("" is Chrome's Default).
  const p1 = S().createWindow({ incognito: true, profileId: "default" });
  assert.equal(engine(p1), `incognito:${p1}@`);
  assert.equal(session(p1), "");
  assert.notEqual(session(p1), session(p2));
  // Regular windows aren't in any private session.
  assert.equal(session(a), null);
  assert.equal(session(b), null);
});

test("a profile sharing another's data is in that profile's private session", () => {
  const { work } = twoProfiles();
  model.setSharedDataIds({ [work]: "" });
  try {
    const p = S().createWindow({ incognito: true, profileId: work });
    assert.equal(session(p), "");
    assert.equal(engine(p), `incognito:${p}@`);
  } finally {
    model.setSharedDataIds({});
  }
});

test("private windows don't page to another profile", () => {
  const { work } = twoProfiles();
  const p = S().createWindow({ incognito: true });
  const before = S().windows[p].profileId;
  S().switchProfile(p, "default");
  assert.equal(S().windows[p].profileId, before);
  assert.equal(session(p), work);
});

test("Little Arcadia from a profile-2 private window opens in profile 2, never privately (d9a8899e)", () => {
  const { work } = twoProfiles();
  const p = S().createWindow({ incognito: true });
  S().setFocusedWindow(p);
  assert.equal(lastActiveProfile(S()), work);
  const small = S().createWindow({ small: true, url: "https://link.example/" });
  assert.equal(S().windows[small].profileId, work);
  assert.ok(!S().windows[small].incognito);
});

test("a private session's downloads show in its windows only, never on disk, and go with its last window", async () => {
  stub.docs.clear();
  stub.cancelledDownloads.length = 0;
  const stop = startPersistence();
  const { work, a, b } = twoProfiles();
  const p2 = S().createWindow({ incognito: true });
  const p2b = S().createWindow({ incognito: true, profileId: work });
  const p1 = S().createWindow({ incognito: true, profileId: "default" });
  // As the engine reports them: the regular profile's name, and whether it's off the record.
  S().upsertDownload(download("private2", work, true));
  S().upsertDownload(download("private1", "", true));
  S().upsertDownload(download("regular2", work, false));
  const ids = (w) => downloadsIn(S(), w).map((d) => d.id).sort();
  assert.deepEqual(ids(p2), ["private2"]);
  assert.deepEqual(ids(p2b), ["private2"], "a second window of the session lists it too");
  assert.deepEqual(ids(p1), ["private1"]);
  assert.deepEqual(ids(a), [], "Personal's window lists none of Work's downloads");
  assert.deepEqual(ids(b), ["regular2"]);
  // A window paged to Work lists Work's; a download with no profile (an older build's) is Personal's.
  S().upsertDownload(download("old", undefined, undefined));
  assert.deepEqual(ids(a), ["old"]);
  S().switchProfile(a, work);
  assert.deepEqual(ids(a), ["regular2"]);
  flushPersistence();
  const saved = stub.docs.get("downloads.json") ?? "";
  assert.ok(saved.includes("regular2"));
  assert.ok(!saved.includes("private"), "no private download reaches disk");

  // One of profile 2's private windows closes: the session (and its download) stays.
  S().closeWindow(p2);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(ids(p2b), ["private2"]);
  assert.deepEqual(stub.cancelledDownloads, []);
  // Its last one closes: its downloads are cancelled and forgotten; Personal's session keeps its own.
  S().closeWindow(p2b);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(stub.cancelledDownloads, ["private2"]);
  assert.ok(!S().downloads.some((d) => d.id === "private2"));
  assert.deepEqual(ids(p1), ["private1"]);
  // The engine's late update doesn't bring it back, nor does one the app never saw, even into the profile's next session.
  S().upsertDownload({ ...download("private2", work, true), state: "cancelled" });
  S().upsertDownload(download("unseen", work, true));
  const next = S().createWindow({ incognito: true, profileId: work });
  S().upsertDownload({ ...download("private2", work, true), state: "cancelled" });
  S().upsertDownload(download("unseen", work, true));
  assert.deepEqual(ids(next), []);
  assert.ok(!downloadVisibleIn(download("x", work, true), S().windows[a]));
  stop();
});

test("a private window lists its own profile's extensions (incognito-allowed ones), off the record", () => {
  const { work } = twoProfiles();
  const p2 = S().createWindow({ incognito: true });
  const p1 = S().createWindow({ incognito: true, profileId: "default" });
  assert.equal(extensionProfile(S(), p2), work);
  assert.equal(extensionProfile(S(), p1), "");
});

test("a private window's bookmarks are its profile's", () => {
  const { work } = twoProfiles();
  const p2 = S().createWindow({ incognito: true });
  assert.equal(model.bookmarkProfileId(S(), S().windows[p2]), work);
});

test("Open Link in Incognito Window: the private window is the tab's profile's, whichever window hears it", () => {
  const { work, a, b } = twoProfiles();
  // Chrome made a private tab of Work's off-the-record profile; Personal's window announces it (openFromPage).
  assert.equal(privateWindowProfile(S(), S().windows[a], work), work);
  assert.equal(privateWindowProfile(S(), S().windows[b], ""), "default");
  // No tab of Chrome's (an older engine): the page's window's profile, a private window's being its original.
  assert.equal(privateWindowProfile(S(), S().windows[b]), work);
  const p = S().createWindow({ incognito: true, profileId: privateWindowProfile(S(), S().windows[b]) });
  assert.equal(privateWindowProfile(S(), S().windows[p]), work);
  assert.equal(S().windows[p].originalProfileId, work);
});

test("deleting a profile closes its private windows, not another profile's", () => {
  const { work } = twoProfiles();
  const p2 = S().createWindow({ incognito: true });
  const p1 = S().createWindow({ incognito: true, profileId: "default" });
  S().deleteProfile(work);
  assert.ok(!S().windows[p2]);
  assert.ok(S().windows[p1]);
});

test("relaunch: no private window, tab or id is saved", () => {
  stub.docs.clear();
  const stop = startPersistence();
  const { work } = twoProfiles();
  S().createWindow({ incognito: true, url: "https://secret.example/" });
  S().createWindow({ incognito: true, profileId: "default", url: "https://secret.example/" });
  flushPersistence();
  const saved = stub.docs.get("session.json") ?? "";
  assert.ok(saved.includes(work));
  assert.ok(!saved.includes("incognito:") && !saved.includes('"incognito":true') && !saved.includes("secret.example"));
  stop();
});
