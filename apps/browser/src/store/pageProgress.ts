import { useMemo, useSyncExternalStore } from "react";

// A page's load progress, kept apart from the browser store. A load reports it many times, for tabs in the background
// as much as for the one on screen, and only a shown tab's bar reads it: in the store each report was an update that
// every store listener and component subscription heard. Here a report wakes that tab's bar alone (nothing for a
// tab nobody shows), and a bar that appears later (a switch to a tab that's loading) reads the value as it is now.

const values = new Map<string, number>();
const watchers = new Map<string, Set<() => void>>();

export function setPageProgress(tabId: string, progress: number) {
  if ((values.get(tabId) ?? 0) === progress) return;
  if (progress) values.set(tabId, progress);
  else values.delete(tabId);
  const listeners = watchers.get(tabId);
  if (listeners) for (const listener of [...listeners]) listener();
}

/** The last progress a tab's page reported: 0 before its first report and once its page is gone (closed, asleep, discarded). */
export const pageProgressOf = (tabId: string) => values.get(tabId) ?? 0;

/** Calls `listener` after each change of `tabId`'s progress. */
export function watchPageProgress(tabId: string, listener: () => void): () => void {
  let listeners = watchers.get(tabId);
  if (!listeners) watchers.set(tabId, (listeners = new Set()));
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && watchers.get(tabId) === listeners) watchers.delete(tabId);
  };
}

export function usePageProgress(tabId: string): number {
  const subscribe = useMemo(() => (listener: () => void) => watchPageProgress(tabId, listener), [tabId]);
  return useSyncExternalStore(subscribe, () => pageProgressOf(tabId));
}
