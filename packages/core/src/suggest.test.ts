import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_ENGINES, engineById } from "./engines.ts";
import { findScope } from "./siteSearch.ts";
import { buildSuggestions, displayUrl, type Suggestion } from "./suggest.ts";

const now = Date.UTC(2026, 8, 24);
const DAY = 86_400_000;
const history = [
  { url: "https://x.com/home", title: "(1) Home / X", favicon: null, visits: 40, lastVisit: now - 1000 },
  { url: "https://x.com/notifications", title: "Notifications / X", favicon: null, visits: 5, lastVisit: now - 5000 },
  { url: "https://www.xing.com/", title: "XING", favicon: null, visits: 1, lastVisit: now - DAY * 10 },
  { url: "https://github.com/", title: "GitHub", favicon: null, visits: 12, lastVisit: now - 2000 },
];
const none = { tabs: [], history: [] };

/** Compact row labels for assertions. */
function rows(items: Suggestion[]): string[] {
  return items.map((i) => {
    switch (i.kind) {
      case "page":
        return i.tabId ? `tab:${i.url}` : i.url;
      case "search":
        return `${i.suggested ? "suggest" : "search"}:${i.query}`;
      case "calc":
        return `calc:${i.value}`;
      case "action":
        return `action:${i.id}`;
      case "create":
        return `create:${i.id}`;
    }
  });
}

test("displayUrl strips scheme, www and trailing slash", () => {
  assert.equal(displayUrl("https://www.xing.com/"), "xing.com");
  assert.equal(displayUrl("http://localhost:3000/a/"), "localhost:3000/a");
});

test("typing 'x' completes the site's host inline: top hit, then search, then its pages", () => {
  const { items, completion } = buildSuggestions("x", { tabs: [], history }, { now });
  assert.equal(completion, ".com");
  assert.deepEqual(rows(items), ["https://x.com/", "search:x", "https://x.com/home", "https://x.com/notifications", "https://www.xing.com/"]);
});

test("the completion keeps the typed case and extends it", () => {
  assert.equal(buildSuggestions("X.c", { tabs: [], history }, { now }).completion, "om");
});

test("inline completion never takes a long query URL: 'm' completes to the host", () => {
  const signIn =
    "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com%2Fmail%2Fu%2F0%2F&service=mail&flowName=GlifWebSignIn&flowEntry=AccountChooser&ec=asw-gmail-globalnav-signin#inbox";
  const hist = [
    { url: "https://mail.google.com/mail/u/0/?service=mail&continue=" + encodeURIComponent(signIn) + "#inbox", title: "Inbox - me@gmail.com - Gmail", favicon: "gmail.ico", visits: 50, lastVisit: now - 1000 },
    { url: signIn, title: "Sign in - Google Accounts", favicon: null, visits: 3, lastVisit: now - 2000 },
  ];
  const m = buildSuggestions("m", { tabs: [], history: hist }, { now });
  assert.equal(m.completion, "ail.google.com");
  assert.deepEqual(m.items[0], { kind: "page", url: "https://mail.google.com/", title: "", favicon: "gmail.ico" });
  // The Inbox is still listed, just not inlined.
  assert.ok(rows(m.items).includes(hist[0]!.url));
  const a = buildSuggestions("a", { tabs: [], history: hist }, { now });
  assert.equal(a.completion, "ccounts.google.com");
  // Past the host, only a clean address completes; a query URL doesn't.
  assert.equal(buildSuggestions("mail.google.com/m", { tabs: [], history: hist }, { now }).completion, "");
  assert.equal(buildSuggestions("x.com/h", { tabs: [], history }, { now }).completion, "ome");
});

test("the host's own page, when known, is the completed top hit (titled, switchable)", () => {
  const tabs = [{ id: "t1", url: "https://github.com/", title: "GitHub", favicon: null }];
  const { items, completion } = buildSuggestions("gi", { tabs, history }, { now });
  assert.equal(completion, "thub.com");
  assert.deepEqual(items[0], { kind: "page", url: "https://github.com/", title: "GitHub", favicon: null, tabId: "t1", visited: true });
});

