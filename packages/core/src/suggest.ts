import { calculate } from "./calculator.ts";
import { BUILT_IN_ENGINES, searchUrl, type SearchEngine } from "./engines.ts";
import { matchActions, type ActionCandidate } from "./fuzzy.ts";
import { fixupUrl, hostOf, urlForDisplay } from "./omnibox.ts";
import { matchQuickCreate } from "./quickCreate.ts";
import { scopedSearchUrl, type SearchScope } from "./siteSearch.ts";

export type SuggestionSource = {
  /** Open tabs of this profile, in every window ("Switch to Tab"). */
  tabs: readonly { id: string; url: string; title: string; favicon: string | null }[];
  history: readonly { url: string; title: string; favicon: string | null; visits: number; lastVisit: number }[];
  bookmarks?: readonly { url: string; title: string; favicon: string | null }[];
};

/** A browser action offered in the bar; `icon` / `hint` are passed through for the row. */
export type CommandAction = ActionCandidate & { icon?: string; hint?: string };

export type Suggestion =
  | {
      kind: "page";
      url: string;
      title: string;
      favicon: string | null;
      /** An open tab showing this page: choosing the row switches to it. */
      tabId?: string;
      bookmarked?: boolean;
      /** Visited before (history rows can be removed from the bar). */
      visited?: boolean;
    }
  /** `engine` is the engine's (or scoped site's) name; `suggested` marks the engine's own suggestions. */
  | { kind: "search"; query: string; url: string; engine: string; suggested?: boolean }
  /** Calculator answer; `url` searches the expression. */
  | { kind: "calc"; expression: string; value: string; url: string }
  | { kind: "action"; id: string; title: string; icon?: string; hint?: string }
  /** Dia's "new …" commands; `site` is the service's site (for its icon). */
  | { kind: "create"; id: string; title: string; url: string; site: string };

export type SuggestionResult = {
  items: Suggestion[];
  /** Text to append after the typed query as a selected inline completion. */
  completion: string;
};

export type SuggestOptions = {
  limit?: number;
  now?: number;
  /** The default search engine (Google when omitted). */
  engine?: Pick<SearchEngine, "name" | "url">;
  /**
   * "website": the best matching site is the top hit and completes inline (Dia's default).
   * "search": Enter searches unless the input is an address; no inline completion.
   */
  preference?: "website" | "search";
  /** The engine's own suggestions for this query (fetched separately; see suggestFetcher). */
  remote?: readonly string[];
  actions?: readonly CommandAction[];
  /** The tab the bar belongs to: never offered as "Switch to Tab", and its page is deranked. */
  currentTabId?: string;
  currentUrl?: string;
  /** Tab-to-search: the query searches this site / engine. */
  scope?: SearchScope | null;
};

/** `https://www.x.com/home/` → `x.com/home` (what Dia shows in suggestion rows). */
export function displayUrl(url: string): string {
  return urlForDisplay(url).replace(/\/$/, "");
}

