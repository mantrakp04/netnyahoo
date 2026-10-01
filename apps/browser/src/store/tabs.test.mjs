// Where tabs open, which tab shows when one closes, and the structures that must stay whole (groups, splits).
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const organize = await import("./organize.ts");
const { controllingSearchExtension, defaultSearchEngine, searchUrlPrefix } = await import("./settings.ts");
const media = await import("../components/media/state.ts");

const S = () => useBrowser.getState();
const view = (w) => model.viewTabIds(S(), w).map((id) => S().tabs[id].url);
const short = (url) => url.replace(/^https:\/\/|\.com$/g, "");
const hosts = (w) => S().windows[w].tabIds.map((id) => short(S().tabs[id].url));
const shown = (w) => short(S().tabs[model.activeTabId(S(), w)].url);

// Chrome's opener rules (store/openers.ts).
const reset = (settings = {}) => {
  S().hydrate({});
  S().updateSettings({ cmdClickCreatesTabGroup: false, newTabPosition: "bottom", ...settings });
};
const open = (w, url, opener, background = true) => S().newTab(w, { url: `${url}.com`, openerId: opener, background });
const setup = (...urls) => {
  const w = S().createWindow({ url: `${urls[0]}.com` });
  const ids = [S().windows[w].tabIds[0], ...urls.slice(1).map((u) => S().newTab(w, { url: `${u}.com` }))];
  S().activate(ids[0]);
  return [w, ...ids];
};

test("links opened behind line up after their opener in order", () => {
  reset();
  const [w, a] = setup("a", "b");
  open(w, "c1", a);
  open(w, "c2", a);
  open(w, "c3", a);
  assert.deepEqual(hosts(w), ["a", "c1", "c2", "c3", "b"]);
  assert.equal(shown(w), "a", "opened behind: the opener stays in front");
});

test("closing a page opened in front returns to its opener unless you moved away", () => {
  reset();
  const [w, a, b] = setup("a", "b");
  const c = open(w, "c", a, false);
  S().closeTab(c);
  assert.equal(shown(w), "a");

  const d = open(w, "d", a, false);
  S().activate(b);
  S().activate(d);
  S().closeTab(d);
  assert.equal(shown(w), "b", "after moving away, the tab after it");
});

test("closing goes to the page's own tabs, then its siblings, then its opener", () => {
  reset();
  const [w, a] = setup("a", "b");
  const c1 = open(w, "c1", a);
  const c2 = open(w, "c2", a);
  S().activate(c1);
  const g = open(w, "g", c1);
  S().closeTab(c1);
  assert.equal(shown(w), "g", "a tab it opened");
  assert.equal(S().tabs[g].openerId, a, "a closed tab's tabs take its opener");
  S().activate(a);
  S().activate(c2);
  S().closeTab(c2);
  assert.equal(shown(w), "g", "a sibling");
  S().closeTab(g);
  assert.equal(shown(w), "a", "no siblings left: the opener");
});

test("closing a group that holds the shown tab shows the tab just above the group", () => {
  reset({ cmdClickCreatesTabGroup: true });
  const [w, pin, home] = setup("pin", "home");
  S().togglePin(pin);
  S().activate(home);
  S().activate(pin);
  const c1 = open(w, "c1", pin);
  open(w, "c2", pin);
  const group = Object.values(S().groups)[0];
  S().moveTab(home, 0);
  S().activate(c1);
  S().closeGroup(group.id);
  assert.equal(shown(w), "home", "not the pinned opener");
});

test("closing a pinned tab selects the regular tab the window showed last, not the neighbour", () => {
  reset();
  let clock = Date.now();
  const select = (id) => {
    const now = Date.now;
    Date.now = () => (clock += 1000);
    try {
      S().activate(id);
    } finally {
      Date.now = now;
    }
  };
  const [w, p, q, , b] = setup("p", "q", "a", "b", "c");
  S().togglePin(p);
  S().togglePin(q);
  select(b);
  select(q);
  select(p);
  S().closeTab(p);
  assert.equal(model.activeTabId(S(), w), b, "back to the regular tab used before the pinned ones");
  assert.ok(S().tabs[b].navigation);
  assert.notEqual(S().tabs[q].navigation, null, "the other pinned tab keeps its page");
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
  S().closeTab(a);
  assert.equal(S().closedWindows.at(-1).groups.length, 1);
});

test("hydrate drops broken splits", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const a = model.viewTabIds(S(), w)[0];
  const b = S().newTab(w, { url: "b.com" });
  S().hydrate({
    windows: S().windows,
    windowOrder: S().windowOrder,
    tabs: S().tabs,
    splits: {
      ok: { id: "ok", windowId: w, tabIds: [a, b], orientation: "horizontal", sizes: [0.5, 0.5] },
      stale: { id: "stale", windowId: w, tabIds: [a, "gone"], orientation: "horizontal", sizes: [0.5, 0.5] },
    },
  });
  assert.deepEqual(Object.keys(S().splits), ["ok"]);
});

