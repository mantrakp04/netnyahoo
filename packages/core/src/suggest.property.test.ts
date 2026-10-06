// The live omnibox ranking against its frozen spec (suggest.reference.ts): random profiles, random typing sequences,
// every keystroke's whole result compared, so a faster implementation has to rank exactly as the old one did.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_ENGINES } from "./engines.ts";
import { buildSuggestions, prepareSuggestions, type SuggestionSource, type SuggestOptions } from "./suggest.ts";
import * as reference from "./suggest.reference.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 6);

function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T,>(list: readonly T[]): T => list[int(list.length)]!;
  return { next, int, pick };
}
type Rng = ReturnType<typeof rng>;

const HOSTS = ["github.com", "www.github.com", "news.ycombinator.com", "notion.so", "x.com", "en.wikipedia.org", "react.dev", "example.org", "a.b.co.uk", "localhost:3000", "xn--nxasmq6b.com", "Docs.Google.com"];
const WORDS = ["react", "native", "banana", "nano", "layout", "github", "news", "notion", "an", "na", "net", "netflix", "pull", "issues", "perf", "Hermes", "Éclair", "naïve", "c++", "foo-bar", "a1", "9lives", "ok"];
const TAILS = ["", "/", "?q=1", "#top", "/index.html", "?utm=a&b=c#x"];

function makeProfile(r: Rng, size: number) {
  const url = () => {
    const proto = r.int(12) ? "https" : "http";
    const path = Array.from({ length: r.int(4) }, () => r.pick(WORDS).toLowerCase()).join("/");
    return `${proto}://${r.pick(HOSTS)}/${path}${r.pick(TAILS)}`;
  };
  const title = () => (r.int(10) === 0 ? "" : Array.from({ length: 1 + r.int(6) }, () => r.pick(WORDS)).join(r.int(8) ? " " : "-"));
  // Half the profiles have few distinct visit counts and dates, so many rows tie and the order among ties shows.
  const ties = r.int(2) === 0;
  const history = Array.from({ length: size }, () => ({
    url: url(),
    title: title(),
    favicon: r.int(3) ? `https://x/${r.int(9)}.ico` : null,
    visits: ties ? r.int(3) : r.int(5) ? 1 + r.int(40) : 0,
    lastVisit: ties ? NOW - r.int(3) * DAY : r.int(6) ? NOW - r.int(120 * DAY) : 0,
  }));
  const bookmarks = Array.from({ length: Math.floor(size / 4) }, () => {
    const h = r.int(2) && history.length ? r.pick(history) : null;
    return { url: h ? h.url : url(), title: h ? h.title : title(), favicon: null };
  });
  const tabs = Array.from({ length: Math.floor(size / 6) }, (_, i) => {
    const h = r.int(2) && history.length ? r.pick(history) : null;
    return { id: `t${i}`, url: r.int(15) ? (h ? h.url : url()) : "", title: h ? h.title : title(), favicon: null };
  });
  return { history, bookmarks, tabs };
}

const ACTIONS = [
  { id: "new-tab", title: "New Tab", keywords: ["create"] },
  { id: "settings", title: "Open Settings" },
  { id: "net-tools", title: "Network Tools", hint: "⌘N", icon: "wifi" },
  { id: "pin", title: "Pin Tab", keywords: ["keep"] },
];

