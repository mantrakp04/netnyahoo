// Extension search engines in settings (components/extensions/searchEngines keeps them in sync).
// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/store/searchEngines.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { controllingSearchExtension, defaultSearchEngine, searchEngines, searchUrlPrefix } = await import("./settings.ts");

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

test("an extension that took the default search engine controls it until it goes", () => {
  const s = useBrowser.getState();
  s.updateSettings({ searchEngine: "bing", extensionSearchEngines: [ddg, wiki] });
  let settings = useBrowser.getState().settings;
  assert.equal(controllingSearchExtension(settings)?.extensionId, ddg.extensionId);
  assert.equal(defaultSearchEngine(settings).id, `extension:${ddg.extensionId}`);
  assert.equal(searchUrlPrefix(settings), ddg.url);
  assert.equal(searchEngines(settings), searchEngines(settings), "memoised");

  // Disabled: Chrome drops its engine, and the user's own choice is back.
  s.updateSettings({ extensionSearchEngines: [wiki] });
  settings = useBrowser.getState().settings;
  assert.equal(controllingSearchExtension(settings), undefined);
  assert.equal(defaultSearchEngine(settings).id, "bing");

  // A non-controlling extension engine can be picked like any other.
  s.setSearchEngine(`extension:${wiki.extensionId}`);
  assert.equal(defaultSearchEngine(useBrowser.getState().settings).name, "Wikipedia Fixture");
  s.updateSettings({ extensionSearchEngines: [] });
  assert.equal(defaultSearchEngine(useBrowser.getState().settings).id, "google", "a removed engine falls back to Google");
});
