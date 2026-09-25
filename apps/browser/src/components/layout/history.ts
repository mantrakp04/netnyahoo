import { create } from "zustand";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import type { TabLive } from "../../store/types";
import { internalPageOf, tabDestination } from "../pages/urls";
import { pageOf, patchPage, usePage } from "./pageState";

/**
 * The New Tab page as the first history entry, like Chromium's NTP: a tab that
 * started on it can go Back to it from its first page, and Forward returns to
 * that page — the browser stays alive (hidden) meanwhile, so nothing reloads.
 * An internal page (netnyahoo://history…) opened from the New Tab page goes back
 * to it the same way. Toolbar, ⌘[ / ⌘], swipes and the menus go through these.
 */
const store = () => useBrowser.getState();

export function canGoBack(tabId: string, live: Pick<TabLive, "canGoBack">): boolean {
  const page = pageOf(tabId);
  return !page.newTabShown && (live.canGoBack || page.backToNewTab);
}

export function canGoForward(tabId: string, live: Pick<TabLive, "canGoForward">): boolean {
  return !!pageOf(tabId).newTabShown || live.canGoForward;
}

/** The same, for React (re-renders when the New Tab page is shown or left). */
export function useHistoryAvailability(tabId: string, live: Pick<TabLive, "canGoBack" | "canGoForward">) {
  const shown = usePage(tabId, (p) => !!p.newTabShown);
  const backToNewTab = usePage(tabId, (p) => p.backToNewTab);
  return { back: !shown && (live.canGoBack || backToNewTab), forward: shown || live.canGoForward };
}

export function goBack(tabId: string) {
  const live = store().live[tabId];
  if (pageOf(tabId).newTabShown) return;
  if (live?.canGoBack) return void webviews.get(tabId)?.goBack();
  if (pageOf(tabId).backToNewTab) showNewTab(tabId);
}

export function goForward(tabId: string) {
  if (pageOf(tabId).newTabShown) return hideNewTab(tabId);
  void webviews.get(tabId)?.goForward();
}

/** Back to the New Tab page: the tab reads as a New Tab again; its page waits, hidden. */
function showNewTab(tabId: string, keep?: { url: string; title: string }) {
  const tab = store().tabs[tabId];
  if (!tab?.url) return;
  patchPage(tabId, { newTabShown: { url: keep?.url ?? tab.url, title: keep?.title ?? tab.title, favicon: tab.favicon }, status: "" });
  // An internal page has no web view to keep; its pending navigation would show it again.
  const internal = internalPageOf(tabDestination(tab)) !== null;
  store().updateTab(tabId, { url: "", title: "", favicon: null, ...(internal ? { navigation: null } : {}) });
}

/**
 * The back list's "New Tab" item from deeper in the history: the web view goes back to
 * its first page (hidden, `offset` entries back), which Forward then shows.
 */
export function goBackToNewTab(tabId: string, offset: number, first: { url: string; title: string }) {
  if (!pageOf(tabId).backToNewTab || pageOf(tabId).newTabShown) return;
  if (offset) void webviews.get(tabId)?.goToOffset(offset);
  showNewTab(tabId, offset ? first : undefined);
}

/** Forward from the New Tab page: the kept page comes back as it was. */
function hideNewTab(tabId: string) {
  const kept = pageOf(tabId).newTabShown;
  if (!kept) return;
  patchPage(tabId, { newTabShown: null });
  store().updateTab(tabId, { url: kept.url, title: kept.title, favicon: kept.favicon });
}

// An internal page opened on the New Tab page goes back to it (Chrome: NTP → chrome://history).
useBrowser.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return;
  for (const id in s.tabs) {
    const tab = s.tabs[id]!;
    const before = prev.tabs[id];
    if (!before || tab === before) continue;
    if (!tabDestination(before) && internalPageOf(tabDestination(tab)) && !pageOf(id).backToNewTab) patchPage(id, { backToNewTab: true });
  }
});

// MARK: History lists (the back / forward popover, the swipe overlay's destinations)

export type HistoryItem = {
  key: string;
  title: string;
  url: string;
  /** Entries from the current one in the web view's list; "newTab" is the New Tab page the tab started on. */
  offset: number | "newTab";
};

/** Up to `max` entries in `direction` (nearest first), as Chrome's back / forward menus list them. */
export async function historyItems(tabId: string, direction: -1 | 1, max = 15): Promise<HistoryItem[]> {
  const page = pageOf(tabId);
  const list = (await webviews.get(tabId)?.navigationEntries()) ?? [];
  const current = list.findIndex((e) => e.current);
  // Back on the New Tab page, the web view's current entry is the page Forward returns to.
  if (page.newTabShown) {
    if (direction < 0) return [];
    const items: HistoryItem[] = [];
    for (let i = Math.max(current, 0); i < list.length && items.length < max; i++) {
      const e = list[i]!;
      items.push({ key: String(i), title: e.title || e.url, url: e.url, offset: i - current });
    }
    // An internal page kept for Forward has no web view entries.
    if (!items.length) items.push({ key: "kept", title: page.newTabShown.title || page.newTabShown.url, url: page.newTabShown.url, offset: 0 });
    return items;
  }
  const items: HistoryItem[] = [];
  if (current >= 0) {
    for (let i = current + direction; i >= 0 && i < list.length && items.length < max; i += direction) {
      const e = list[i]!;
      items.push({ key: String(i), title: e.title || e.url, url: e.url, offset: i - current });
    }
  }
  // The New Tab page the tab started on is the oldest back entry.
  if (direction < 0 && page.backToNewTab && items.length < max) items.push({ key: "newTab", title: "New Tab", url: "", offset: "newTab" });
  return items;
}

/** Goes to an item of `historyItems(tabId, …)` in the tab itself. */
export async function goToHistoryItem(tabId: string, item: HistoryItem) {
  const page = pageOf(tabId);
  if (item.offset === "newTab") {
    const list = (await webviews.get(tabId)?.navigationEntries()) ?? [];
    const current = list.findIndex((e) => e.current);
    if (current <= 0 || !list[0]) return goBack(tabId);
    return goBackToNewTab(tabId, -current, list[0]);
  }
  if (page.newTabShown) {
    hideNewTab(tabId);
    if (item.offset) void webviews.get(tabId)?.goToOffset(item.offset);
    return;
  }
  if (item.offset === -1) return goBack(tabId);
  if (item.offset === 1) return goForward(tabId);
  if (item.offset) void webviews.get(tabId)?.goToOffset(item.offset);
}

/** The open back / forward list (press-and-hold or right-click on the toolbar buttons). */
export type HistoryMenu = { tabId: string; direction: -1 | 1; items: HistoryItem[] };
export const useHistoryMenu = create<{ menu: HistoryMenu | null }>(() => ({ menu: null }));

export async function openHistoryMenu(tabId: string, direction: -1 | 1) {
  const items = await historyItems(tabId, direction);
  if (!items.length) return;
  useHistoryMenu.setState({ menu: { tabId, direction, items } });
}

export const closeHistoryMenu = () => useHistoryMenu.setState({ menu: null });
