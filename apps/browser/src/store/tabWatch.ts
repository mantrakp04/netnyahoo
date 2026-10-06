import { useMemo, useRef, useSyncExternalStore } from "react";
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

/** What `memoRead` remembers. */
export type Memo<T> = { deps: readonly unknown[]; value: T } | null;

/**
 * `compute()` unless every dependency is the same object as last time, in which case the last value: a snapshot for
 * `useSyncExternalStore` stays the same value while what it reads does. When it is computed again and `equal` to the last
 * value, the last value is kept, so React sees no change.
 */
export function memoRead<T>(memo: { current: Memo<T> }, deps: readonly unknown[], compute: () => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const last = memo.current;
  if (last && last.deps.length === deps.length && last.deps.every((d, i) => d === deps[i])) return last.value;
  const next = compute();
  const value = last && equal(last.value, next) ? last.value : next;
  memo.current = { deps, value };
  return value;
}

/** Listeners by key, woken by one shared store listener. See `keyedWatch`. */
export type KeyedWatch = {
  /** Calls `listener` after each store update that changed `key`'s entry; returns the unsubscribe. */
  watch(key: string, listener: () => void): () => void;
  /** The number of keys with a watcher (tests). */
  size(): number;
};

/**
 * One store listener for every watcher of a store's per-key entries. `changed(key, s, prev)` says whether an update
 * changed what `key`'s watchers read; `any(s, prev)` is the cheap test that rules out the whole update first (is the map
 * itself the same object). An update costs one `any` plus one `changed` per watched key, and the hooks of the keys that
 * changed, however many rows watch: no selector runs for the rest.
 */
export function keyedWatch<S>(store: Readable<S>, changed: (key: string, s: S, prev: S) => boolean, any: (s: S, prev: S) => boolean = () => true): KeyedWatch {
  const watchers = new Map<string, Set<() => void>>();
  let listening = false;
  const wake = (s: S, prev: S) => {
    if (!any(s, prev)) return;
    for (const [key, listeners] of watchers) {
      if (!changed(key, s, prev)) continue;
      for (const listener of [...listeners]) listener();
    }
  };
  return {
    watch(key, listener) {
      if (!listening) {
        listening = true;
        subscribeOf(store)(wake);
      }
      let listeners = watchers.get(key);
      if (!listeners) watchers.set(key, (listeners = new Set()));
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && watchers.get(key) === listeners) watchers.delete(key);
      };
    },
    size: () => watchers.size,
  };
}

/**
 * `get` over one key's entry of a `keyedWatch`'s store, re-rendering only when that key changes. `get` must return a
 * stable value (a primitive, or one cached by the entry's identity: see `entrySnapshot`).
 */
export function useWatched<T>(watch: KeyedWatch, key: string, get: () => T): T {
  const subscribe = useMemo(() => (listener: () => void) => watch.watch(key, listener), [watch, key]);
  return useSyncExternalStore(subscribe, get);
}

/**
 * One key's entry of a keyed store (`read`), through `select`: re-rendering only when that entry changes, and not when
 * `select` gives an equal value. `select` runs again when the entry or the function changes (callers pass inline
 * closures), so it may read the render's props; it must read the entry alone.
 */
export function useWatchedEntry<E, T>(watch: KeyedWatch, key: string, read: () => E, select: (entry: E) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const memo = useRef<Memo<T>>(null);
  return useWatched(watch, key, () => {
    const entry = read();
    return memoRead(memo, [entry, select], () => select(entry), equal);
  });
}

const tabs = keyedWatch<BrowserState>(
  useBrowser,
  (id, s, prev) => s.tabs[id] !== prev.tabs[id],
  (s, prev) => s.tabs !== prev.tabs,
);

/** Calls `listener` after each store update that replaced `tabId`'s tab object (or added or removed it). */
export const watchTab = tabs.watch;

/** The same for a tab's live state (`store.live[tabId]`). */
export const liveWatch = keyedWatch<BrowserState>(
  useBrowser,
  (id, s, prev) => s.live[id] !== prev.live[id],
  (s, prev) => s.live !== prev.live,
);

/** The number of tabs with a watcher (tests). */
export const watchedTabs = tabs.size;

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

// What a sidebar row shows: the tab, its live state, whether it is its window's active tab, whether it is selected.
const isActive = (s: BrowserState, id: string): boolean => {
  const tab = s.tabs[id];
  if (!tab) return false;
  const w = s.windows[tab.windowId];
  return !!w && w.activeTabIds[tab.profileId] === id;
};
const isSelected = (s: BrowserState, id: string): boolean => {
  const tab = s.tabs[id];
  return !!tab && !!s.selection[tab.windowId]?.includes(id);
};

const tabStates = keyedWatch<BrowserState>(
  useBrowser,
  (id, s, prev) =>
    s.tabs[id] !== prev.tabs[id] ||
    s.live[id] !== prev.live[id] ||
    (s.windows !== prev.windows && isActive(s, id) !== isActive(prev, id)) ||
    (s.selection !== prev.selection && isSelected(s, id) !== isSelected(prev, id)),
  (s, prev) => s.tabs !== prev.tabs || s.live !== prev.live || s.windows !== prev.windows || s.selection !== prev.selection,
);

/** Calls `listener` after each store update that changed `tabId`'s tab or live state, or made it (not) active or selected. */
export const watchTabState = tabStates.watch;

/** The number of tabs with a state watcher (tests). */
export const watchedTabStates = tabStates.size;

/**
 * Something about one tab that depends on the tab, its live state, whether it is the window's active tab and whether it
 * is selected, and on nothing else in the store (a sidebar row's flags): re-rendered only when one of those changes for
 * this tab. A switch wakes the two rows involved, not every row. `select` must read only those.
 */
export function useTabState<T>(tabId: string, select: (s: BrowserState) => T, equal?: (a: T, b: T) => boolean): T {
  const memo = useRef<Memo<T>>(null);
  return useWatched(tabStates, tabId, () => {
    const s = useBrowser.getState();
    return memoRead(memo, [s.tabs[tabId], s.live[tabId], s.windows, s.selection, select], () => select(s), equal);
  });
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
