import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { mainWindowFor } = await import("./small.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const tabOf = (w) => S().tabs[model.activeTabId(S(), w)];

test("Small Yahu holds one page; new tabs from it open behind in a main window", () => {
  reset();
  const main = S().createWindow({ url: "a.com" });
  const small = S().createWindow({ small: true, url: "b.com" });
  assert.equal(S().windows[small].kind, "small");
  assert.equal(S().windows[small].sidebarOpen, false);
  assert.equal(S().windows[small].frame, null);
  assert.equal(S().windows[small].profileId, "default");
  const opened = S().newTab(small, { url: "c.com", background: true, openerId: tabOf(small).id });
  assert.equal(S().windows[small].tabIds.length, 1);
  assert.equal(S().tabs[opened].windowId, main);
  assert.equal(tabOf(main).url, "https://a.com", "a background tab doesn't take over the main window");
  assert.equal(model.resolveWindowId(S(), null), main, "without a window named, Small Yahu is never the target");
  assert.equal(mainWindowFor(S()), main);
});

test("a new tab from Small Yahu with no main window opens one", () => {
  reset();
  const small = S().createWindow({ small: true, url: "b.com" });
  const opened = S().newTab(small, { url: "c.com", background: true });
  const w = S().tabs[opened].windowId;
  assert.notEqual(w, small);
  assert.equal(S().windows[w].kind, undefined);
});

test("closing Small Yahu throws the page away; ⇧⌘T brings it back in Small Yahu", () => {
  reset();
  const main = S().createWindow({ url: "a.com" });
  const small = S().createWindow({ small: true, url: "b.com" });
  const tabId = tabOf(small).id;
  S().closeTab(tabId);
  assert.equal(S().windows[small], undefined);
  assert.equal(S().closedWindows.length, 0, "not a closed window");
  const entry = S().closedTabs.at(-1);
  assert.equal(entry.small, true);
  assert.equal(entry.tab.url, "https://b.com");
  S().reopenClosed(main);
  const reopened = S().windowOrder.find((id) => S().windows[id].kind === "small");
  assert.ok(reopened, "reopens in a Small Yahu");
  assert.equal(S().windows[main].tabIds.length, 1, "not as a tab of the main window");
  assert.equal(tabOf(reopened).url, "https://b.com");
  assert.equal(tabOf(reopened).adoptId, `restore:${tabId}`, "with its back/forward list");
});

test("⇧⌘T from Small Yahu restores a regular tab into the main window", () => {
  reset();
  const main = S().createWindow({ url: "a.com" });
  const b = S().newTab(main, { url: "b.com" });
  S().closeTab(b);
  const small = S().createWindow({ small: true, url: "c.com" });
  S().reopenClosed(small);
  assert.equal(S().windows[small].tabIds.length, 1);
  assert.equal(model.viewTabIds(S(), main).length, 2);
});

test("⌘O moves the page into the frontmost main window of its profile", () => {
  reset();
  const work = S().createProfile({ name: "Work", color: "blue" });
  const personal = S().createWindow({ url: "a.com" });
  const workWindow = S().createWindow({ url: "w.com", profileId: work });
  S().setFocusedWindow(personal);
  const small = S().createWindow({ small: true, url: "b.com", profileId: work });
  const tabId = tabOf(small).id;
  const target = mainWindowFor(S(), S().tabs[tabId].profileId);
  assert.equal(target, workWindow, "the frontmost main window showing the page's profile, not just the frontmost");
  S().moveTabsToWindow([tabId], target);
  assert.equal(S().windows[small], undefined, "Small Yahu closes with its page gone");
  assert.equal(S().tabs[tabId].windowId, target);
  assert.equal(model.activeTabId(S(), target), tabId);
});

test("Small Yahu remembers its size, never its position", () => {
  reset();
  S().createWindow({ url: "a.com" });
  const small = S().createWindow({ small: true, url: "b.com" });
  S().setWindowFrame(small, [100, 200, 1000, 700]);
  assert.deepEqual(S().settings.smallYahuSize, [1000, 700]);
  S().setWindowFrame(small, [300, 50, 1000, 700]);
  assert.deepEqual(S().settings.smallYahuSize, [1000, 700]);
});

test("a new Small Yahu takes the profile the frontmost main window shows", () => {
  reset();
  const work = S().createProfile({ name: "Work", color: "blue" });
  S().createWindow({ url: "a.com" });
  const workWindow = S().createWindow({ url: "w.com", profileId: work });
  S().setFocusedWindow(workWindow);
  const small = S().createWindow({ small: true });
  assert.equal(S().windows[small].profileId, work);
  assert.equal(S().windows[small].tabIds.length, 1);
  assert.equal(S().parkedPins[work], undefined);
});

test("tabs can't be moved or merged into Small Yahu", () => {
  reset();
  const main = S().createWindow({ url: "a.com" });
  const b = S().newTab(main, { url: "b.com" });
  const small = S().createWindow({ small: true, url: "c.com" });
  S().moveTabsToWindow([b], small);
  assert.equal(S().tabs[b].windowId, main);
  S().mergeAllWindows(small);
  assert.equal(S().windows[small].tabIds.length, 1);
  assert.equal(model.viewTabIds(S(), main).length, 2);
});
