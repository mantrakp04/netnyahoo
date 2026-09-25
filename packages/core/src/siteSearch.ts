import { engineHost, searchUrl, type SearchEngine } from "./engines.ts";
import { hostOf, searchUrlFor } from "./omnibox.ts";

/** A site whose own search the command bar can scope to ("youtube.com ⇥ cats"). */
export type SiteSearch = { host: string; name: string; url: string };

/** Popular sites with a known search URL (Dia seeds these; others fall back to `site:`). */
export const POPULAR_SITE_SEARCHES: readonly SiteSearch[] = [
  { host: "youtube.com", name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" },
  { host: "wikipedia.org", name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=%s" },
  { host: "github.com", name: "GitHub", url: "https://github.com/search?q=%s" },
  { host: "amazon.com", name: "Amazon", url: "https://www.amazon.com/s?k=%s" },
  { host: "reddit.com", name: "Reddit", url: "https://www.reddit.com/search/?q=%s" },
  { host: "x.com", name: "X", url: "https://x.com/search?q=%s" },
  { host: "twitter.com", name: "X", url: "https://x.com/search?q=%s" },
  { host: "stackoverflow.com", name: "Stack Overflow", url: "https://stackoverflow.com/search?q=%s" },
  { host: "npmjs.com", name: "npm", url: "https://www.npmjs.com/search?q=%s" },
  { host: "maps.google.com", name: "Google Maps", url: "https://www.google.com/maps/search/%s" },
  { host: "drive.google.com", name: "Google Drive", url: "https://drive.google.com/drive/search?q=%s" },
  { host: "mail.google.com", name: "Gmail", url: "https://mail.google.com/mail/u/0/#search/%s" },
  { host: "imdb.com", name: "IMDb", url: "https://www.imdb.com/find/?q=%s" },
  { host: "open.spotify.com", name: "Spotify", url: "https://open.spotify.com/search/%s" },
  { host: "linkedin.com", name: "LinkedIn", url: "https://www.linkedin.com/search/results/all/?keywords=%s" },
  { host: "ebay.com", name: "eBay", url: "https://www.ebay.com/sch/i.html?_nkw=%s" },
  { host: "pinterest.com", name: "Pinterest", url: "https://www.pinterest.com/search/pins/?q=%s" },
  { host: "news.ycombinator.com", name: "Hacker News", url: "https://hn.algolia.com/?q=%s" },
  { host: "developer.mozilla.org", name: "MDN", url: "https://developer.mozilla.org/en-US/search?q=%s" },
  { host: "figma.com", name: "Figma", url: "https://www.figma.com/files/search?q=%s" },
  { host: "notion.so", name: "Notion", url: "https://www.notion.so/search?q=%s" },
  { host: "apps.apple.com", name: "App Store", url: "https://www.apple.com/us/search/%s?src=serp" },
  { host: "translate.google.com", name: "Google Translate", url: "https://translate.google.com/?text=%s" },
];

/**
 * Where a scoped query goes. `engine` scopes use that engine's URL (and its suggestions);
 * `site` scopes use the site's own search; `history` scopes are hosts you've visited that have
 * no known search page, searched with the default engine and `site:`.
 */
export type SearchScope = {
  kind: "engine" | "site" | "history";
  name: string;
  host: string;
  url: string;
  engineId?: string;
};

export type ScopeSources = {
  engines: readonly SearchEngine[];
  sites?: readonly SiteSearch[];
  /** Hosts from history / open tabs, most visited first. */
  hosts?: readonly string[];
};

/** "https://www.YouTube.com/" → "youtube.com". */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

/** "youtube.com" / "en.wikipedia.org" → "youtube" / "wikipedia" (the name people type). */
function siteLabel(host: string): string {
  const parts = host.split(".");
  return parts.length >= 2 ? parts[parts.length - 2]! : host;
}

/**
 * The search scope Tab would enter for `text` (what's in the bar, completion included): a
 * custom engine keyword, a built-in engine's host, a popular site (by host, or by name, like
 * "youtube"), or a visited host. Returns null for anything with spaces or no match.
 */
export function findScope(text: string, { engines, sites = POPULAR_SITE_SEARCHES, hosts = [] }: ScopeSources): SearchScope | null {
  const t = normalize(text);
  if (!t || /\s/.test(t)) return null;
  // A completed URL ("youtube.com/watch?v=…") scopes to its host.
  const host = hostOf(`https://${t}`) || t;

  for (const e of engines) {
    if (e.custom && e.keyword.toLowerCase() === t) return engineScope(e);
  }
  for (const e of engines) {
    if (e.custom) continue;
    const eHost = engineHost(e);
    if (e.keyword.toLowerCase() === host || eHost === host || (t.length >= 3 && t === siteLabel(eHost))) return engineScope(e);
  }
  for (const s of sites) {
    if (s.host === host || host.endsWith(`.${s.host}`) || (t === host && t.length >= 3 && s.host.split(".").length === 2 && siteLabel(s.host) === t)) {
      return { kind: "site", name: s.name, host: s.host, url: s.url };
    }
  }
  if (host.includes(".") && hosts.includes(host)) return { kind: "history", name: host, host, url: "" };
  return null;
}

function engineScope(e: SearchEngine): SearchScope {
  return { kind: "engine", name: e.name, host: engineHost(e), url: e.url, engineId: e.id };
}

/** The URL a scoped query loads. History scopes search `site:host` with the default engine. */
export function scopedSearchUrl(scope: SearchScope, query: string, defaultEngine: Pick<SearchEngine, "url">): string {
  if (scope.kind === "history") return searchUrl(defaultEngine, `site:${scope.host} ${query.trim()}`);
  return searchUrlFor(scope.url, query);
}
