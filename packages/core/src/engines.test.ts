import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allEngines,
  BUILT_IN_ENGINES,
  controllingExtensionEngine,
  engineById,
  extensionEnginesFromChrome,
  engineHost,
  makeCustomEngine,
  parseSuggestions,
  searchUrl,
  suggestRequestUrl,
  validateEngine,
} from "./engines.ts";

test("every built-in engine searches with a %s template and has a unique id / keyword", () => {
  const names = BUILT_IN_ENGINES.map((e) => e.name);
  for (const expected of ["Google", "Bing", "DuckDuckGo", "Perplexity", "ChatGPT", "Ecosia", "Brave Search", "Kagi", "Startpage", "Yahoo", "Baidu", "Yandex"]) {
    assert.ok(names.includes(expected), expected);
  }
  assert.equal(new Set(BUILT_IN_ENGINES.map((e) => e.id)).size, BUILT_IN_ENGINES.length);
  assert.equal(new Set(BUILT_IN_ENGINES.map((e) => e.keyword)).size, BUILT_IN_ENGINES.length);
  for (const e of BUILT_IN_ENGINES) {
    assert.match(e.url, /^https:\/\/[^%]+%s/, e.id);
    if (e.suggestUrl) assert.match(e.suggestUrl, /%s/, e.id);
  }
});

test("search URLs encode the query", () => {
  const byId = (id: string) => engineById(BUILT_IN_ENGINES, id);
  assert.equal(searchUrl(byId("google"), "c++ & rust"), "https://www.google.com/search?q=c%2B%2B%20%26%20rust");
  assert.equal(searchUrl(byId("yahoo"), "cats"), "https://search.yahoo.com/search?p=cats");
  assert.equal(searchUrl(byId("chatgpt"), "cats"), "https://chatgpt.com/?q=cats");
  assert.equal(searchUrl(byId("perplexity"), "cats"), "https://www.perplexity.ai/search?q=cats");
});

test("suggestion endpoints for Google, Bing and DuckDuckGo; none for engines without one", () => {
  const byId = (id: string) => engineById(BUILT_IN_ENGINES, id);
  assert.equal(suggestRequestUrl(byId("google"), "ca t")?.endsWith("&q=ca%20t"), true);
  assert.equal(suggestRequestUrl(byId("bing"), "cat"), "https://api.bing.com/osjson.aspx?query=cat");
  assert.equal(suggestRequestUrl(byId("duckduckgo"), "cat"), "https://duckduckgo.com/ac/?q=cat&type=list");
  assert.equal(suggestRequestUrl(byId("perplexity"), "cat"), null);
  assert.equal(suggestRequestUrl(byId("google"), "  "), null);
});

test("parseSuggestions reads OpenSearch JSON and ignores junk", () => {
  assert.deepEqual(parseSuggestions(["cat", ["cats", " cat food ", 3, ""], [], {}]), ["cats", "cat food"]);
  assert.deepEqual(parseSuggestions({ results: [] }), []);
  assert.deepEqual(parseSuggestions(null), []);
});

test("engineById falls back to Google; engineHost gives the favicon host", () => {
  assert.equal(engineById(BUILT_IN_ENGINES, "gone").id, "google");
  assert.equal(engineHost(engineById(BUILT_IN_ENGINES, "brave")), "search.brave.com");
  assert.equal(engineHost({ url: "https://www.google.com/search?q=%s" }), "google.com");
});

test("custom engines: validation and normalisation", () => {
  const engines = allEngines([{ id: "c1", name: "Wikipedia", keyword: "w", url: "https://en.wikipedia.org/w/index.php?search=%s" }]);
  assert.equal(engines.at(-1)?.custom, true);
  const ok = { name: "MDN", keyword: "MDN", url: "https://developer.mozilla.org/search?q=%s" };
  assert.equal(validateEngine(ok, engines), null);
  assert.deepEqual(makeCustomEngine({ ...ok, name: " MDN " }, "c2"), { id: "c2", name: "MDN", keyword: "mdn", url: ok.url });
  assert.match(validateEngine({ ...ok, name: "" }, engines)!, /name/);
  assert.match(validateEngine({ ...ok, keyword: "m d" }, engines)!, /spaces/);
  assert.match(validateEngine({ ...ok, url: "ftp://x/%s" }, engines)!, /http/);
  assert.match(validateEngine({ ...ok, url: "https://x.com/search" }, engines)!, /%s/);
  assert.match(validateEngine({ ...ok, keyword: "W" }, engines)!, /already used/);
  assert.match(validateEngine({ ...ok, keyword: "google.com" }, engines)!, /already used/);
  // Editing an engine may keep its own keyword.
  assert.equal(validateEngine({ ...ok, keyword: "w" }, engines, "c1"), null);
});

