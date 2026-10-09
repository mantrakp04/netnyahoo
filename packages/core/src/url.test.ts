// Typed text → URL, and the URL checks that protect the user: lookalike hosts, tracking parameters, app URLs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PSL_TLDS } from "./tlds.ts";
import { domainToASCII } from "node:url";
import { cleanUrl } from "./cleanUrl.ts";
import { displayHost, hostSpoofReason, punycodeEncode } from "./idn.ts";
import { breadcrumb, fixupUrl, resolveInput, urlForDisplay } from "./omnibox.ts";
import { displayUrl } from "./suggest.ts";

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

test("fixupUrl: ports, IPv6, local names, schemes and file paths", () => {
  assert.equal(fixupUrl("example.com:8080/x"), "https://example.com:8080/x");
  assert.equal(fixupUrl("[::1]:8080"), "http://[::1]:8080");
  assert.equal(fixupUrl("printer.local"), "http://printer.local");
  assert.equal(fixupUrl("myapp.localhost:5173"), "http://myapp.localhost:5173");
  assert.equal(fixupUrl("HTTPS://Example.com/Path"), "https://Example.com/Path");
  assert.equal(fixupUrl("file:///Users/me/a.html"), "file:///Users/me/a.html");
  assert.equal(fixupUrl("/Users/me/My File.html"), "file:///Users/me/My%20File.html");
  assert.equal(fixupUrl("mailto:hi@example.com"), "mailto:hi@example.com");
  assert.equal(fixupUrl("xn--bcher-kva.example"), null);
  assert.equal(fixupUrl("bücher.de"), "https://bücher.de");
  assert.equal(fixupUrl("en.wikipedia.org/wiki/Cat"), "https://en.wikipedia.org/wiki/Cat");
  assert.equal(fixupUrl("github.io"), "https://github.io");
  assert.equal(fixupUrl("example.co.uk"), "https://example.co.uk");
});

test("fixupUrl leaves searches alone: file names, emails, prose, unknown schemes", () => {
  for (const text of ["index.html", "node.js", "hi@example.com", "what is apple.com", "note: buy milk", "c++", "javascript:alert(1)", "1.5", "e.g."]) {
    assert.equal(fixupUrl(text), null, text);
  }
  assert.equal(fixupUrl("docs.internal/setup"), "http://docs.internal/setup");
  assert.equal(fixupUrl("site.photography/about"), "https://site.photography/about");
});

const ascii = (unicode: string) => {
  const host = domainToASCII(unicode);
  assert.ok(host, `${unicode} should be a valid IDN`);
  return host;
};
const shown = (unicode: string) => displayHost(ascii(unicode));

test("mixing Latin with Cyrillic or Greek stays punycode", () => {
  assert.equal(shown("аpple.com"), "xn--pple-43d.com");
  assert.equal(hostSpoofReason(ascii("аpple.com")), "mixedScripts");
  assert.equal(hostSpoofReason(ascii("gοogle.net")), "mixedScripts");
  assert.equal(hostSpoofReason(ascii("пα.com")), "mixedScripts");
});

test("whole-script confusables stay punycode outside their TLDs", () => {
  assert.equal(shown("аррӏе.com"), "xn--80ak6aa92e.com");
  assert.equal(hostSpoofReason("xn--80ak6aa92e.com"), "wholeScriptConfusable");
  assert.equal(shown("аррӏе.ru"), "аррӏе.ru");
  assert.equal(shown("аррӏе.рф"), "аррӏе.рф");
  assert.equal(hostSpoofReason(ascii("ικα.com")), "wholeScriptConfusable");
  assert.equal(shown("ικα.gr"), "ικα.gr");
  assert.equal(hostSpoofReason(ascii("ოყ.com")), "wholeScriptConfusable");
  assert.equal(hostSpoofReason(ascii("ทน.com")), "wholeScriptConfusable");
  assert.equal(hostSpoofReason(ascii("օս.com")), "wholeScriptConfusable");
});

