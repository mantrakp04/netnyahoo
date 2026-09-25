import type { SearchScope } from "@netnyahoo/core";

/**
 * What the command bar was showing: the query, whether it was typed (vs. the page URL the panel
 * opens with), the text selection, the highlighted row and any Tab-to-search scope.
 */
export type BarSnapshot = {
  typed: string;
  edited: boolean;
  selection: { start: number; end: number };
  selected: number;
  scope: SearchScope | null;
};

/**
 * Dia 1.28 "New Tab Page Query Restoration": going back to a New Tab page (switching back to its
 * tab, or navigating back to it) restores the query and selection. Kept per tab for the session.
 */
const ntpQueries = new Map<string, BarSnapshot>();

export const savedNtpQuery = (tabId: string) => ntpQueries.get(tabId) ?? null;

export function saveNtpQuery(tabId: string, snapshot: BarSnapshot | null) {
  if (snapshot?.typed || snapshot?.scope) ntpQueries.set(tabId, snapshot);
  else ntpQueries.delete(tabId);
}

/** The New Tab page bar of each window registers here so ⌘L can focus it. */
const heroBars = new Map<string, () => void>();

export function registerHeroBar(windowId: string, focus: () => void): () => void {
  heroBars.set(windowId, focus);
  return () => {
    if (heroBars.get(windowId) === focus) heroBars.delete(windowId);
  };
}

/** ⌘L on the New Tab page: focus its bar and select the query. False if the window shows no New Tab page. */
export function focusHeroBar(windowId: string): boolean {
  const focus = heroBars.get(windowId);
  focus?.();
  return !!focus;
}
