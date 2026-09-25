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

type Candidate = {
  url: string;
  title: string;
  favicon: string | null;
  visits: number;
  lastVisit: number;
  tabId?: string;
  bookmarked: boolean;
};

const DAY = 86_400_000;
/** Same page for de-duplication: fragment and trailing slash don't matter. */
const pageKey = (url: string) => url.replace(/#.*$/, "").replace(/\/$/, "");

function candidates(source: SuggestionSource, now: number, currentTabId?: string): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const h of source.history) {
    const key = pageKey(h.url);
    if (!byKey.has(key)) byKey.set(key, { ...h, bookmarked: false });
  }
  for (const b of source.bookmarks ?? []) {
    const existing = byKey.get(pageKey(b.url));
    if (existing) existing.bookmarked = true;
    else byKey.set(pageKey(b.url), { ...b, visits: 0, lastVisit: 0, bookmarked: true });
  }
  for (const t of source.tabs) {
    if (!t.url || t.id === currentTabId) continue;
    const existing = byKey.get(pageKey(t.url));
    if (existing) existing.tabId ??= t.id;
    // An open tab not in history yet (still loading, or a restored tab) is still recent.
    else byKey.set(pageKey(t.url), { ...t, visits: 0, lastVisit: now, tabId: t.id, bookmarked: false });
  }
  return [...byKey.values()];
}

const wordPrefix = (text: string, token: string) => text.split(/[^a-z0-9]+/).some((w) => w.startsWith(token));

/** How well the text matches: URL prefix beats a URL segment beats the title. */
function matchScore(c: Candidate, q: string, tokens: string[]): number {
  const shown = displayUrl(c.url).toLowerCase();
  const title = c.title.toLowerCase();
  let s = 0;
  if (shown.startsWith(q)) s = 100;
  else if (shown.split(/[./]/).some((part) => part.startsWith(q))) s = 60;
  else if (q.length >= 2 && shown.includes(q)) s = 30;
  if (title.startsWith(q)) s += 40;
  else if (q.length >= 2 ? title.includes(q) : wordPrefix(title, q)) s += 20;
  if (s > 0 || tokens.length < 2) return s;
  // Several words: each has to match a title or URL word.
  for (const token of tokens) {
    if (wordPrefix(title, token)) s += 15;
    else if (wordPrefix(shown, token)) s += 10;
    else if (token.length >= 3 && (title.includes(token) || shown.includes(token))) s += 5;
    else return 0;
  }
  return s;
}

/** Frecency: visit count (log-scaled) minus age, plus small boosts for bookmarks and open tabs. */
function frecency(c: Candidate, now: number): number {
  const ageDays = c.lastVisit ? Math.max(0, (now - c.lastVisit) / DAY) : 10;
  return Math.log2(1 + c.visits) * 8 - Math.min(ageDays, 30) + (c.bookmarked ? 20 : 0) + (c.tabId ? 6 : 0);
}