// Queries: a target taken from the profile (a URL slice, a title's words, a host) typed a key at a time, then edited.
function sequence(r: Rng, p: ReturnType<typeof makeProfile>): string[] {
  const row = p.history.length ? r.pick(p.history) : { url: "https://github.com/", title: "GitHub" };
  const shown = row.url.replace(/^https?:\/\//, "");
  const targets = [shown, shown.replace(/^www\./, ""), row.title, row.title.split(/\s+/).slice(0, 3).join(" "), r.pick(HOSTS), `${r.pick(WORDS)} ${r.pick(WORDS)}`, r.pick(WORDS), `${r.pick(HOSTS)}/${r.pick(WORDS)}`];
  let target = r.pick(targets);
  if (r.int(5) === 0) target = target.toUpperCase();
  if (r.int(8) === 0) target = ` ${target} `;
  if (r.int(12) === 0) target = `?${target}`;
  if (r.int(12) === 0) target = `${r.pick(["yt", "gh", "g"])} ${target}`;
  const out: string[] = [];
  const upTo = Math.min(target.length, 4 + r.int(24));
  for (let i = 1; i <= upTo; i++) out.push(target.slice(0, i));
  // Edits: backspaces, a retype of a different tail, a jump to an unrelated query, the same query again.
  for (let n = r.int(4); n > 0 && out.length; n--) {
    const last = out[out.length - 1]!;
    switch (r.int(4)) {
      case 0:
        out.push(last.slice(0, Math.max(0, last.length - 1 - r.int(3))));
        break;
      case 1:
        out.push(last + r.pick(WORDS).slice(0, 1 + r.int(3)));
        break;
      case 2:
        out.push(r.pick(WORDS).slice(0, 1 + r.int(4)));
        break;
      default:
        out.push(last);
    }
  }
  return out;
}

const stats = { steps: 0, completions: 0, pages: 0 };

function compareRun(seed: number, size: number) {
  const r = rng(seed);
  const p = makeProfile(r, size);
  const scope = r.int(6) === 0 ? { kind: "site" as const, name: "GitHub", host: "github.com", url: "https://github.com/search?q=%s" } : null;
  const base: SuggestOptions = {
    now: NOW,
    limit: r.pick([8, 8, 8, 1, 3, 12]),
    engine: BUILT_IN_ENGINES[0]!,
    preference: r.int(4) ? "website" : "search",
    actions: ACTIONS,
    currentTabId: r.int(3) ? undefined : `t${r.int(Math.max(1, p.tabs.length))}`,
    currentUrl: r.int(3) ? undefined : (p.history[r.int(Math.max(1, p.history.length))]?.url ?? undefined),
    scope,
  };
  let source: SuggestionSource = p;
  const queries = [...sequence(r, p), ...sequence(r, p)];
  for (const [i, q] of queries.entries()) {
    // Now and then the profile changes the way the app changes it: a visit makes a new history list, a bookmark a new
    // bookmarks list, a tab opening a new tabs list; the rows themselves are reused.
    if (r.int(7) === 0 && p.history.length) {
      const h = r.pick(p.history);
      source = { ...source, history: [{ ...h, visits: h.visits + 1, lastVisit: NOW }, ...source.history.filter((x) => x !== h)] };
    }
    if (r.int(11) === 0) source = { ...source, bookmarks: [...(source.bookmarks ?? [])] };
    if (r.int(9) === 0) source = { ...source, tabs: source.tabs.slice(r.int(3)) };
    if (r.int(13) === 0) prepareSuggestions(source, Date.now() + 1);
    const options: SuggestOptions = { ...base, remote: r.int(3) ? [] : [`${q} one`, "two", q.toUpperCase(), `${q} three`, "four", "five"] };
    const want = reference.buildSuggestions(q, source, options);
    const got = buildSuggestions(q, source, options);
    stats.steps++;
    if (want.completion) stats.completions++;
    stats.pages += want.items.filter((x) => x.kind === "page").length;
    assert.deepStrictEqual(got, want, `seed ${seed} size ${size} step ${i} query ${JSON.stringify(q)}`);
  }
}

test("keystroke sequences rank exactly as the reference does (500 random profiles)", () => {
  for (let seed = 1; seed <= 500; seed++) compareRun(seed, 1 + (seed % 7) * 25);
});

test("big profiles too, and a stale narrowing never leaks across profiles", () => {
  for (let seed = 9001; seed <= 9012; seed++) compareRun(seed, 1500);
});

test("the sequences exercise inline completion and page rows", () => {
  assert.ok(stats.steps > 5000 && stats.completions > 300 && stats.pages > 10000, JSON.stringify(stats));
});

test("an empty profile and a one-row profile", () => {
  compareRun(77, 0);
  compareRun(78, 1);
});
