import { focus } from "../../lib/actions";
import { useBrowser } from "../../store/browser";
import { activeTabId, resolveWindowId, viewTabIds } from "../../store/model";
import type { Tab } from "../../store/types";

/**
 * Internal pages (Dia's dia://history, dia://bookmarks, dia://downloads): a tab
 * whose URL is `netnyahoo://<page>` shows a React page instead of a web view.
 */
export type InternalPageId = "history" | "bookmarks" | "downloads";

export const INTERNAL_PAGES: Record<InternalPageId, { title: string }> = {
  history: { title: "History" },
  bookmarks: { title: "Bookmarks" },
  downloads: { title: "Downloads" },
};

const SCHEME = "netnyahoo://";

export const internalUrl = (page: InternalPageId, query?: string) => `${SCHEME}${page}${query ? `?q=${encodeURIComponent(query)}` : ""}`;

/** The page an URL points at, or null for anything that isn't an internal page. */
export function internalPageOf(url: string | null | undefined): InternalPageId | null {
  if (!url?.toLowerCase().startsWith(SCHEME)) return null;
  const page = url.slice(SCHEME.length).split(/[/?#]/)[0]!.toLowerCase();
  return page in INTERNAL_PAGES ? (page as InternalPageId) : null;
}

/** `?q=` of an internal URL (e.g. History opened on a search). */
export function internalQuery(url: string): string {
  const q = /[?&]q=([^&#]*)/.exec(url)?.[1];
  try {
    return q ? decodeURIComponent(q) : "";
  } catch {
    return q ?? "";
  }
}

/**
 * The URL a tab shows: a pending navigation wins over the last committed URL, so a
 * web tab navigating to an internal page switches right away (it has no web view to
 * report the new URL).
 */
export const tabDestination = (t: Pick<Tab, "url" | "navigation">) => t.navigation?.url ?? t.url;

/** Tabs whose content is an internal page (they never get a web view). */
export const isInternalTab = (t: Pick<Tab, "url" | "navigation">) => internalPageOf(tabDestination(t)) !== null;

/**
 * Opens an internal page like Chrome's singleton tabs: an existing tab showing it in
 * the window is selected, a New Tab page is reused, otherwise it opens in a new tab.
 */
export function openInternalPage(page: InternalPageId, windowId?: string | null, options: { query?: string; background?: boolean } = {}) {
  const s = useBrowser.getState();
  const id = resolveWindowId(s, windowId);
  if (!id) return;
  // From Settings (or a menu with no browser window key), bring the window forward too.
  if (!options.background && (!windowId || windowId !== id)) focus(id);
  const url = internalUrl(page, options.query);
  const existing = viewTabIds(s, id).find((t) => internalPageOf(tabDestination(s.tabs[t]!)) === page);
  if (existing) {
    if (options.query) s.navigate(existing, url);
    if (!options.background) s.activate(existing);
    return;
  }
  const active = activeTabId(s, id);
  if (active && !s.tabs[active]!.url && !options.background) return s.navigate(active, url);
  s.newTab(id, { url, background: options.background });
}
