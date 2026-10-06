import { useMemo, useSyncExternalStore } from "react";
import { useBrowser, type BrowserState } from "./browser";
import type { Tab } from "./types";

// Store reads that cost nothing while they don't apply.
//
// Every `useBrowser(selector)` is a store subscription: each store update runs its selector, whatever changed. A
// window's tab panes are mounted for every tab, shown or not, so at 100 tabs a page's progress tick ran a few thousand
// selectors for panes nobody sees. Two ways out:
//
// - `useTabValue`: a read of one tab's own fields. All of them share one store listener that wakes a hook only when
//   its tab's object changed, so an update costs one identity check per watched tab plus the hooks of the tab that
//   changed.
// - `useStoreWhile`: a store read that only subscribes while `live`. While it isn't, the component isn't woken by the
//   store; whenever it renders (its parent showing it, say) it still reads the store as it is, so the first render
//   after `live` turns on is current, in the same commit.

type Readable<S> = { getState(): S; subscribe(listener: (s: S, prev: S) => void): () => void };

// React's subscriptions go through a store's own `subscribe`, as zustand's hooks do: the perf probe wraps the one on the
// hook to count the app's store listeners (lib/perfProbe.ts probeStore), and these are subscriptions, not listeners.
const subscribeOf = <S,>(store: Readable<S>): Readable<S>["subscribe"] => (store.subscribe as { unprobed?: Readable<S>["subscribe"] }).unprobed ?? store.subscribe;

const watchers = new Map<string, Set<() => void>>();
let listening = false;

function wake(s: BrowserState, prev: BrowserState) {
  if (s.tabs === prev.tabs) return;
  for (const [id, listeners] of watchers) {
    if (s.tabs[id] === prev.tabs[id]) continue;
    for (const listener of [...listeners]) listener();
  }
}

/** Calls `listener` after each store update that replaced `tabId`'s tab object (or added or removed it). */
export function watchTab(tabId: string, listener: () => void): () => void {
  if (!listening) {
    listening = true;
    subscribeOf(useBrowser)(wake);
  }
  let listeners = watchers.get(tabId);
  if (!listeners) watchers.set(tabId, (listeners = new Set()));
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && watchers.get(tabId) === listeners) watchers.delete(tabId);
  };
}

/** The number of tabs with a watcher (tests). */
export const watchedTabs = () => watchers.size;

/**
 * A snapshot getter for `select` over one tab: the same value (by `equal`) while the tab object is the same, so React
 * sees a stable snapshot. `select` must read the tab alone.
 */
export function tabSnapshot<T>(tabId: string, select: (tab: Tab | undefined) => T, equal: (a: T, b: T) => boolean = Object.is): () => T {
  let seen: { tab: Tab | undefined; value: T } | null = null;
  return () => {
    const tab = useBrowser.getState().tabs[tabId];
    if (seen && seen.tab === tab) return seen.value;
    const value = select(tab);
    seen = { tab, value: seen && equal(seen.value, value) ? seen.value : value };
    return seen.value;
  };
}

/** One tab's fields, re-rendering only when that tab changes. `select` must read the tab alone. */
export function useTabValue<T>(tabId: string, select: (tab: Tab | undefined) => T, equal?: (a: T, b: T) => boolean): T {
  const [subscribe, get] = useMemo(() => [(listener: () => void) => watchTab(tabId, listener), tabSnapshot(tabId, select, equal)] as const, [tabId]);
  return useSyncExternalStore(subscribe, get);
}

// Marked so the perf probe doesn't count it as a live subscription.
const inert = Object.assign((_: () => void) => () => {}, { inert: true });

/** `store`'s `select`, subscribed only while `live` (see the top of this file). `select` must return a stable value. */
export function useStoreWhile<S, T>(store: Readable<S>, live: boolean, select: (s: S) => T): T {
  return useSyncExternalStore(live ? subscribeOf(store) : inert, () => select(store.getState()));
}

export const shallowEqual = <T extends Record<string, unknown>>(a: T, b: T) => {
  for (const key in a) if (!Object.is(a[key], b[key])) return false;
  for (const key in b) if (!(key in a)) return false;
  return true;
};