test("typing a whole host completes nothing more", () => {
  const { items, completion } = buildSuggestions("x.com", { tabs: [], history }, { now });
  assert.equal(completion, "");
  assert.equal(items[0]?.kind === "page" && items[0].url, "https://x.com");
});

test("free text puts a search first-class and never autocompletes", () => {
  const { items, completion } = buildSuggestions("git hub", { tabs: [], history }, { now });
  assert.equal(completion, "");
  assert.equal(items[0]?.kind, "search");
});

test("unknown host-like input offers to go there, untitled", () => {
  const { items } = buildSuggestions("example.org", { tabs: [], history }, { now });
  assert.equal(items[0]?.kind === "page" && items[0].url, "https://example.org");
  assert.equal(items[0]?.kind === "page" && items[0].title, "");
});

test("open tabs are marked so the bar can switch to them, except the bar's own tab", () => {
  const tabs = [{ id: "t1", url: "https://github.com/", title: "GitHub", favicon: null }];
  const { items } = buildSuggestions("gith", { tabs, history }, { now });
  assert.equal(items[0]?.kind === "page" && items[0].tabId, "t1");
  const own = buildSuggestions("gith", { tabs, history }, { now, currentTabId: "t1" });
  assert.equal(own.items[0]?.kind === "page" && own.items[0].tabId, undefined);
});

test("an open tab that isn't in history yet is still found", () => {
  const tabs = [{ id: "t9", url: "https://linear.app/team", title: "Linear", favicon: null }];
  assert.deepEqual(rows(buildSuggestions("line", { tabs, history: [] }, { now }).items).slice(0, 3), ["https://linear.app/", "search:line", "tab:https://linear.app/team"]);
});

test("bookmarks are suggested and outrank equally-matching history", () => {
  const bookmarks = [{ url: "https://news.ycombinator.com/", title: "Hacker News", favicon: null }];
  const hist = [{ url: "https://news.example.com/", title: "Example News", favicon: null, visits: 1, lastVisit: now - DAY }];
  const { items } = buildSuggestions("news", { tabs: [], history: hist, bookmarks }, { now });
  assert.equal(items[0]?.kind === "page" && items[0].url, "https://news.ycombinator.com/");
  assert.equal(items[0]?.kind === "page" && items[0].bookmarked, true);
  // A bookmark that's also in history is one row.
  const both = buildSuggestions("x", { tabs: [], history, bookmarks: [{ url: "https://x.com/home", title: "X", favicon: null }] }, { now });
  assert.equal(both.items.filter((i) => i.kind === "page" && i.url === "https://x.com/home").length, 1);
});

test("frecency: frequent + recent beats old, and multi-word queries match words", () => {
  const hist = [
    { url: "https://a.com/docs", title: "Rust docs", favicon: null, visits: 2, lastVisit: now - DAY * 60 },
    { url: "https://b.com/docs", title: "Rust docs", favicon: null, visits: 20, lastVisit: now - DAY },
  ];
  const { items } = buildSuggestions("docs rust", { tabs: [], history: hist }, { now });
  assert.deepEqual(rows(items), ["search:docs rust", "https://b.com/docs", "https://a.com/docs"]);
});

test("a strong title match is the top hit when preferring websites", () => {
  const hist = [{ url: "https://app.slack.com/client/T1", title: "Slack | general", favicon: null, visits: 30, lastVisit: now - 1000 }];
  assert.equal(buildSuggestions("slack", { tabs: [], history: hist }, { now }).items[0]?.kind, "page");
});

test("'Prefer Search Engine' searches unless it's an address, and never completes", () => {
  const prefer = { now, preference: "search" as const };
  const x = buildSuggestions("x", { tabs: [], history }, prefer);
  assert.equal(x.completion, "");
  assert.deepEqual(rows(x.items).slice(0, 2), ["search:x", "https://x.com/home"]);
  assert.equal(buildSuggestions("apple.com", none, prefer).items[0]?.kind, "page");
});

