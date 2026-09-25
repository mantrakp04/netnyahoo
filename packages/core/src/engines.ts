import { hostOf, searchUrlFor } from "./omnibox.ts";

/**
 * A search engine the command bar can use. `url` and `suggestUrl` are templates where `%s` is
 * the URL-encoded query. `keyword` triggers Tab-to-search (for built-ins it's the site's host,
 * like Chrome; custom engines choose their own, e.g. "w").
 */
export type SearchEngine = {
  id: string;
  name: string;
  keyword: string;
  url: string;
  /** Returns OpenSearch suggestion JSON: `[query, [suggestion, …], …]`. */
  suggestUrl?: string;
  custom?: boolean;
};

/** A user-added engine, as stored in settings. */
export type CustomSearchEngine = { id: string; name: string; keyword: string; url: string };

export const DEFAULT_ENGINE_ID = "google";

/**
 * Dia's search engine choices (plus common ones Chrome offers). ChatGPT and Perplexity are
 * plain search URLs here; nothing is routed to an assistant.
 */
export const BUILT_IN_ENGINES: readonly SearchEngine[] = [
  {
    id: "google",
    name: "Google",
    keyword: "google.com",
    url: "https://www.google.com/search?q=%s",
    suggestUrl: "https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&q=%s",
  },
  { id: "bing", name: "Bing", keyword: "bing.com", url: "https://www.bing.com/search?q=%s", suggestUrl: "https://api.bing.com/osjson.aspx?query=%s" },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    keyword: "duckduckgo.com",
    url: "https://duckduckgo.com/?q=%s",
    suggestUrl: "https://duckduckgo.com/ac/?q=%s&type=list",
  },
  { id: "perplexity", name: "Perplexity", keyword: "perplexity.ai", url: "https://www.perplexity.ai/search?q=%s" },
  { id: "chatgpt", name: "ChatGPT", keyword: "chatgpt.com", url: "https://chatgpt.com/?q=%s" },
  {
    id: "ecosia",
    name: "Ecosia",
    keyword: "ecosia.org",
    url: "https://www.ecosia.org/search?q=%s",
    suggestUrl: "https://ac.ecosia.org/autocomplete?q=%s&type=list",
  },
  {
    id: "brave",
    name: "Brave Search",
    keyword: "search.brave.com",
    url: "https://search.brave.com/search?q=%s",
    suggestUrl: "https://search.brave.com/api/suggest?q=%s",
  },
  { id: "kagi", name: "Kagi", keyword: "kagi.com", url: "https://kagi.com/search?q=%s" },
  {
    id: "startpage",
    name: "Startpage",
    keyword: "startpage.com",
    url: "https://www.startpage.com/do/search?q=%s",
    suggestUrl: "https://www.startpage.com/osuggestions?q=%s",
  },
  {
    id: "yahoo",
    name: "Yahoo",
    keyword: "yahoo.com",
    url: "https://search.yahoo.com/search?p=%s",
    suggestUrl: "https://search.yahoo.com/sugg/ff?output=fxjson&command=%s",
  },
  {
    id: "baidu",
    name: "Baidu",
    keyword: "baidu.com",
    url: "https://www.baidu.com/s?wd=%s",
    suggestUrl: "https://www.baidu.com/su?action=opensearch&ie=utf-8&wd=%s",
  },
  {
    id: "yandex",
    name: "Yandex",
    keyword: "yandex.com",
    url: "https://yandex.com/search/?text=%s",
    suggestUrl: "https://suggest.yandex.com/suggest-ff.cgi?part=%s",
  },
];

/** Built-ins first, then the user's own. */
export function allEngines(custom: readonly CustomSearchEngine[] = []): SearchEngine[] {
  return [...BUILT_IN_ENGINES, ...custom.map((e) => ({ ...e, custom: true }))];
}

/** The engine with `id`, falling back to Google (e.g. a deleted custom default). */
export function engineById(engines: readonly SearchEngine[], id: string | undefined): SearchEngine {
  return engines.find((e) => e.id === id) ?? BUILT_IN_ENGINES[0]!;
}

export const searchUrl = (engine: Pick<SearchEngine, "url">, query: string) => searchUrlFor(engine.url, query);

export const suggestRequestUrl = (engine: SearchEngine, query: string) =>
  engine.suggestUrl && query.trim() ? searchUrlFor(engine.suggestUrl, query) : null;

/** The engine's site, for its favicon and for matching Tab-to-search. */
export const engineHost = (engine: Pick<SearchEngine, "url">) => hostOf(engine.url.replace(/%s/g, "q"));

/** OpenSearch suggestion JSON → suggestions (anything malformed → none). */
export function parseSuggestions(body: unknown): string[] {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return [];
  return (body[1] as unknown[]).filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim());
}

export type EngineInput = { name: string; keyword: string; url: string };

/**
 * Checks a custom engine before it's saved. `url` must be http(s) and contain `%s`; the
 * keyword must be one word and not clash with another engine's (`ignoreId`: the one being edited).
 */
export function validateEngine(input: EngineInput, engines: readonly SearchEngine[], ignoreId?: string): string | null {
  const name = input.name.trim();
  const keyword = input.keyword.trim().toLowerCase();
  const url = input.url.trim();
  if (!name) return "Enter a name.";
  if (!keyword) return "Enter a shortcut.";
  if (/\s/.test(keyword)) return "The shortcut can't contain spaces.";
  if (!/^https?:\/\/[^/?#\s]+/i.test(url)) return "Enter a URL that starts with http:// or https://.";
  if (!url.includes("%s")) return "The URL must contain %s where the search terms go.";
  if (engines.some((e) => e.id !== ignoreId && e.keyword.toLowerCase() === keyword)) return `“${keyword}” is already used by another search engine.`;
  return null;
}

/** Normalises user input into a stored engine (trimmed, keyword lower-cased). */
export function makeCustomEngine(input: EngineInput, id: string): CustomSearchEngine {
  return { id, name: input.name.trim(), keyword: input.keyword.trim().toLowerCase(), url: input.url.trim() };
}