// Chrome's getSearchEnginesList for a profile with two fixture extensions (one asking to be the
// default search engine), trimmed to the fields we read; the Bing entry shows a leftover
// template parameter, the omnibox keyword an extension's chrome.omnibox.
const CHROME_LIST = {
  defaults: [
    {
      id: 2,
      name: "DuckDuckGo Fixture",
      keyword: "ddgfix",
      url: "https://duckduckgo.com/?q=%s&t=nnfixture",
      suggestionsUrl: "https://duckduckgo.com/ac/?q=%s&type=list",
      default: true,
      isOmniboxExtension: false,
      extension: { id: "dcielhccnenaljfdmekhnepaeenphgjp", name: "Search Fixture Default", canBeDisabled: true },
    },
    { id: 2, name: "No Search", keyword: "nosearch", url: "http://%s", suggestionsUrl: "", default: false, isOmniboxExtension: false },
    {
      id: 5,
      name: "Microsoft Bing",
      keyword: "bing.com",
      url: "https://www.bing.com/search?q=%s",
      suggestionsUrl: "https://www.bing.com/osjson.aspx?query=%s&language={language}",
      default: false,
      isOmniboxExtension: false,
    },
  ],
  actives: [{ id: 7, name: "Bookmarks", keyword: "@bookmarks", url: "chrome://bookmarks/?q=%s", suggestionsUrl: "", default: false, isOmniboxExtension: false }],
  others: [
    {
      id: 3,
      name: "Wikipedia Fixture",
      keyword: "wfix",
      url: "https://en.wikipedia.org/w/index.php?search=%s&lang={language}",
      suggestionsUrl: "",
      default: false,
      isOmniboxExtension: false,
      extension: { id: "lfkochledepkdapbginilfnephdpkfjc", name: "Search Fixture Extra", canBeDisabled: true },
    },
  ],
  extensions: [
    { id: 9, name: "Omni", keyword: "om", url: "chrome-extension://abc/?q=%s", default: false, isOmniboxExtension: true, extension: { id: "abc", name: "Omni" } },
  ],
};

test("extension engines come from Chrome's list, without omnibox keywords or template leftovers", () => {
  const engines = extensionEnginesFromChrome("", CHROME_LIST);
  assert.deepEqual(engines, [
    {
      profile: "",
      extensionId: "dcielhccnenaljfdmekhnepaeenphgjp",
      extensionName: "Search Fixture Default",
      name: "DuckDuckGo Fixture",
      keyword: "ddgfix",
      url: "https://duckduckgo.com/?q=%s&t=nnfixture",
      suggestUrl: "https://duckduckgo.com/ac/?q=%s&type=list",
      isDefault: true,
    },
    {
      profile: "",
      extensionId: "lfkochledepkdapbginilfnephdpkfjc",
      extensionName: "Search Fixture Extra",
      name: "Wikipedia Fixture",
      keyword: "wfix",
      url: "https://en.wikipedia.org/w/index.php?search=%s&lang=",
      suggestUrl: undefined,
      isDefault: false,
    },
  ]);
  assert.equal(controllingExtensionEngine(engines)?.extensionId, "dcielhccnenaljfdmekhnepaeenphgjp");
  assert.deepEqual(extensionEnginesFromChrome("", null), []);
});

test("extension engines follow the built-ins and custom ones, once per extension", () => {
  const fromProfiles = [...extensionEnginesFromChrome("", CHROME_LIST), ...extensionEnginesFromChrome("work", CHROME_LIST)];
  const engines = allEngines([{ id: "c1", name: "Wikipedia", keyword: "w", url: "https://en.wikipedia.org/w/index.php?search=%s" }], fromProfiles);
  const added = engines.filter((e) => e.extension);
  assert.deepEqual(
    added.map((e) => [e.id, e.name, e.extension?.name]),
    [
      ["extension:dcielhccnenaljfdmekhnepaeenphgjp", "DuckDuckGo Fixture", "Search Fixture Default"],
      ["extension:lfkochledepkdapbginilfnephdpkfjc", "Wikipedia Fixture", "Search Fixture Extra"],
    ],
  );
  assert.equal(engines.indexOf(added[0]!), BUILT_IN_ENGINES.length + 1);
  assert.equal(searchUrl(engineById(engines, "extension:dcielhccnenaljfdmekhnepaeenphgjp"), "a b"), "https://duckduckgo.com/?q=a%20b&t=nnfixture");
});