const pageSuggestion = (c: Candidate): Suggestion => ({
  kind: "page",
  url: c.url,
  title: c.title,
  favicon: c.favicon,
  ...(c.tabId ? { tabId: c.tabId } : {}),
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

  const pool = candidates(source, now, options.currentTabId);
  const ranked = pool
    .map((c) => {
      const m = matchScore(c, q, tokens);
      const derank = options.currentUrl && pageKey(c.url) === pageKey(options.currentUrl) ? 80 : 0;
      return { c, m, s: m + frecency(c, now) - derank };
    })
    .filter((x) => x.m > 0)
    .sort((a, b) => b.s - a.s);

  const out = new Output(limit);
  const remoteRows = (url: (text: string) => string, name: string) =>
    dedupeSuggestions(remote, query)
      .slice(0, 4)
      .map((text): Suggestion => ({ kind: "search", query: text, url: url(text), engine: name, suggested: true }));

  if (scope) {
    const scopedUrl = (text: string) => scopedSearchUrl(scope, text, engine);
    out.push({ kind: "search", query, url: scopedUrl(query), engine: scope.name });
    out.push(...remoteRows(scopedUrl, scope.name));
    const onSite = (url: string) => {
      const host = hostOf(url);
      return host === scope.host || host.endsWith(`.${scope.host}`);
    };
    out.push(...ranked.filter((x) => onSite(x.c.url)).slice(0, 4).map((x) => pageSuggestion(x.c)));
    return { items: out.items, completion: "" };
  }

  // "?cats" always searches.
  if (query.startsWith("?")) {
    const text = query.slice(1).trim();
    if (!text) return { items: [], completion: "" };
    out.push({ kind: "search", query: text, url: searchUrl(engine, text), engine: engine.name });
    out.push(...dedupeSuggestions(remote, text).slice(0, 4).map((t): Suggestion => ({ kind: "search", query: t, url: searchUrl(engine, t), engine: engine.name, suggested: true })));
    return { items: out.items, completion: "" };
  }

  const search: Suggestion = { kind: "search", query, url: searchUrl(engine, query), engine: engine.name };
  const typedUrl = fixupUrl(query);
  const calc = calculate(query);
  // The raw text: "new " (trailing space) already lists the commands.
  const creates = matchQuickCreate(raw.trimStart());
  const actionMatches = matchActions(query, actions, 3).filter((m) => m.exact || m.score >= 50);
  const websiteFirst = preference === "website";

  const best = ranked[0];
  const inline = websiteFirst && !/\s/.test(query) ? inlineTarget(q, ranked) : null;
  const completion = inline ? inline.text.slice(query.length) : "";

  let top: Suggestion;
  if (creates.length && /^\S+\s+\S/.test(query)) top = createRow(creates[0]!);
  else if (actionMatches[0]?.exact) top = actionRow(actionMatches[0].action);
  else if (completion) {
    // ↩ goes where the bar says: the completed host (titled if we know its page), not the page it came from.
    const known = pool.find((c) => pageKey(c.url) === pageKey(inline!.url));
    top = known ? pageSuggestion(known) : { kind: "page", url: inline!.url, title: "", favicon: inline!.favicon };
  }
  else if (typedUrl) {
    // A typed address; titled if we know the page, else just the address (no " — url" suffix).
    const known = pool.find((c) => pageKey(c.url) === pageKey(typedUrl));
    top = known ? pageSuggestion(known) : { kind: "page", url: typedUrl, title: "", favicon: null };
  } else if (websiteFirst && best && best.m >= 40) top = pageSuggestion(best.c);
  else top = search;

  out.push(top);
  out.push(search);
  if (calc) out.push({ kind: "calc", expression: calc.expression, value: calc.display, url: searchUrl(engine, calc.expression) });
  out.push(...actionMatches.slice(0, 2).map((m) => actionRow(m.action)));
  out.push(...creates.map(createRow));
  const pages = ranked.map((x) => pageSuggestion(x.c));
  out.push(...pages.slice(0, 3));
  out.push(...remoteRows((text) => searchUrl(engine, text), engine.name));
  out.push(...pages.slice(3));
  return { items: out.items, completion };
}

/**
 * Chrome's inline autocompletion, which is conservative: the text completes to a site's host
 * ("m" → "mail.google.com", from any page on it), or, once a path is being typed, to a visited
 * address that carries no query or fragment. Never to a long sign-in / redirect URL.
 */
function inlineTarget(q: string, ranked: readonly { c: Candidate }[]): { text: string; url: string; favicon: string | null } | null {
  for (const { c } of ranked) {
    const shown = displayUrl(c.url);
    const host = /^[^/?#]*/.exec(shown)![0];
    const origin = /^https?:\/\/[^/?#]+/i.exec(c.url)?.[0];
    if (origin && host.toLowerCase().startsWith(q)) return { text: host, url: `${origin}/`, favicon: c.favicon };
    if (q.includes("/") && !/[?#]/.test(shown) && shown.toLowerCase().startsWith(q)) return { text: shown, url: c.url, favicon: c.favicon };
  }
  return null;
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