test("clean up closes duplicates and stale tabs into Recently Cleaned, and restores", () => {
  reset();
  const [w, a, b, c, d] = setup("a", "b", "a", "d");
  const e = S().newTab(w, { url: "e.com" });
  S().pinTabs([d], true);
  const old = Date.now() - 13 * 3600_000;
  S().updateTab(b, { lastActiveAt: old });
  S().updateTab(d, { lastActiveAt: old });
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

test("abandoned New Tab cleanup never closes a window or the tab it shows", () => {
  reset();
  const w = S().createWindow();
  S().newTab(w, { background: true });
  const front = S().newTab(w);
  S().closeAbandonedNewTabs();
  assert.deepEqual(S().windows[w].tabIds, [front]);
  const p = S().createProfile({ name: "Work" });
  S().switchProfile(w, p);
  const work = model.activeTabId(S(), w);
  S().switchProfile(w, "default");
  S().closeAbandonedNewTabs();
  assert.ok(S().tabs[work] && S().tabs[front]);
  const w2 = S().createWindow();
  S().newTab(w2);
  useBrowser.setState((s) => ({ windows: { ...s.windows, [w2]: { ...s.windows[w2], activeTabIds: {} } } }));
  S().closeAbandonedNewTabs();
  assert.equal(S().windows[w2].tabIds.length, 1);
});

test("an extension that took the default search engine controls it until it goes", () => {
  reset();
  const ddg = {
    profile: "",
    extensionId: "dcielhccnenaljfdmekhnepaeenphgjp",
    extensionName: "Search Fixture Default",
    name: "DuckDuckGo Fixture",
    keyword: "ddgfix",
    url: "https://duckduckgo.com/?q=%s&t=nnfixture",
    isDefault: true,
  };
  const wiki = { ...ddg, extensionId: "lfkochledepkdapbginilfnephdpkfjc", extensionName: "Search Fixture Extra", name: "Wikipedia Fixture", keyword: "wfix", url: "https://en.wikipedia.org/w/index.php?search=%s", isDefault: false };
  S().updateSettings({ searchEngine: "bing", extensionSearchEngines: [ddg, wiki] });
  assert.equal(controllingSearchExtension(S().settings)?.extensionId, ddg.extensionId);
  assert.equal(defaultSearchEngine(S().settings).id, `extension:${ddg.extensionId}`);
  assert.equal(searchUrlPrefix(S().settings), ddg.url);

  S().updateSettings({ extensionSearchEngines: [wiki] });
  assert.equal(controllingSearchExtension(S().settings), undefined);
  assert.equal(defaultSearchEngine(S().settings).id, "bing");

  S().setSearchEngine(`extension:${wiki.extensionId}`);
  assert.equal(defaultSearchEngine(S().settings).name, "Wikipedia Fixture");
  S().updateSettings({ extensionSearchEngines: [] });
  assert.equal(defaultSearchEngine(S().settings).id, "google", "a removed engine falls back to Google");
});

// 0.2.12: the mini player's × paused the video and jumped to its tab. Dismissing it lasts until the tab plays again.
test("closing the mini player lasts until its tab plays again", async () => {
  const M = () => media.useMedia.getState();
  const report = (overrides = {}) => ({
    title: "Song", artist: "Band", album: "", artwork: null, playbackState: "playing", position: 10, duration: 200,
    playbackRate: 1, timestamp: Date.now(), hasVideo: false, actions: ["play", "pause"], ...overrides,
  });
  reset();
  const w = S().createWindow({ url: "a.com" });
  const [a] = model.viewTabIds(S(), w);
  const b = S().newTab(w, { url: "b.com", background: true });
  const c = S().newTab(w, { url: "c.com", background: true });

  media.setNowPlaying(b, report());
  media.setNowPlaying(c, report({ playbackState: "paused" }));
  assert.equal(media.playerTabFor(M(), [a, b, c]), b, "the tab that played");
  media.setNowPlaying(b, report({ playbackState: "paused" }));
  await new Promise((resolve) => setTimeout(resolve, 3));
  media.setNowPlaying(c, report());
  assert.equal(media.playerTabFor(M(), [a, b, c]), c, "the tab that played last");

  media.useMedia.setState({ dismissed: { [c]: true } });
  assert.equal(media.playerTabFor(M(), [a, b, c]), b);
  media.setNowPlaying(c, report({ position: 30 }));
  assert.equal(M().dismissed[c], true, "still playing: stays dismissed");
  media.setNowPlaying(c, report({ playbackState: "paused" }));
  media.setNowPlaying(c, report());
  assert.equal(M().dismissed[c], undefined, "played again");
  assert.equal(media.playerTabFor(M(), [a, b, c]), c);

  S().closeTab(b);
  assert.equal(M().sessions[b], undefined);
});
