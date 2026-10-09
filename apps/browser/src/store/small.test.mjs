// Which profile and window a link from another app (and a new Little Arcadia) uses: the last active window's, as Chrome's
// AppController picks its last profile, private windows counting as the profile they were opened from.
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { lastActiveProfile, mainWindowFor } = await import("./small.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../lib/persist.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

// Two profiles; window A pages to Work, window B stays on Personal.
function twoProfilesTwoWindows() {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const work = S().createProfile({ name: "Work" });
  const a = S().createWindow({ url: "https://a.example/" });
  const b = S().createWindow({ url: "https://b.example/" });
  S().setFocusedWindow(a);
  S().switchProfile(a, work);
  return { work, a, b };
}

// What components/littleArcadia/actions.ts does with one link from another app (its imports need the app, not Node):
// a Little Arcadia with no profile asked for, so the store picks it.
const openExternalUrls = ([url]) => S().createWindow({ small: true, url });
// ⌘O: the page moves to the frontmost main window of its profile.
const openInMainWindow = (id) => {
  const tab = S().windows[id].tabIds[0];
  S().moveTabsToWindow([tab], mainWindowFor(S(), S().tabs[tab].profileId) ?? null);
};

const smallWindows = () => Object.values(S().windows).filter((w) => w.kind === "small");
const lastSmall = () => smallWindows().at(-1);

test("a link from another app opens Little Arcadia in the profile of the last active window, not the default one", () => {
  const { work, a } = twoProfilesTwoWindows();
  assert.equal(S().settings.defaultProfileId, "default");
  assert.equal(lastActiveProfile(S()), work);
  openExternalUrls(["https://link.example/"]);
  const small = lastSmall();
  assert.equal(small.profileId, work);
  assert.equal(S().tabs[small.tabIds[0]].profileId, work);
  assert.equal(S().tabs[small.tabIds[0]].url, "https://link.example/");
  // ⌘O takes it to the window the user came from, on that profile.
  assert.equal(mainWindowFor(S(), work), a);
  openInMainWindow(small.id);
  assert.equal(smallWindows().length, 0);
  assert.ok(S().windows[a].tabIds.some((t) => S().tabs[t].url === "https://link.example/" && S().tabs[t].profileId === work));
});

test("with several windows, the one used last wins, even after another app took focus", () => {
  const { work, a, b } = twoProfilesTwoWindows();
  S().setFocusedWindow(b);
  // Another app comes forward: no Arcadia window is key, nothing changes in the store.
  openExternalUrls(["https://one.example/"]);
  assert.equal(lastSmall().profileId, "default");
  S().setFocusedWindow(a);
  openExternalUrls(["https://two.example/"]);
  assert.equal(lastSmall().profileId, work);
});

test("paging the focused window to another profile makes that profile the last active one", () => {
  const { work, a } = twoProfilesTwoWindows();
  S().switchProfile(a, "default");
  assert.equal(lastActiveProfile(S()), "default");
  S().switchProfile(a, work);
  assert.equal(lastActiveProfile(S()), work);
});

test("several links, or the setting off, go to the last active window and its profile", () => {
  const { work, a, b } = twoProfilesTwoWindows();
  S().setFocusedWindow(b);
  S().switchProfile(b, work);
  S().setFocusedWindow(a);
  assert.equal(lastActiveProfile(S()), work);
  assert.equal(mainWindowFor(S(), lastActiveProfile(S())), a);
});

test("a private window counts as the regular profile it was opened from; Little Arcadia is never private", () => {
  const { work, a, b } = twoProfilesTwoWindows();
  const priv = S().createWindow({ incognito: true });
  assert.equal(S().windows[priv].originalProfileId, work);
  S().setFocusedWindow(b);
  S().setFocusedWindow(priv);
  assert.equal(lastActiveProfile(S()), work);
  openExternalUrls(["https://p.example/"]);
  const small = lastSmall();
  assert.equal(small.incognito, false);
  assert.equal(small.profileId, work);
  // ⌘O goes to a regular window of that profile, never the private one.
  assert.equal(mainWindowFor(S(), work), a);
  // It stays remembered after the private window closes (Chrome's last-used profile is its original profile).
  S().closeWindow(small.id);
  S().closeWindow(priv);
  assert.equal(lastActiveProfile(S()), work);
  openExternalUrls(["https://q.example/"]);
  assert.equal(lastSmall().profileId, work);
});

test("a private window opened from Personal counts as Personal", () => {
  const { b } = twoProfilesTwoWindows();
  S().setFocusedWindow(b);
  const priv = S().createWindow({ incognito: true });
  assert.equal(S().windows[priv].originalProfileId, "default");
  assert.equal(lastActiveProfile(S()), "default");
});

test("the window in front closing hands over to the next most recent window's profile", () => {
  const { work, a, b } = twoProfilesTwoWindows();
  const c = S().createWindow({ url: "https://c.example/" });
  S().setFocusedWindow(b);
  S().setFocusedWindow(a);
  assert.equal(lastActiveProfile(S()), work);
  S().closeWindow(a);
  assert.equal(lastActiveProfile(S()), "default");
  assert.equal(S().ui.focusedWindowId, b);
  openExternalUrls(["https://after-close.example/"]);
  assert.equal(lastSmall().profileId, "default");
  // Closing Little Arcadia leaves B's profile; paging B to Work and closing a window behind it changes nothing.
  S().closeWindow(lastSmall().id);
  S().setFocusedWindow(b);
  S().switchProfile(b, work);
  S().closeWindow(c);
  assert.equal(lastActiveProfile(S()), work);
  // The last window closing keeps its profile for the next link (no window: one opens).
  S().closeWindow(b);
  assert.equal(Object.keys(S().windows).length, 0);
  assert.equal(lastActiveProfile(S()), work);
});

test("a deleted profile falls back to the window used before, then the default profile", () => {
  const { work, b } = twoProfilesTwoWindows();
  S().deleteProfile(work);
  assert.equal(S().profiles[work], undefined);
  assert.equal(lastActiveProfile(S()), S().windows[b].profileId);
  openExternalUrls(["https://after-delete.example/"]);
  assert.equal(lastSmall().profileId, "default");
});

test("the last active profile survives a quit and relaunch", () => {
  stub.docs.clear();
  const stop = startPersistence();
  const { work, b } = twoProfilesTwoWindows();
  const priv = S().createWindow({ incognito: true });
  S().setFocusedWindow(b);
  S().setFocusedWindow(priv);
  flushPersistence();
  stop();
  const saved = loadSession();
  assert.equal(saved.lastProfileId, work);
  S().hydrate(saved);
  assert.equal(S().ui.lastProfileId, work);
  // Before any restored window becomes key (or with none restored), the remembered Work wins over B (Personal), the
  // last regular window in front; the private window isn't restored.
  assert.equal(S().ui.focusedWindowId, b);
  openExternalUrls(["https://after-relaunch.example/"]);
  assert.equal(lastSmall().profileId, work);
  // A profile deleted since (or a session from another build) is forgotten: the focused window's profile counts.
  S().hydrate({ ...saved, lastProfileId: "gone" });
  assert.equal(S().ui.lastProfileId, null);
  assert.equal(lastActiveProfile(S()), "default");
  stub.docs.clear();
});
