import assert from "node:assert/strict";
import { test } from "node:test";
import { appUrlOrigin, appUrlParts, appUrlRoute, isAppUrl, toAppUrl, toEngineUrl } from "./appUrls.ts";
import { breadcrumb, classifyPaste, fixupUrl, resolveInput, urlForDisplay } from "./omnibox.ts";
import { displayUrl } from "./suggest.ts";

test("chrome://, about: and netnyahoo: spellings all become netnyahoo://", () => {
  assert.equal(toAppUrl("chrome://version/"), "netnyahoo://version/");
  assert.equal(toAppUrl("CHROME://Settings/Passwords?x=Y#Z"), "netnyahoo://settings/Passwords?x=Y#Z");
  assert.equal(toAppUrl("chrome:flags"), "netnyahoo://flags");
  assert.equal(toAppUrl("about:version"), "netnyahoo://version");
  assert.equal(toAppUrl("about:net-internals#dns"), "netnyahoo://net-internals#dns");
  assert.equal(toAppUrl("Netnyahoo:history"), "netnyahoo://history");
  assert.equal(toAppUrl("view-source:chrome://version/"), "view-source:netnyahoo://version/");
});

test("toAppUrl leaves real about: pages and everything else alone", () => {
  for (const url of ["about:blank", "about:blank#x", "about:srcdoc", "https://chrome.com/", "chrome-extension://abc/popup.html", "devtools://devtools/x", "chrome://", ""]) {
    assert.equal(toAppUrl(url), url, url);
  }
});

test("toEngineUrl: what the engine loads", () => {
  assert.equal(toEngineUrl("netnyahoo://version"), "chrome://version");
  assert.equal(toEngineUrl("NETNYAHOO://GPU/x?A"), "chrome://gpu/x?A");
  assert.equal(toEngineUrl("netnyahoo:flags"), "chrome://flags");
  assert.equal(toEngineUrl("view-source:netnyahoo://version/"), "view-source:chrome://version/");
  assert.equal(toEngineUrl("https://netnyahoo.com/"), "https://netnyahoo.com/");
  assert.equal(toEngineUrl("chrome://version/"), "chrome://version/");
  // Round trip.
  assert.equal(toAppUrl(toEngineUrl("netnyahoo://settings/languages")), "netnyahoo://settings/languages");
});

test("isAppUrl / appUrlParts / appUrlOrigin", () => {
  assert.equal(isAppUrl("netnyahoo://history"), true);
  assert.equal(isAppUrl("netnyahoo://"), false);
  assert.equal(isAppUrl("chrome://history"), false);
  assert.deepEqual(appUrlParts("netnyahoo://Settings/passwords?q=a#b"), { host: "settings", path: "/passwords", query: "?q=a", hash: "#b" });
  assert.equal(appUrlParts("https://x.com"), null);
  assert.equal(appUrlOrigin("chrome://version/"), "netnyahoo://version");
  assert.equal(appUrlOrigin("netnyahoo://history?q=cats"), "netnyahoo://history");
  assert.equal(appUrlOrigin("https://x.com"), null);
});

test("appUrlRoute: the app's pages, Settings, then Chrome's WebUI", () => {
  assert.deepEqual(appUrlRoute("netnyahoo://history?q=x"), { kind: "page", page: "history" });
  assert.deepEqual(appUrlRoute("netnyahoo://bookmarks"), { kind: "page", page: "bookmarks" });
  assert.deepEqual(appUrlRoute("netnyahoo://downloads/"), { kind: "page", page: "downloads" });
  assert.deepEqual(appUrlRoute("netnyahoo://settings"), { kind: "settings", section: null });
  assert.deepEqual(appUrlRoute("netnyahoo://settings/"), { kind: "settings", section: null });
  assert.deepEqual(appUrlRoute("netnyahoo://settings/passwords/x"), { kind: "settings", section: "passwords" });
  assert.deepEqual(appUrlRoute("netnyahoo://newtab/"), { kind: "newTab" });
  assert.deepEqual(appUrlRoute("netnyahoo://extensions"), { kind: "engine", url: "chrome://extensions" });
  assert.deepEqual(appUrlRoute("netnyahoo://version"), { kind: "engine", url: "chrome://version" });
  assert.equal(appUrlRoute("https://example.com/history"), null);
});

test("the command bar accepts every spelling and lands on netnyahoo://", () => {
  assert.equal(resolveInput("netnyahoo://version"), "netnyahoo://version");
  assert.equal(resolveInput("chrome://version"), "netnyahoo://version");
  assert.equal(resolveInput("about:version"), "netnyahoo://version");
  assert.equal(resolveInput("chrome://history"), "netnyahoo://history");
  assert.equal(resolveInput("netnyahoo:flags"), "netnyahoo://flags");
  assert.equal(resolveInput("about:blank"), "about:blank");
  assert.equal(resolveInput("netnyahoo"), "https://www.google.com/search?q=netnyahoo");
  assert.equal(fixupUrl("chrome-extension://abc/x.html"), "chrome-extension://abc/x.html");
  assert.deepEqual(classifyPaste("chrome://settings"), { kind: "go", url: "netnyahoo://settings" });
});

test("displayed URLs say netnyahoo://, never chrome://", () => {
  assert.equal(urlForDisplay("netnyahoo://version/"), "netnyahoo://version");
  assert.equal(urlForDisplay("chrome://version/"), "netnyahoo://version");
  assert.equal(urlForDisplay("chrome://settings/languages"), "netnyahoo://settings/languages");
  assert.equal(urlForDisplay("netnyahoo://history/?q=a"), "netnyahoo://history?q=a");
  assert.equal(displayUrl("chrome://gpu/"), "netnyahoo://gpu");
  assert.deepEqual(breadcrumb("netnyahoo://version/", "About Version"), { host: "netnyahoo://version", trail: ["About Version"] });
  assert.deepEqual(breadcrumb("netnyahoo://history", "History"), { host: "netnyahoo://history", trail: [] });
  assert.deepEqual(breadcrumb("chrome://flags/", "Experiments"), { host: "netnyahoo://flags", trail: ["Experiments"] });
});
