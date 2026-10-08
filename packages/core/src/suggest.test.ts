// Omnibox ranking and inline completion, and the suggestion fetcher's race with typing.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { BUILT_IN_ENGINES, engineById } from "./engines.ts";
import { buildSuggestions, type Suggestion } from "./suggest.ts";
import { createSuggestFetcher, type FetchLike } from "./suggestFetcher.ts";

const now = Date.UTC(2026, 8, 24);
const DAY = 86_400_000;
const history = [
  { url: "https://x.com/home", title: "(1) Home / X", favicon: null, visits: 40, lastVisit: now - 1000 },
  { url: "https://x.com/notifications", title: "Notifications / X", favicon: null, visits: 5, lastVisit: now - 5000 },
  { url: "https://www.xing.com/", title: "XING", favicon: null, visits: 1, lastVisit: now - DAY * 10 },
  { url: "https://github.com/", title: "GitHub", favicon: null, visits: 12, lastVisit: now - 2000 },
];

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
  assert.ok(rows(m.items).includes(hist[0]!.url));
  const a = buildSuggestions("a", { tabs: [], history: hist }, { now });
  assert.equal(a.completion, "ccounts.google.com");
  assert.equal(buildSuggestions("mail.google.com/m", { tabs: [], history: hist }, { now }).completion, "");
  assert.equal(buildSuggestions("x.com/h", { tabs: [], history }, { now }).completion, "ome");
});

test("free text puts a search first-class and never autocompletes", () => {
  const { items, completion } = buildSuggestions("git hub", { tabs: [], history }, { now });
  assert.equal(completion, "");
  assert.equal(items[0]?.kind, "search");
});

test("preventInline (after a deletion): no completion, and the search is first unless the typed text is the page", () => {
  const typed = (text: string, preventInline: boolean) => buildSuggestions(text, { tabs: [], history }, { now, preventInline });
  const before = typed("gi", false);
  assert.equal(before.completion, "thub.com");
  assert.equal(rows(before.items)[0], "https://github.com/");
  const after = typed("gi", true);
  assert.equal(after.completion, "");
  assert.equal(rows(after.items)[0], "search:gi");
  assert.ok(rows(after.items).includes("https://github.com/"), "the page stays in the list");
  // A page that matches by title or host, but isn't what was typed, doesn't go first either.
  assert.equal(rows(typed("gith", true).items)[0], "search:gith");
  assert.equal(rows(typed("x.c", true).items)[0], "search:x.c");
  // What was typed is the page's host: it still goes first, with no completion needed.
  assert.equal(rows(typed("github.com", true).items)[0], "https://github.com/");
  assert.equal(typed("github.com", true).completion, "");
  assert.equal(rows(typed("x.com/home", true).items)[0], "https://x.com/home");
  assert.equal(rows(typed("https://x.com/notifications", true).items)[0], "https://x.com/notifications");
  // Typing again turns it back on.
  assert.equal(typed("git", false).completion, "hub.com");
});

test("preventInline keeps quick-create, actions and calculator rules", () => {
  const actions = [{ id: "newTab", title: "New Tab" }] as never;
  assert.equal(rows(buildSuggestions("new tab", { tabs: [], history }, { now, actions, preventInline: true }).items)[0], "action:newTab");
  assert.equal(rows(buildSuggestions("2+2", { tabs: [], history }, { now, preventInline: true }).items)[0], "search:2+2");
});

// Chrome's AutocompleteMatch::SetAllowedToBeDefault: input ending in whitespace is never completed.
test("a word and a space: no completion, the search goes first unless it is the host or address", () => {
  const typed = (text: string, o = {}) => buildSuggestions(text, { tabs: [], history }, { now, ...o });
  assert.equal(typed("git").completion, "hub.com");
  for (const text of ["git ", "git  ", "gi\t", "x "]) {
    const r = typed(text);
    assert.equal(r.completion, "", JSON.stringify(text));
    assert.equal(rows(r.items)[0], `search:${text.trim()}`, JSON.stringify(text));
    assert.ok(rows(r.items).includes("https://github.com/") || text.startsWith("x"), "the page stays in the list");
  }
  // Exactly a host or address still goes first, completion or not.
  assert.equal(rows(typed("github.com ").items)[0], "https://github.com/");
  assert.equal(typed("github.com ").completion, "");
  assert.equal(rows(typed("x.com/home ").items)[0], "https://x.com/home");
  // A leading space is not trailing whitespace; several words never completed anyway.
  assert.equal(typed(" git").completion, "hub.com");
  assert.equal(typed("git hub ").completion, "");
  // Typing the next letter after the space is a search for two words, as before.
  assert.equal(rows(typed("git s").items)[0], "search:git s");
});