const DAY = 86_400_000;
/** Same page for de-duplication: fragment and trailing slash don't matter. */
const pageKey = (url: string) => url.replace(/#.*$/, "").replace(/\/$/, "");

type HistoryRow = SuggestionSource["history"][number];
type BookmarkRow = NonNullable<SuggestionSource["bookmarks"]>[number];
type TabRow = SuggestionSource["tabs"][number];

/**
 * What matching reads of a page, worked out once per history / bookmark / tab object (the store
 * replaces an entry when it changes), so a keystroke mostly compares strings.
 */
type PageText = {
  url: string;
  key: string;
  /** displayUrl(url), and lowercased. */
  shown: string;
  shownLower: string;
  titleLower: string;
  /** hostOf(url) and the URL's http(s) origin, worked out when first needed. */
  host?: string;
  origin?: string | null;
};

const pageTexts = new WeakMap<object, PageText>();

function pageText(row: { url: string; title: string }): PageText {
  let text = pageTexts.get(row);
  if (!text) {
    const shown = displayUrl(row.url);
    text = { url: row.url, key: pageKey(row.url), shown, shownLower: shown.toLowerCase(), titleLower: row.title.toLowerCase() };
    pageTexts.set(row, text);
  }
  return text;
}

const hostOfPage = (t: PageText) => (t.host ??= hostOf(t.url));
const originOfPage = (t: PageText) => (t.origin === undefined ? (t.origin = /^https?:\/\/[^/?#]+/i.exec(t.url)?.[0] ?? null) : t.origin);

type Candidate = {
  url: string;
  title: string;
  favicon: string | null;
  visits: number;
  lastVisit: number;
  bookmarked: boolean;
  /** Set on open tabs that aren't in history or bookmarks; the others get theirs per query. */
  tabId?: string;
  text: PageText;
};

/** History and bookmarks as one list of pages (first of each page wins), and by page. */
type Pool = { list: Candidate[]; byKey: Map<string, Candidate> };

const pools = new WeakMap<readonly HistoryRow[], WeakMap<readonly BookmarkRow[], Pool>>();
const NO_BOOKMARKS: readonly BookmarkRow[] = [];

/** The pool for these history and bookmark lists, kept while they are (they're immutable store state). */
function poolFor(history: readonly HistoryRow[], bookmarks: readonly BookmarkRow[]): Pool {
  let byBookmarks = pools.get(history);
  if (!byBookmarks) pools.set(history, (byBookmarks = new WeakMap()));
  let pool = byBookmarks.get(bookmarks);
  if (pool) return pool;
  const bookmarked = new Set<string>();
  for (const b of bookmarks) bookmarked.add(pageText(b).key);
  pool = { list: [], byKey: new Map() };
  for (const h of history) {
    const text = pageText(h);
    if (pool.byKey.has(text.key)) continue;
    const c: Candidate = { url: h.url, title: h.title, favicon: h.favicon, visits: h.visits, lastVisit: h.lastVisit, bookmarked: bookmarked.has(text.key), text };
    pool.list.push(c);
    pool.byKey.set(text.key, c);
  }
  for (const b of bookmarks) {
    const text = pageText(b);
    if (pool.byKey.has(text.key)) continue;
    const c: Candidate = { url: b.url, title: b.title, favicon: b.favicon, visits: 0, lastVisit: 0, bookmarked: true, text };
    pool.list.push(c);
    pool.byKey.set(text.key, c);
  }
  byBookmarks.set(bookmarks, pool);
  return pool;
}

/**
 * Works out what `buildSuggestions` keeps for `source` (every page's text, and history and
 * bookmarks merged), until `deadline` (ms since the epoch), so typing doesn't pay for it. Call
 * again while it returns false; true once all of it is ready.
 */
export function prepareSuggestions(source: SuggestionSource, deadline: number): boolean {
  const bookmarks = source.bookmarks ?? NO_BOOKMARKS;
  if (pools.get(source.history)?.has(bookmarks)) return true;
  for (const rows of [source.history, bookmarks]) {
    let n = 0;
    for (const row of rows) {
      if (pageTexts.has(row)) continue;
      pageText(row);
      if (++n % 64 === 0 && Date.now() > deadline) return false;
    }
  }
  poolFor(source.history, bookmarks);
  return true;
}

/** Open tabs over the pool: the tab showing each page, and tabs of pages the pool doesn't have. */
function tabsOver(pool: Pool, tabs: readonly TabRow[], now: number, currentTabId?: string) {
  const tabIds = new Map<string, string>();
  const extra: Candidate[] = [];
  for (const t of tabs) {
    if (!t.url || t.id === currentTabId) continue;
    const text = pageText(t);
    if (tabIds.has(text.key)) continue;
    tabIds.set(text.key, t.id);
    // An open tab not in history yet (still loading, or a restored tab) is still recent.
    if (!pool.byKey.has(text.key)) extra.push({ url: t.url, title: t.title, favicon: t.favicon, visits: 0, lastVisit: now, bookmarked: false, tabId: t.id, text });
  }
  return { tabIds, extra };
}

const isWordChar = (code: number) => (code >= 48 && code <= 57) || (code >= 97 && code <= 122);

/** Some word (run of a-z0-9) of the lowercased `text` starts with `word` (itself a-z0-9 only). */
function wordStartsWith(text: string, word: string): boolean {
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    if (i === 0 || !isWordChar(text.charCodeAt(i - 1))) return true;
  }
  return false;
}

/** The typed text as matching reads it, worked out once per keystroke rather than once per page. */
type Query = {
  q: string;
  /** ".q" and "/q": `q` starting a part of the URL (none when `q` has "." or "/" itself). */
  segmentStarts: [string, string] | null;
  /** `q` is a word (a-z0-9 only), so it can start one of a title's words. */
  word: boolean;
  tokens: { text: string; word: boolean }[];
  /** Every match has this in its title or shown URL (the longest token), so pages without it are skipped. */
  needle: string;
};

const WORD = /^[a-z0-9]+$/;

function parseQuery(q: string, tokens: readonly string[]): Query {
  return {
    q,
    segmentStarts: /[./]/.test(q) ? null : [`.${q}`, `/${q}`],
    word: WORD.test(q),
    tokens: tokens.map((text) => ({ text, word: WORD.test(text) })),
    needle: tokens.reduce((a, b) => (b.length > a.length ? b : a), ""),
  };
}

/** How well the text matches: URL prefix beats a URL segment beats the title. */
function matchScore(t: PageText, query: Query): number {
  const shown = t.shownLower;
  const title = t.titleLower;
  const { q, segmentStarts } = query;
  if (!shown.includes(query.needle) && !title.includes(query.needle)) return 0;
  let s = 0;
  if (shown.startsWith(q)) s = 100;
  else if (segmentStarts && (shown.includes(segmentStarts[0]) || shown.includes(segmentStarts[1]))) s = 60;
  else if (q.length >= 2 && shown.includes(q)) s = 30;
  if (title.startsWith(q)) s += 40;
  else if (q.length >= 2 ? title.includes(q) : query.word && wordStartsWith(title, q)) s += 20;
  if (s > 0 || query.tokens.length < 2) return s;
  // Several words: each has to match a title or URL word.
  for (const token of query.tokens) {
    if (token.word && wordStartsWith(title, token.text)) s += 15;
    else if (token.word && wordStartsWith(shown, token.text)) s += 10;
    else if (token.text.length >= 3 && (title.includes(token.text) || shown.includes(token.text))) s += 5;
    else return 0;
  }
  return s;
}

/** Frecency: visit count (log-scaled) minus age, plus small boosts for bookmarks and open tabs. */
function frecency(c: Candidate, tabId: string | undefined, now: number): number {
  const ageDays = c.lastVisit ? Math.max(0, (now - c.lastVisit) / DAY) : 10;
  return Math.log2(1 + c.visits) * 8 - Math.min(ageDays, 30) + (c.bookmarked ? 20 : 0) + (tabId ? 6 : 0);
}

/** The pages the last query (two or more characters) matched. */
let lastMatches: { pool: Pool; q: string; tokens: string[]; pages: Candidate[] } | null = null;

/**
 * The pages worth searching for `q` when it extends the last query ("gith" after "git"): only
 * those the last query matched. Past its first character every test is a substring test or a word
 * prefix, and a match for the longer text passes them for the shorter, except for a last word of
 * one or two letters typed on ("react n" → "react na": "na" may match inside a word, "n" only
 * at its start).
 */
function narrowing(pool: Pool, q: string, tokens: readonly string[]): Candidate[] | null {
  const last = lastMatches;
  if (!last || last.pool !== pool || !q.startsWith(last.q)) return null;
  const i = last.tokens.length - 1;
  const word = last.tokens[i]!;
  return i === 0 || word === tokens[i] || word.length >= 3 ? last.pages : null;
}

type Ranked = { c: Candidate; tabId: string | undefined; m: number; s: number };

/** The best `size` entries by score, in order; ties keep the order they were offered in. */
class TopList {
  readonly items: Ranked[] = [];
  private readonly size: number;
  constructor(size: number) {
    this.size = size;
  }
  offer(r: Ranked) {
    const items = this.items;
    if (items.length === this.size && items[items.length - 1]!.s >= r.s) return;
    let i = items.length;
    while (i > 0 && items[i - 1]!.s < r.s) i--;
    items.splice(i, 0, r);
    if (items.length > this.size) items.pop();
  }
}

const pageSuggestion = (c: Candidate, tabId = c.tabId): Suggestion => ({
  kind: "page",
  url: c.url,
  title: c.title,
  favicon: c.favicon,
  ...(tabId ? { tabId } : {}),
  ...(c.bookmarked ? { bookmarked: true } : {}),
  ...(c.visits > 0 ? { visited: true } : {}),
});

/** Identity for de-duplicating rows. */
export function suggestionKey(s: Suggestion): string {
  switch (s.kind) {
    case "page":
      return `page:${pageKey(s.url)}`;
    case "search":
      return `search:${s.url}`;
    case "calc":
      return `calc:${s.expression}`;
    case "action":
      return `action:${s.id}`;
    case "create":
      return `create:${s.id}`;
  }
}

/**
 * Ranked merge of everything the command bar can offer for `raw`: one top hit (what Enter
 * does), the search for what was typed, the calculator, browser actions, "new …" commands,
 * open tabs / history / bookmarks by relevance and frecency, and the engine's suggestions.
 */
export function buildSuggestions(raw: string, source: SuggestionSource, options: SuggestOptions = {}): SuggestionResult {
  const { limit = 8, now = Date.now(), engine = BUILT_IN_ENGINES[0]!, preference = "website", remote = [], actions = [], scope } = options;
  const query = raw.trim();
  if (!query) return { items: [], completion: "" };
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  // "?cats" always searches (in a scope, "?" is just text).
  if (!scope && query.startsWith("?")) {
    const text = query.slice(1).trim();
    if (!text) return { items: [], completion: "" };
    const out = new Output(limit);
    out.push({ kind: "search", query: text, url: searchUrl(engine, text), engine: engine.name });
    out.push(...dedupeSuggestions(remote, text).slice(0, 4).map((t): Suggestion => ({ kind: "search", query: t, url: searchUrl(engine, t), engine: engine.name, suggested: true })));
    return { items: out.items, completion: "" };
  }

  const pool = poolFor(source.history, source.bookmarks ?? NO_BOOKMARKS);
  const { tabIds, extra } = tabsOver(pool, source.tabs, now, options.currentTabId);
  const currentKey = options.currentUrl ? pageKey(options.currentUrl) : null;
  /** A known page (history, bookmark or open tab), as a row. */
  const known = (url: string) => {
    const key = pageKey(url);
    const c = pool.byKey.get(key) ?? extra.find((x) => x.text.key === key);
    return c && pageSuggestion(c, tabIds.get(key));
  };

  // One pass over the pages: the best rows (only as many as can be shown), the best page on the
  // scoped site, and the best page to complete inline to. Typing on ("gith" after "git") searches
  // only the pages the last query matched.
  const websiteFirst = preference === "website";
  const oneWord = tokens.length === 1;
  const completes = websiteFirst && !scope && oneWord;
  const pages = narrowing(pool, q, tokens) ?? pool.list;
  const parsed = parseQuery(q, tokens);
  const matched: Candidate[] = [];
  const top = new TopList(limit + 1);
  const onSite = scope ? new TopList(4) : null;
  let inline: Ranked | null = null;
  for (const list of [pages, extra]) {
    for (const c of list) {
      const m = matchScore(c.text, parsed);
      if (m <= 0) continue;
      if (list === pages) matched.push(c);
      const tabId = c.tabId ?? tabIds.get(c.text.key);
      const derank = currentKey !== null && c.text.key === currentKey ? 80 : 0;
      const r: Ranked = { c, tabId, m, s: m + frecency(c, tabId, now) - derank };
      top.offer(r);
      if (onSite) {
        const host = hostOfPage(c.text);
        if (host === scope!.host || host.endsWith(`.${scope!.host}`)) onSite.offer(r);
      }
      if (completes && (!inline || r.s > inline.s) && inlineMatch(c.text, q)) inline = r;
    }
  }
  lastMatches = q.length >= 2 ? { pool, q, tokens, pages: matched } : null;
  const ranked = top.items;

  const out = new Output(limit);
  const remoteRows = (url: (text: string) => string, name: string) =>
    dedupeSuggestions(remote, query)
      .slice(0, 4)
      .map((text): Suggestion => ({ kind: "search", query: text, url: url(text), engine: name, suggested: true }));

  if (scope) {
    const scopedUrl = (text: string) => scopedSearchUrl(scope, text, engine);
    out.push({ kind: "search", query, url: scopedUrl(query), engine: scope.name });
    out.push(...remoteRows(scopedUrl, scope.name));
    out.push(...onSite!.items.map((x) => pageSuggestion(x.c, x.tabId)));
    return { items: out.items, completion: "" };
  }

  const search: Suggestion = { kind: "search", query, url: searchUrl(engine, query), engine: engine.name };
  const typedUrl = fixupUrl(query);
  const calc = calculate(query);
  // The raw text: "new " (trailing space) already lists the commands.
  const creates = matchQuickCreate(raw.trimStart());
  const actionMatches = matchActions(query, actions, 3).filter((m) => m.exact || m.score >= 50);

  const best = ranked[0];
  const target = inline && inlineTarget(q, inline.c);
  const completion = target ? target.text.slice(query.length) : "";

  let first: Suggestion;
  if (creates.length && /^\S+\s+\S/.test(query)) first = createRow(creates[0]!);
  else if (actionMatches[0]?.exact) first = actionRow(actionMatches[0].action);
  // ↩ goes where the bar says: the completed host (titled if we know its page), not the page it came from.
  else if (target && completion) first = known(target.url) ?? { kind: "page", url: target.url, title: "", favicon: target.favicon };
  // A typed address; titled if we know the page, else just the address (no " — url" suffix).
  else if (typedUrl) first = known(typedUrl) ?? { kind: "page", url: typedUrl, title: "", favicon: null };
  else if (websiteFirst && best && best.m >= 40) first = pageSuggestion(best.c, best.tabId);
  else first = search;

  out.push(first);
  out.push(search);
  if (calc) out.push({ kind: "calc", expression: calc.expression, value: calc.display, url: searchUrl(engine, calc.expression) });
  out.push(...actionMatches.slice(0, 2).map((m) => actionRow(m.action)));
  out.push(...creates.map(createRow));
  const pageRows = ranked.map((x) => pageSuggestion(x.c, x.tabId));
  out.push(...pageRows.slice(0, 3));
  out.push(...remoteRows((text) => searchUrl(engine, text), engine.name));
  out.push(...pageRows.slice(3));
  return { items: out.items, completion };
}

/**
 * Chrome's inline autocompletion, which is conservative: the text completes to a site's host
 * ("m" → "mail.google.com", from any page on it), or, once a path is being typed, to a visited
 * address that carries no query or fragment. Never to a long sign-in / redirect URL. The best
 * ranked page that can complete `q` is the one it completes to.
 */
function inlineMatch(t: PageText, q: string): boolean {
  if (hostPart(t.shownLower).startsWith(q) && originOfPage(t)) return true;
  return q.includes("/") && !/[?#]/.test(t.shown) && t.shownLower.startsWith(q);
}

const hostPart = (shown: string) => /^[^/?#]*/.exec(shown)![0];

function inlineTarget(q: string, c: Candidate): { text: string; url: string; favicon: string | null } {
  const origin = originOfPage(c.text);
  const host = hostPart(c.text.shown);
  if (origin && host.toLowerCase().startsWith(q)) return { text: host, url: `${origin}/`, favicon: c.favicon };
  return { text: c.text.shown, url: c.url, favicon: c.favicon };
}

/** Collects rows up to `limit`, dropping duplicates. */
class Output {
  readonly items: Suggestion[] = [];
  private readonly seen = new Set<string>();
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  push(...rows: Suggestion[]) {
    for (const row of rows) {
      const key = suggestionKey(row);
      if (this.items.length >= this.limit || this.seen.has(key)) continue;
      this.seen.add(key);
      this.items.push(row);
    }
  }
}

const createRow = (c: { id: string; title: string; url: string; site: string }): Suggestion => ({ kind: "create", id: c.id, title: c.title, url: c.url, site: c.site });

const actionRow = (a: CommandAction): Suggestion => ({
  kind: "action",
  id: a.id,
  title: a.title,
  ...(a.icon ? { icon: a.icon } : {}),
  ...(a.hint ? { hint: a.hint } : {}),
});

/** Engine suggestions minus the query itself and repeats (case-insensitive). */
function dedupeSuggestions(remote: readonly string[], query: string): string[] {
  const seen = new Set([query.trim().toLowerCase()]);
  return remote.filter((s) => {
    const key = s.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
