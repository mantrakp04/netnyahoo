import assert from "node:assert/strict";
import { test } from "node:test";
import { breadcrumb, classifyPaste, fixupUrl, hostOf, parseUrl, resolveInput, searchUrlFor, urlForDisplay } from "./omnibox.ts";

test("resolveInput turns typed text into a URL", () => {
  assert.equal(resolveInput("apple.com"), "https://apple.com");
  assert.equal(resolveInput("localhost:3000"), "http://localhost:3000");
  assert.equal(resolveInput("192.168.1.1/admin"), "http://192.168.1.1/admin");
  assert.equal(resolveInput("https://x.com/home"), "https://x.com/home");
  assert.equal(resolveInput("about:blank"), "about:blank");
  assert.equal(resolveInput("how to cook rice"), "https://www.google.com/search?q=how%20to%20cook%20rice");
  assert.equal(resolveInput("react"), "https://www.google.com/search?q=react");
  assert.equal(resolveInput("   "), "");
});

test("resolveInput takes an engine template or a prefix", () => {
  assert.equal(resolveInput("cats", "https://duckduckgo.com/?q=%s&ia=web"), "https://duckduckgo.com/?q=cats&ia=web");
  assert.equal(resolveInput("cats", "https://www.bing.com/search?q="), "https://www.bing.com/search?q=cats");
  assert.equal(searchUrlFor("https://x.test/%s/%s", "a b"), "https://x.test/a%20b/a%20b");
});

test("a leading ? forces a search, like Chrome", () => {
  assert.equal(resolveInput("?apple.com"), "https://www.google.com/search?q=apple.com");
  assert.equal(resolveInput("?"), "");
});

test("fixupUrl: ports, IPv6, local names, schemes and file paths", () => {
  assert.equal(fixupUrl("example.com:8080/x"), "https://example.com:8080/x");
  assert.equal(fixupUrl("[::1]:8080"), "http://[::1]:8080");
  assert.equal(fixupUrl("printer.local"), "http://printer.local");
  assert.equal(fixupUrl("myapp.localhost:5173"), "http://myapp.localhost:5173");
  assert.equal(fixupUrl("HTTPS://Example.com/Path"), "https://Example.com/Path");
  assert.equal(fixupUrl("file:///Users/me/a.html"), "file:///Users/me/a.html");
  assert.equal(fixupUrl("/Users/me/My File.html"), "file:///Users/me/My%20File.html");
  assert.equal(fixupUrl("mailto:hi@example.com"), "mailto:hi@example.com");
  assert.equal(fixupUrl("xn--bcher-kva.example"), null); // unknown TLD, no path
  assert.equal(fixupUrl("bücher.de"), null); // not ASCII: search it
  assert.equal(fixupUrl("en.wikipedia.org/wiki/Cat"), "https://en.wikipedia.org/wiki/Cat");
  assert.equal(fixupUrl("github.io"), "https://github.io");
  assert.equal(fixupUrl("example.co.uk"), "https://example.co.uk");
});

test("fixupUrl leaves searches alone: file names, emails, prose, unknown schemes", () => {
  for (const text of ["index.html", "node.js", "hi@example.com", "what is apple.com", "note: buy milk", "c++", "javascript:alert(1)", "1.5", "e.g."]) {
    assert.equal(fixupUrl(text), null, text);
  }
  // …unless a path or port makes the intent clear.
  assert.equal(fixupUrl("docs.internal/setup"), "http://docs.internal/setup");
  assert.equal(fixupUrl("site.photography/about"), "https://site.photography/about");
});

test("classifyPaste: URLs go (tracker-free), anything else searches", () => {
  assert.deepEqual(classifyPaste("  https://news.site/a?utm_source=tw&id=1 \n"), { kind: "go", url: "https://news.site/a?id=1" });
  assert.deepEqual(classifyPaste("apple.com"), { kind: "go", url: "https://apple.com" });
  assert.deepEqual(classifyPaste("best  pizza\nnear me"), { kind: "search", query: "best pizza near me" });
  assert.deepEqual(classifyPaste("javascript:alert(1)"), { kind: "search", query: "javascript:alert(1)" });
  assert.equal(classifyPaste("   "), null);
});

test("parseUrl / hostOf work without the platform URL class", () => {
  assert.deepEqual(parseUrl("https://user@WWW.Example.com:8443/a/b?x=1#h"), {
    scheme: "https",
    host: "www.example.com",
    port: "8443",
    path: "/a/b",
    query: "?x=1",
    hash: "#h",
  });
  assert.equal(hostOf("https://www.youtube.com/watch?v=1"), "youtube.com");
  assert.equal(hostOf("not a url"), "");
});

test("breadcrumb mirrors Dia's host / title trail", () => {
  assert.deepEqual(breadcrumb("https://x.com/home", "Home / X"), { host: "x.com", trail: ["Home", "X"] });
  assert.deepEqual(breadcrumb("https://github.com/", "GitHub · Change is constant. · GitHub"), {
    host: "github.com",
    trail: ["GitHub", "Change is constant."],
  });
});

test("urlForDisplay drops the scheme and www, and shows safe IDNs in Unicode", () => {
  assert.equal(urlForDisplay("https://www.example.com/a?b#c"), "example.com/a?b#c");
  assert.equal(urlForDisplay("http://localhost:3000/"), "localhost:3000/");
  assert.equal(urlForDisplay("https://xn--mnchen-3ya.de/stadt"), "münchen.de/stadt");
  assert.equal(urlForDisplay("https://xn--80ak6aa92e.com/"), "xn--80ak6aa92e.com/");
  assert.equal(urlForDisplay("file:///Users/me/a.html"), "/Users/me/a.html");
  assert.equal(breadcrumb("https://www.xn--mnchen-3ya.de/", "München").host, "münchen.de");
});