test("only a visited page completes: a bookmark or an open tab with no history row doesn't", () => {
  const bookmarks = [{ url: "https://bookmarked.example.org/", title: "Reading list", favicon: null }];
  const tabs = [{ id: "t9", url: "https://news.ycombinator.com/", title: "Hacker News", favicon: null }];
  const r = buildSuggestions("bookm", { tabs, history, bookmarks }, { now });
  assert.equal(r.completion, "");
  assert.ok(rows(r.items).includes("https://bookmarked.example.org/"), "still a row");
  const t = buildSuggestions("news", { tabs, history, bookmarks }, { now });
  assert.equal(t.completion, "");
  assert.ok(rows(t.items).includes("tab:https://news.ycombinator.com/"), "still a switch-to-tab row");
  // Once the page has been visited (a history row), it completes, bookmarked or open or not.
  const visited = [...history, { url: "https://bookmarked.example.org/", title: "Reading list", favicon: null, visits: 1, lastVisit: now - 9000 }];
  assert.equal(buildSuggestions("bookm", { tabs: [], history: visited, bookmarks }, { now }).completion, "arked.example.org");
  const tabbed = [...history, { url: "https://news.ycombinator.com/", title: "Hacker News", favicon: null, visits: 2, lastVisit: now - 9000 }];
  assert.equal(buildSuggestions("news", { tabs, history: tabbed, bookmarks }, { now }).completion, ".ycombinator.com");
  // A bookmarked deep link whose host was visited under another address completes the host.
  const deep = [{ url: "https://bookmarked.example.org/a/b", title: "Deep", favicon: null }];
  const host = [...history, { url: "https://bookmarked.example.org/", title: "Home", favicon: null, visits: 3, lastVisit: now - 100 }];
  assert.equal(buildSuggestions("bookm", { tabs: [], history: host, bookmarks: deep }, { now }).completion, "arked.example.org");
});

test("open tabs are marked so the bar can switch to them, except the bar's own tab", () => {
  const tabs = [{ id: "t1", url: "https://github.com/", title: "GitHub", favicon: null }];
  const { items } = buildSuggestions("gith", { tabs, history }, { now });
  assert.equal(items[0]?.kind === "page" && items[0].tabId, "t1");
  const own = buildSuggestions("gith", { tabs, history }, { now, currentTabId: "t1" });
  assert.equal(own.items[0]?.kind === "page" && own.items[0].tabId, undefined);
});

test("frecency: frequent + recent beats old, and multi-word queries match words", () => {
  const hist = [
    { url: "https://a.com/docs", title: "Rust docs", favicon: null, visits: 2, lastVisit: now - DAY * 60 },
    { url: "https://b.com/docs", title: "Rust docs", favicon: null, visits: 20, lastVisit: now - DAY },
  ];
  const { items } = buildSuggestions("docs rust", { tabs: [], history: hist }, { now });
  assert.deepEqual(rows(items), ["search:docs rust", "https://b.com/docs", "https://a.com/docs"]);
});

const fresh = <T,>(list: readonly T[]) => [...list];

const vocabulary = ["react", "native", "banana", "nano", "layout", "github", "news", "notion", "an", "na"];
const bigHistory = Array.from({ length: 400 }, (_, i) => ({
  url: `https://${["github.com", "news.ycombinator.com", "notion.so", "example.org"][i % 4]}/${vocabulary[i % 10]}/${i}`,
  title: `${vocabulary[(i * 3) % 10]} ${vocabulary[(i * 7) % 10]}${i % 5 ? "" : "ish"} page`,
  favicon: null,
  visits: 1 + (i % 13),
  lastVisit: now - (i % 40) * DAY,
}));

const google = engineById(BUILT_IN_ENGINES, "google");
const flush = () => new Promise((r) => setImmediate(r));

function fakeFetch(respond: (url: string) => unknown = (url) => [decodeURIComponent(url.split("q=").at(-1)!), ["a", "b"]]) {
  const calls: { url: string; signal: AbortSignal }[] = [];
  const fetch: FetchLike = (url, { signal }) => {
    calls.push({ url, signal });
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
      queueMicrotask(() => resolve({ ok: true, text: async () => JSON.stringify(respond(url)) }));
    });
  };
  return { fetch, calls };
}

test("a newer request aborts the one in flight, which never answers", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { fetch, calls } = fakeFetch();
    const results: string[] = [];
    const fetcher = createSuggestFetcher({ fetch, delay: 10 });
    fetcher.request(google, "old", () => results.push("old"));
    mock.timers.tick(10);
    assert.equal(calls.length, 1);
    fetcher.request(google, "new", () => results.push("new"));
    assert.equal(calls[0]!.signal.aborted, true);
    mock.timers.tick(10);
    await flush();
    assert.deepEqual(results, ["new"]);
  } finally {
    mock.timers.reset();
  }
});

