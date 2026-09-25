/**
 * `netnyahoo://` URLs: the app's name for its internal pages, like Dia's dia:// and Brave's
 * brave://. The app stores and shows this form everywhere (tabs, history, bookmarks, the bar);
 * the engine only knows Chrome's chrome:// WebUI, so the web view maps between the two
 * (packages/cef WebView). chrome:// and about: are still accepted as input.
 *
 * Which hosts the app draws itself and which are Chrome's pages: see docs/store-api.md.
 */
export const APP_SCHEME = "netnyahoo";

const APP_PREFIX = /^(view-source:)?netnyahoo:(?:\/\/)?/i;
const ENGINE_PREFIX = /^(view-source:)?chrome:(?:\/\/)?/i;
/** about: pages that are pages of their own, not names for chrome:// ones (as in Chrome). */
const ABOUT_PAGE = /^about:(blank|srcdoc)([?#]|$)/i;
const ABOUT_ALIAS = /^about:([a-z][a-z0-9-]*)/i;

/** Hosts drawn by the app in a tab (components/pages); Chrome's pages of the same name never show. */
export const APP_PAGE_HOSTS = ["history", "bookmarks", "downloads"] as const;
export type AppPageHost = (typeof APP_PAGE_HOSTS)[number];

/** `netnyahoo://Version/x` → host `version`, rest `/x` (the path, query and hash as typed). */
function split(url: string, prefix: RegExp): { viewSource: string; host: string; rest: string } | null {
  const m = prefix.exec(url);
  if (!m) return null;
  const after = url.slice(m[0].length);
  const host = /^[^/?#]*/.exec(after)![0];
  return { viewSource: m[1] ? "view-source:" : "", host: host.toLowerCase(), rest: after.slice(host.length) };
}

/**
 * The app's form of a URL: `chrome://x`, `about:x` and `netnyahoo:x` → `netnyahoo://x` (scheme
 * and host lowercased). Anything else, including about:blank, is returned as is.
 */
export function toAppUrl(url: string): string {
  const parts = split(url, APP_PREFIX) ?? split(url, ENGINE_PREFIX);
  if (parts) return parts.host ? `${parts.viewSource}${APP_SCHEME}://${parts.host}${parts.rest}` : url;
  if (ABOUT_PAGE.test(url)) return url;
  const about = ABOUT_ALIAS.exec(url);
  return about ? `${APP_SCHEME}://${about[1]!.toLowerCase()}${url.slice(about[0].length)}` : url;
}

/** What the engine loads for an app URL: `netnyahoo://version` → `chrome://version`. Others unchanged. */
export function toEngineUrl(url: string): string {
  const parts = split(url, APP_PREFIX);
  return parts?.host ? `${parts.viewSource}chrome://${parts.host}${parts.rest}` : url;
}

export const isAppUrl = (url: string | null | undefined) => !!url && /^netnyahoo:\/\/[^/?#]/i.test(url);

/** `netnyahoo://settings/passwords?x` → { host: "settings", path: "/passwords", … }; null for other URLs. */
export function appUrlParts(url: string): { host: string; path: string; query: string; hash: string } | null {
  if (!isAppUrl(url)) return null;
  const parts = split(url, APP_PREFIX)!;
  const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(parts.rest)!;
  return { host: parts.host, path: m[1] ?? "", query: m[2] ?? "", hash: m[3] ?? "" };
}

/** `netnyahoo://version/` (or `chrome://version/`) → `netnyahoo://version`: what the bar shows as the host. */
export function appUrlOrigin(url: string): string | null {
  const parts = appUrlParts(toAppUrl(url));
  return parts ? `${APP_SCHEME}://${parts.host}` : null;
}

export type AppUrlRoute =
  /** One of the app's own pages, shown in the tab. */
  | { kind: "page"; page: AppPageHost }
  /** netnyahoo://settings[/section]: the Settings window, when the app has that section (else the engine's page). */
  | { kind: "settings"; section: string | null }
  /** netnyahoo://newtab: the app's New Tab page (Chrome's would show its own). */
  | { kind: "newTab" }
  /** Chrome's WebUI page, loaded in the tab. */
  | { kind: "engine"; url: string };

/** Where an app URL goes (null for anything that isn't one). */
export function appUrlRoute(url: string): AppUrlRoute | null {
  const parts = appUrlParts(url);
  if (!parts) return null;
  if ((APP_PAGE_HOSTS as readonly string[]).includes(parts.host)) return { kind: "page", page: parts.host as AppPageHost };
  if (parts.host === "newtab") return { kind: "newTab" };
  if (parts.host === "settings") {
    const section = parts.path.split("/").filter(Boolean)[0];
    return { kind: "settings", section: section ?? null };
  }
  return { kind: "engine", url: toEngineUrl(url) };
}
