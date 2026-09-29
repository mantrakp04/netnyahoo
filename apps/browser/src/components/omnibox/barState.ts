import type { SearchScope } from "@netnyahoo/core";

export type BarSnapshot = {
  typed: string;
  edited: boolean;
  selection: { start: number; end: number };
  selected: number;
  scope: SearchScope | null;
};

const ntpQueries = new Map<string, BarSnapshot>();

export const savedNtpQuery = (tabId: string) => ntpQueries.get(tabId) ?? null;

export function saveNtpQuery(tabId: string, snapshot: BarSnapshot | null) {
  if (snapshot?.typed || snapshot?.scope) ntpQueries.set(tabId, snapshot);
  else ntpQueries.delete(tabId);
}

const heroBars = new Map<string, () => void>();

export function registerHeroBar(windowId: string, focus: () => void): () => void {
  heroBars.set(windowId, focus);
  return () => {
    if (heroBars.get(windowId) === focus) heroBars.delete(windowId);
  };
}

export function focusHeroBar(windowId: string): boolean {
  const focus = heroBars.get(windowId);
  focus?.();
  return !!focus;
}