test("the search row uses the chosen engine, and its name", () => {
  const ddg = engineById(BUILT_IN_ENGINES, "duckduckgo");
  const [first] = buildSuggestions("cats", none, { engine: ddg }).items;
  assert.deepEqual(first, { kind: "search", query: "cats", url: "https://duckduckgo.com/?q=cats", engine: "DuckDuckGo" });
});

test("engine suggestions follow the local results, de-duplicated", () => {
  const remote = ["x", "X Corp", "x corp", "xbox", "xkcd", "xcode", "xiaomi"];
  const { items } = buildSuggestions("x", { tabs: [], history }, { now, remote, limit: 20 });
  assert.deepEqual(rows(items), [
    "https://x.com/",
    "search:x",
    "https://x.com/home",
    "https://x.com/notifications",
    "https://www.xing.com/",
    "suggest:X Corp",
    "suggest:xbox",
    "suggest:xkcd",
    "suggest:xcode",
  ]);
});

test("the limit caps rows", () => {
  const remote = ["a1", "a2", "a3", "a4"];
  assert.equal(buildSuggestions("a", none, { remote, limit: 3 }).items.length, 3);
});

test("calculator answers come right after the top row", () => {
  const { items } = buildSuggestions("12*3.5", none, { now });
  assert.deepEqual(rows(items), ["search:12*3.5", "calc:42"]);
  const calc = items[1];
  assert.equal(calc?.kind === "calc" && calc.url, "https://www.google.com/search?q=12*3.5");
});

test("'new …' commands: the top hit once a service is named", () => {
  assert.deepEqual(rows(buildSuggestions("new doc", none, { now }).items), ["create:doc", "search:new doc"]);
  assert.deepEqual(rows(buildSuggestions("new ", none, { now }).items).slice(0, 4), ["search:new", "create:doc", "create:sheet", "create:slides"]);
});

test("browser actions: exact names are the top hit, partial ones follow the search", () => {
  const actions = [
    { id: "closeTab", title: "Close Tab", icon: "xmark", hint: "⌘W" },
    { id: "newWindow", title: "New Window", icon: "macwindow", hint: "⌘N" },
    { id: "history", title: "Show History", keywords: ["history"] },
  ];
  const exact = buildSuggestions("close tab", none, { actions });
  assert.deepEqual(exact.items[0], { kind: "action", id: "closeTab", title: "Close Tab", icon: "xmark", hint: "⌘W" });
  assert.deepEqual(rows(buildSuggestions("new win", none, { actions }).items), ["search:new win", "action:newWindow"]);
  assert.deepEqual(rows(buildSuggestions("history", none, { actions }).items)[0], "action:history");
  assert.deepEqual(rows(buildSuggestions("zzz", none, { actions }).items), ["search:zzz"]);
});

test("the current page is deranked so the bar doesn't suggest where you already are", () => {
  const { items } = buildSuggestions("x", { tabs: [], history }, { now, currentUrl: "https://x.com/home" });
  assert.equal(rows(items)[2], "https://x.com/notifications");
});

test("a leading ? only searches", () => {
  assert.deepEqual(rows(buildSuggestions("?x.com", { tabs: [], history }, { now, remote: ["x.com login"] }).items), ["search:x.com", "suggest:x.com login"]);
});

test("scoped (Tab-to-search) queries search the site and show its pages", () => {
  const scope = findScope("x.com", { engines: BUILT_IN_ENGINES });
  const { items, completion } = buildSuggestions("notif", { tabs: [], history }, { now, scope, remote: ["notif sounds"] });
  assert.equal(completion, "");
  assert.deepEqual(rows(items), ["search:notif", "suggest:notif sounds", "https://x.com/notifications"]);
  assert.equal(items[0]?.kind === "search" && items[0].url, "https://x.com/search?q=notif");
  assert.equal(items[0]?.kind === "search" && items[0].engine, "X");
});

test("displayUrl shows safe IDN hosts in Unicode", () => {
  assert.equal(displayUrl("https://www.xn--mnchen-3ya.de/"), "münchen.de");
  assert.equal(displayUrl("https://xn--80ak6aa92e.com/login"), "xn--80ak6aa92e.com/login");
});