test("dangerous patterns", () => {
  assert.equal(hostSpoofReason(ascii("aノb.com")), "dangerousPattern");
  assert.equal(hostSpoofReason(ascii("abcン.com")), "dangerousPattern");
  assert.equal(hostSpoofReason(ascii("カヘカ.jp")), null);
  assert.equal(hostSpoofReason(ascii("カへカ.jp")), "dangerousPattern");
  assert.equal(hostSpoofReason(ascii("ーabc.jp")), "dangerousPattern");
  assert.equal(hostSpoofReason("xn--" + punycodeEncode("ai\u0307b") + ".com"), "dangerousPattern");
  assert.equal(hostSpoofReason(ascii("oհ.com")), "dangerousPattern");
});

test("cleanUrl drops campaign and click-id parameters", () => {
  assert.equal(
    cleanUrl("https://example.com/post?utm_source=newsletter&utm_medium=email&utm_campaign=fall"),
    "https://example.com/post",
  );
  assert.equal(cleanUrl("https://example.com/?fbclid=IwAR0abc"), "https://example.com/");
  assert.equal(cleanUrl("https://shop.example/item?id=42&gclid=Cj0KCQ&color=red"), "https://shop.example/item?id=42&color=red");
  assert.equal(cleanUrl("https://news.example/a?mc_eid=123&mc_cid=456&page=2"), "https://news.example/a?page=2");
  assert.equal(cleanUrl("https://x.example/?_hsenc=p2A&_hsmi=1&msclkid=9"), "https://x.example/");
  assert.equal(cleanUrl("https://example.com/?UTM_Source=caps"), "https://example.com/");
});

