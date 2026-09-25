// netnyahoo:// URLs in the store (core appUrls.ts). Run from apps/browser:
//   node --import ./src/store/test-loader.mjs --test src/store/appUrls.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { setAppUrlOpener } = await import("./tabs.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});

test("chrome:// and about: input is stored, loaded and labelled as netnyahoo://", () => {
  reset();
  const w = S().createWindow({ url: "chrome://version" });
  const tab = S().tabs[model.activeTabId(S(), w)];
  assert.equal(tab.url, "netnyahoo://version");
  assert.equal(tab.navigation.url, "netnyahoo://version");
  S().navigate(tab.id, "about:gpu");
  assert.equal(S().tabs[tab.id].navigation.url, "netnyahoo://gpu");
  assert.equal(model.tabLabel({ url: "netnyahoo://gpu/", title: "GPU Internals", customTitle: null }), "netnyahoo://gpu");
  assert.match(model.windowTitle(S(), w), /netnyahoo:\/\/version$/);
});

test("history and bookmarks keep the netnyahoo:// form, so they reopen", () => {
  reset();
  const w = S().createWindow({ url: "netnyahoo://version" });
  const tab = S().tabs[model.activeTabId(S(), w)];
  // What the web view reports for chrome://version/ (packages/cef WebView maps it).
  S().updateTab(tab.id, { url: "netnyahoo://version/", title: "About Version" });
  S().recordVisit(tab.profileId, "netnyahoo://version/", "About Version", null, true);
  assert.equal(S().history[tab.profileId][0].url, "netnyahoo://version/");
  const id = S().addBookmark({ profileId: tab.profileId, url: S().tabs[tab.id].url, title: "Version" });
  assert.equal(S().bookmarks.nodes[id].url, "netnyahoo://version/");
  const again = S().newTab(w, { url: S().bookmarks.nodes[id].url });
  assert.equal(S().tabs[again].navigation.url, "netnyahoo://version/");
});

test("app URLs that open elsewhere never make or change a tab", () => {
  reset();
  const opened = [];
  setAppUrlOpener((url, windowId) => {
    if (!url.startsWith("netnyahoo://settings")) return false;
    opened.push([url, windowId]);
    return true;
  });
  try {
    const w = S().createWindow({ url: "example.com" });
    const tab = model.activeTabId(S(), w);
    const before = S().tabs[tab];
    S().openPanel(w, "");
    S().navigate(tab, "chrome://settings");
    assert.equal(S().tabs[tab], before);
    assert.equal(S().windowUi[w].panel.open, false);
    assert.equal(S().newTab(w, { url: "netnyahoo://settings/passwords" }), "");
    assert.equal(model.viewTabIds(S(), w).length, 1);
    assert.deepEqual(opened, [
      ["netnyahoo://settings", w],
      ["netnyahoo://settings/passwords", w],
    ]);
    // Everything else still loads in the tab.
    S().navigate(tab, "netnyahoo://extensions");
    assert.equal(S().tabs[tab].navigation.url, "netnyahoo://extensions");
  } finally {
    setAppUrlOpener(() => false);
  }
});
