export const APP_SCHEME = "arcadia";

const APP_PREFIX = /^(view-source:)?arcadia:(?:\/\/)?/i;
const ENGINE_PREFIX = /^(view-source:)?chrome:(?:\/\/)?/i;
const ABOUT_PAGE = /^about:(blank|srcdoc)([?#]|$)/i;
const ABOUT_ALIAS = /^about:([a-z][a-z0-9-]*)/i;

export const APP_PAGE_HOSTS = ["history", "bookmarks", "downloads"] as const;
export type AppPageHost = (typeof APP_PAGE_HOSTS)[number];

function split(url: string, prefix: RegExp): { viewSource: string; host: string; rest: string } | null {
  const m = prefix.exec(url);
  if (!m) return null;
  const after = url.slice(m[0].length);
  const host = /^[^/?#]*/.exec(after)![0];
  return { viewSource: m[1] ? "view-source:" : "", host: host.toLowerCase(), rest: after.slice(host.length) };
}

export function toAppUrl(url: string): string {
  const parts = split(url, APP_PREFIX) ?? split(url, ENGINE_PREFIX);
  if (parts) return parts.host ? `${parts.viewSource}${APP_SCHEME}://${parts.host}${parts.rest}` : url;
  if (ABOUT_PAGE.test(url)) return url;
  const about = ABOUT_ALIAS.exec(url);
  return about ? `${APP_SCHEME}://${about[1]!.toLowerCase()}${url.slice(about[0].length)}` : url;
}

export function toEngineUrl(url: string): string {
  const parts = split(url, APP_PREFIX);
  return parts?.host ? `${parts.viewSource}chrome://${parts.host}${parts.rest}` : url;
}

export const isAppUrl = (url: string | null | undefined) => !!url && /^arcadia:\/\/[^/?#]/i.test(url);

export function appUrlParts(url: string): { host: string; path: string; query: string; hash: string } | null {
  if (!isAppUrl(url)) return null;
  const parts = split(url, APP_PREFIX)!;
  const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(parts.rest)!;
  return { host: parts.host, path: m[1] ?? "", query: m[2] ?? "", hash: m[3] ?? "" };
}

export function appUrlOrigin(url: string): string | null {
  const parts = appUrlParts(toAppUrl(url));
  return parts ? `${APP_SCHEME}://${parts.host}` : null;
}

export type AppUrlRoute =
  | { kind: "page"; page: AppPageHost }
  | { kind: "settings"; section: string | null }
  | { kind: "newTab" }
  | { kind: "engine"; url: string };

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