test("cleanUrl keeps the rest of the URL exactly as it was", () => {
  assert.equal(cleanUrl("https://example.com/a?q=a%20b&utm_source=x#section-2"), "https://example.com/a?q=a%20b#section-2");
  assert.equal(cleanUrl("https://example.com/a?utm_source=x#frag?utm_medium=y"), "https://example.com/a#frag?utm_medium=y");
  assert.equal(cleanUrl("https://example.com/search?q=utm_source"), "https://example.com/search?q=utm_source");
  assert.equal(cleanUrl("https://example.com/?b=2&a=1"), "https://example.com/?b=2&a=1");
  assert.equal(cleanUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(cleanUrl("https://user:pw@example.com:8443/p?utm_term=x&k"), "https://user:pw@example.com:8443/p?k");
});

test("displayed URLs say arcadia://, never chrome://", () => {
  assert.equal(urlForDisplay("arcadia://version/"), "arcadia://version");
  assert.equal(urlForDisplay("chrome://version/"), "arcadia://version");
  assert.equal(urlForDisplay("chrome://settings/languages"), "arcadia://settings/languages");
  assert.equal(urlForDisplay("arcadia://history/?q=a"), "arcadia://history?q=a");
  assert.equal(displayUrl("chrome://gpu/"), "arcadia://gpu");
  assert.deepEqual(breadcrumb("arcadia://version/", "About Version"), { host: "arcadia://version", trail: ["About Version"] });
  assert.deepEqual(breadcrumb("arcadia://history", "History"), { host: "arcadia://history", trail: [] });
  assert.deepEqual(breadcrumb("chrome://flags/", "Experiments"), { host: "arcadia://flags", trail: ["Experiments"] });
});

// Chrome's AutocompleteInput::Parse (components/omnibox/browser/autocomplete_input.cc): a host with a port is a URL, a
// host whose TLD is a known registry is a URL, an unknown TLD needs a port, a path ending in "/", or two of path, query and fragment.
test("host:port navigates: single-label intranet hosts over http, a number or a time never", () => {
  assert.equal(fixupUrl("myserver:8080"), "http://myserver:8080");
  assert.equal(fixupUrl("localhost:3000"), "http://localhost:3000");
  assert.equal(fixupUrl("devbox:3000/api/health?x=1"), "http://devbox:3000/api/health?x=1");
  assert.equal(fixupUrl("foo.zzzz:8080"), "https://foo.zzzz:8080");
  assert.equal(resolveInput("myserver:8080"), "http://myserver:8080");
  for (const text of ["10:30", "3:2", "8080", "12:30pm", "ratio 3:2", "note: 5", "a:b", "std::vector"]) assert.equal(fixupUrl(text), null, text);
});

test("IDN hosts navigate, in any script, with or without a path", () => {
  assert.equal(fixupUrl("münchen.de"), "https://münchen.de");
  assert.equal(fixupUrl("Яндекс.рф"), "https://Яндекс.рф");
  assert.equal(fixupUrl("яндекс.рф/search?text=x"), "https://яндекс.рф/search?text=x");
  assert.equal(fixupUrl("例え.jp"), "https://例え.jp");
  assert.equal(fixupUrl("bücher.example/x/"), "https://bücher.example/x/");
  assert.equal(fixupUrl("xn--bcher-kva.de"), "https://xn--bcher-kva.de");
  assert.equal(fixupUrl("café.fr:8443"), "https://café.fr:8443");
  // Words with accents and no TLD are searches.
  assert.equal(fixupUrl("café"), null);
  assert.equal(fixupUrl("münchen.zzzz"), null);
  assert.equal(fixupUrl("naïve bayes.com"), null);
});

test("an unknown TLD searches unless a port, a trailing slash or two of path, query and fragment say URL", () => {
  assert.equal(fixupUrl("foo.zzzz"), null);
  assert.equal(fixupUrl("foo.zzzz/x"), null);
  assert.equal(fixupUrl("foo.zzzz?x=1"), null);
  assert.equal(fixupUrl("foo.zzzz#top"), null);
  assert.equal(fixupUrl("foo.zzzz/"), "https://foo.zzzz/");
  assert.equal(fixupUrl("foo.zzzz/x/"), "https://foo.zzzz/x/");
  assert.equal(fixupUrl("foo.zzzz/x?y=1"), "https://foo.zzzz/x?y=1");
  assert.equal(fixupUrl("foo.zzzz/x#y"), "https://foo.zzzz/x#y");
  assert.equal(fixupUrl("x.y/"), "https://x.y/");
  assert.equal(fixupUrl("https://foo.zzzz/x"), "https://foo.zzzz/x");
  assert.equal(fixupUrl("http://foo"), "http://foo");
  // A single label: the same rules, over http (an intranet name).
  assert.equal(fixupUrl("foo/bar"), null);
  assert.equal(fixupUrl("foo/"), "http://foo/");
  assert.equal(fixupUrl("wiki/Main?x=1"), "http://wiki/Main?x=1");
  assert.equal(fixupUrl("react"), null);
  assert.equal(fixupUrl("and/or"), null);
});

test("a known registry navigates with or without a path (Chrome's public suffix list)", () => {
  for (const text of ["site.photography/about", "docs.new", "report.zip", "shop.bike", "hello.world", "a.xn--p1ai", "b.中国", "c.рф"]) {
    assert.ok(fixupUrl(text), text);
  }
  for (const text of ["index.html", "node.js", "e.g.", "1.5", "a.b", "c++", "v1.2.3", "file.txt", "README.md.bak", "hi@example.com"]) {
    assert.equal(fixupUrl(text), null, text);
  }
});

// A fuzz over host shapes: whatever Chrome would call URL navigates, whatever has whitespace or a bad host never does.
test("random hosts: a known TLD or a port navigates, a bare unknown name or a space never does", () => {
  let seed = 7;
  const rnd = (n: number) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed % n);
  const pick = <T,>(list: readonly T[]): T => list[rnd(list.length)]!;
  const tlds = PSL_TLDS.split(/\s+/).filter((t) => t.length > 1 && t !== "local" && t !== "localhost");
  const labels = ["a", "foo", "my-site", "x1", "münchen", "яндекс", "例え", "9lives", "a-b-c"];
  for (let i = 0; i < 3000; i++) {
    const host = `${pick(labels)}${rnd(3) ? "" : `.${pick(labels)}`}.${pick(tlds)}`;
    const tail = pick(["", "/", "/x", "/x/y?z=1", ":8080", ":8080/x", "?q=1", "#t"]);
    const url = fixupUrl(host + tail);
    assert.ok(url?.endsWith(host + tail), `${host}${tail} → ${url}`);
    assert.equal(fixupUrl(`${host} ${tail}`.trimEnd() + " x"), null, "a space makes it prose");
    const unknown = `${pick(labels)}.${pick(["zzzz", "qqqq", "notatld"])}`;
    const bare = fixupUrl(unknown + pick(["", "/x", "?q=1", "#t"]));
    assert.equal(bare, null, unknown);
    assert.ok(fixupUrl(`${unknown}:${1 + rnd(65535)}`), "a port makes it a URL");
  }
});
