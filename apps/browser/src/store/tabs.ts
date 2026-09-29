import { resolveInput } from "@netnyahoo/core";
import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { leaveGroups, syncGroupOrder } from "./groups";
import {
  IDLE_LIVE,
  inPinnedContainer,
  makeTab,
  merge,
  navigationTo,
  newId,
  pinnedFirst,
  snapshotTab,
  viewTabIds,
  without,
} from "./model";
import { groupWithOpener, onUrlChange, pruneSelection, samePage } from "./organize";
import { searchUrlPrefix } from "./settings";
import { removeFromSplits, splitOf } from "./splits";
import type { BrowserWindow, ClosedTab, Tab, TabLive, TabSnapshot } from "./types";

export type NewTabOptions = {
  /** Typed input or a URL (resolved like the command bar). Omit for the New Tab page. */
  url?: string;
  /** Open without selecting it (⌘-click). */
  background?: boolean;
  /**
   * Adopt the popup browser Chromium already created (keeps window.opener), or start with
   * another tab's back/forward list: "clone:<tab id>" (a copy of that open tab) or
   * "restore:<tab id>" (that closed tab's). Without one the tab loads `url`.
   */
  adoptId?: string;
  openerId?: string;
  /** Defaults to the window's current profile (always the window's own when incognito). */
  profileId?: string;
  pinned?: boolean;
  /** Restored state (title, favicon, zoom…). */
  snapshot?: Partial<TabSnapshot>;
  /** Index in window.tabIds; default follows Settings › New tab position, or goes after the opener. */
  index?: number;
};

/**
 * App URLs that open somewhere other than a tab (netnyahoo://settings → the Settings window),
 * set by components/pages/appUrls. Returns true when it opened the URL.
 */
let openOutsideTab: (url: string, windowId: string) => boolean = () => false;
export const setAppUrlOpener = (open: typeof openOutsideTab) => {
  openOutsideTab = open;
};

export type TabsSlice = {
  tabs: Record<string, Tab>;
  live: Record<string, TabLive>;
  closedTabs: ClosedTab[];

  newTab(windowId: string, options?: NewTabOptions): string;
  /**
   * ⌘W. Closing the last tab of the window's profile closes the window (ask first: lib/actions).
   * A pinned tab, or a tab of a pinned group, isn't removed: its page unloads (`unloadPinnedTabs`);
   * Unpin (or Remove from Group) and then Close removes it.
   */
  closeTab(id: string): void;
  /** Bulk close (others/above/below/all); leaves a New Tab page if the view would be empty. Pinned tabs and pinned groups' tabs unload. */
  closeTabs(ids: string[]): void;
  activate(id: string): void;
  /** Index into the window's view; -1 = last. */
  activateIndex(windowId: string, index: number): void;
  cycle(windowId: string, delta: 1 | -1): void;
  /** User navigation (command bar, bookmarks…); pass `{ userInitiated: false }` for page- or script-driven loads. */
  navigate(id: string, input: string, options?: { userInitiated?: boolean }): void;
  updateTab(id: string, patch: Partial<Tab>): void;
  updateLive(id: string, patch: Partial<TabLive>): void;
  duplicateTab(id: string): string | undefined;
  togglePin(id: string): void;
  /** Moves a tab to `toIndex` within its section (pinned or regular) of its profile's tabs. */
  moveTab(id: string, toIndex: number): void;
};

const MAX_CLOSED_TABS = 50;

/** Where a new tab goes in window.tabIds. */
function insertionIndex(s: BrowserState, w: BrowserWindow, tab: Tab): number {
  if (tab.pinned) {
    let last = -1;
    w.tabIds.forEach((id, i) => s.tabs[id]?.pinned && (last = i));
    return last + 1;
  }
  const opener = tab.openerId ? s.tabs[tab.openerId] : undefined;
  if (opener && opener.windowId === w.id && opener.profileId === tab.profileId && !opener.pinned) {
    // After the opener and the tabs it already opened, like Chromium.
    let i = w.tabIds.indexOf(opener.id);
    while (i + 1 < w.tabIds.length && s.tabs[w.tabIds[i + 1]!]?.openerId === opener.id) i++;
    return i + 1;
  }
  if (s.settings.newTabPosition === "top") {
    // The top of the list: below pinned tabs and pinned groups.
    const pinnedGroup = new Set(Object.values(s.groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
    const first = w.tabIds.findIndex((id) => s.tabs[id]?.profileId === tab.profileId && !s.tabs[id]?.pinned && !pinnedGroup.has(id));
    if (first >= 0) return first;
  }
  return w.tabIds.length;
}

/**
 * State after selecting a tab: the window switches to the tab's profile, a tab
 * restored from the last session starts loading, and the command panel closes.
 */
export function activated(s: BrowserState, id: string): Partial<BrowserState> {
  const tab = s.tabs[id];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w) return {};
  const lazy = !!tab.url && !tab.navigation && !tab.adoptId;
  const { unloaded: _, ...rest } = tab;
  const nextTab: Tab = { ...rest, lastActiveAt: Date.now(), ...(lazy ? { navigation: navigationTo(tab.url) } : {}) };
  const window: BrowserWindow = {
    ...w,
    profileId: w.incognito ? w.profileId : tab.profileId,
    activeTabIds: { ...w.activeTabIds, [tab.profileId]: id },
  };
  const ui = s.windowUi[w.id];
  return {
    tabs: { ...s.tabs, [id]: nextTab },
    windows: { ...s.windows, [w.id]: window },
    ...(ui?.panel.open ? { windowUi: { ...s.windowUi, [w.id]: { ...ui, panel: { open: false, initialText: "" } } } } : {}),
  };
}

/** Applies a partial state to a copy, so helpers can be chained inside one `set`. */
export const apply = (s: BrowserState, patch: Partial<BrowserState>): BrowserState => ({ ...s, ...patch });

/**
 * Removes tabs everywhere they're referenced (windows, groups, splits, find
 * state) and picks a new active tab where needed. `record` pushes them onto the
 * Reopen Closed Tab stack. Windows left with no tabs at all are removed too
 * (callers that want a New Tab page instead add one first).
 */
export function removeTabs(s: BrowserState, ids: string[], record: boolean): BrowserState {
  const gone = new Set(ids.filter((id) => s.tabs[id]));
  if (gone.size === 0) return s;
  const now = Date.now();
  const closed: ClosedTab[] = [];
  let tabs = s.tabs;
  const windows = { ...s.windows };
  const removedWindows: string[] = [];

  for (const w of Object.values(s.windows)) {
    if (!w.tabIds.some((id) => gone.has(id))) continue;
    if (record) {
      w.tabIds.forEach((id, index) => {
        const t = s.tabs[id];
        if (!t || !gone.has(id) || (!t.url && !t.pinned)) return;
        const group = Object.values(s.groups).find((g) => g.tabIds.includes(id));
        closed.push({
          kind: "tab",
          id: newId("ct"),
          tab: snapshotTab(t),
          tabId: id,
          windowId: w.id,
          index,
          group: group ? { id: group.id, name: group.name, icon: group.icon, color: group.color } : null,
          closedAt: now,
        });
      });
    }
    const tabIds = w.tabIds.filter((id) => !gone.has(id));
    if (tabIds.length === 0) {
      removedWindows.push(w.id);
      delete windows[w.id];
      continue;
    }
    // Re-pick the active tab of every profile that lost it: the neighbour below, else above.
    const activeTabIds = { ...w.activeTabIds };
    for (const [profileId, activeId] of Object.entries(w.activeTabIds)) {
      if (!gone.has(activeId)) continue;
      const before = w.tabIds.filter((id) => s.tabs[id]?.profileId === profileId);
      const left = before.filter((id) => !gone.has(id));
      // A pinned tab the user unloaded is only picked when nothing else is left.
      const awake = left.filter((id) => !s.tabs[id]?.unloaded);
      const after = awake.length ? awake : left;
      const index = before.indexOf(activeId);
      const next = after.find((id) => before.indexOf(id) > index) ?? after.at(-1);
      if (next) activeTabIds[profileId] = next;
      else delete activeTabIds[profileId];
    }
    windows[w.id] = { ...w, tabIds, activeTabIds };
  }
  tabs = without(tabs, gone);

  let next: BrowserState = {
    ...s,
    tabs,
    windows,
    windowOrder: removedWindows.length ? s.windowOrder.filter((id) => !removedWindows.includes(id)) : s.windowOrder,
    windowUi: removedWindows.length ? without(s.windowUi, removedWindows) : s.windowUi,
    live: without(s.live, gone),
    find: without(s.find, gone),
    groups: leaveGroups(s.groups, gone),
    splits: removeFromSplits(s.splits, gone),
    selection: pruneSelection(s.selection, gone),
    closedTabs: closed.length ? [...s.closedTabs, ...closed].slice(-MAX_CLOSED_TABS) : s.closedTabs,
  };
  // Newly selected tabs that were restored lazily start loading now.
  for (const w of Object.values(next.windows)) {
    const id = w.activeTabIds[w.profileId];
    const t = id ? next.tabs[id] : undefined;
    if (t && t.url && !t.navigation && !t.adoptId) next = apply(next, activated(next, t.id));
  }
  return next;
}

/**
 * ⌘W on a pinned tab, after Dia (`closeFocusedContent` closes with `.deselectPinnedIfActive`):
 * the tile stays and only its page closes, so its browser and renderer go. The tile goes back
 * to its pinned URL (with that page's title and icon from history) and loads it when selected
 * again; ⇧⌘T instead brings back the page it showed, with its back/forward list. A tab of a
 * pinned group is in Dia's pinned container too: its row stays, unloaded on the page it showed
 * (it has no pinned URL). A window
 * showing it selects the regular tab it showed last (Dia's
 * `lastNonPinnedTabBeforePinnedSelection`), else a New Tab page. `ids` may include other tabs
 * being closed with it: those aren't picked.
 */
export function unloadPinnedTabs(s: BrowserState, ids: string[]): BrowserState {
  const closing = new Set(ids);
  const pinned = ids.filter((id) => inPinnedContainer(s, id));
  if (!pinned.length) return s;
  const gone = new Set(pinned);
  const now = Date.now();
  const tabs = { ...s.tabs };
  const live = { ...s.live };
  const closed: ClosedTab[] = [];
  for (const id of pinned) {
    const t = s.tabs[id]!;
    const w = s.windows[t.windowId];
    const loaded = !!(t.navigation || t.adoptId);
    if (loaded && t.url) {
      closed.push({ kind: "tab", id: newId("ct"), tab: snapshotTab(t), tabId: id, windowId: t.windowId, index: w?.tabIds.indexOf(id) ?? 0, group: null, closedAt: now, pinnedTile: true });
    }
    tabs[id] = { ...t, ...backToPin(s, t), navigation: null, adoptId: undefined, unloaded: true };
    live[id] = IDLE_LIVE;
  }
  let next: BrowserState = {
    ...s,
    tabs,
    live,
    find: without(s.find, gone),
    splits: removeFromSplits(s.splits, gone),
    selection: pruneSelection(s.selection, gone),
    closedTabs: closed.length ? [...s.closedTabs, ...closed].slice(-MAX_CLOSED_TABS) : s.closedTabs,
  };
  for (const w of Object.values(s.windows)) {
    for (const [profileId, activeId] of Object.entries(w.activeTabIds)) {
      if (!gone.has(activeId)) continue;
      const shown = profileId === w.profileId;
      let replacement = lastRegularTab(s, w, activeId, closing);
      if (!replacement) [next, replacement] = withNewTab(next, w.id, { profileId, background: !shown });
      if (shown) next = apply(next, activated(next, replacement));
      else {
        const win = next.windows[w.id]!;
        next = { ...next, windows: { ...next.windows, [w.id]: { ...win, activeTabIds: { ...win.activeTabIds, [profileId]: replacement } } } };
      }
    }
  }
  return next;
}

/** A pinned tab's pinned URL, title and icon, if it navigated away (history knows the page's title and icon). */
function backToPin(s: BrowserState, t: Tab): Partial<Tab> {
  const home = t.pinnedUrl;
  if (!home || !t.url || samePage(t.url, home)) return {};
  const entry = s.history[t.profileId]?.find((h) => samePage(h.url, home));
  return { ...onUrlChange(s, t, home), url: home, ...(entry ? { title: entry.title, favicon: entry.favicon ?? t.favicon } : {}) };
}

/** The regular tab a window selects when its pinned tab `id` unloads: a pane of its split, else the one used last. */
function lastRegularTab(s: BrowserState, w: BrowserWindow, id: string, closing: Set<string>): string | undefined {
  const profileId = s.tabs[id]!.profileId;
  const candidates = w.tabIds.filter((t) => !closing.has(t) && s.tabs[t]?.profileId === profileId && !inPinnedContainer(s, t));
  const panes = splitOf(s, id)?.tabIds.filter((t) => candidates.includes(t)) ?? [];
  const pool = panes.length ? panes : candidates;
  return pool.reduce<string | undefined>((best, t) => (!best || s.tabs[t]!.lastActiveAt > s.tabs[best]!.lastActiveAt ? t : best), undefined);
}

/** Adds a tab to a window (see NewTabOptions) and returns the new state + tab id. */
export function withNewTab(s: BrowserState, windowId: string, o: NewTabOptions = {}): [BrowserState, string] {
  const w = s.windows[windowId];
  if (!w) return [s, ""];
  const profileId = w.incognito ? w.profileId : o.profileId && s.profiles[o.profileId] ? o.profileId : w.profileId;
  const url = o.url ? resolveInput(o.url, searchUrlPrefix(s.settings)) : "";
  const tab = makeTab(windowId, profileId, url, { ...o.snapshot, pinned: o.pinned ?? o.snapshot?.pinned ?? false });
  // A fresh tab for a URL is the user's (or a link's) request; restored / duplicated ones aren't.
  if (tab.navigation && !o.snapshot) tab.navigation = navigationTo(url, true);
  tab.openerId = o.openerId ?? null;
  tab.pinnedUrl = tab.pinned ? tab.pinnedUrl || url || null : null;
  if (o.adoptId) {
    // The adopted browser is already loading `url`; loading it again would drop POST data / opener state.
    tab.adoptId = o.adoptId;
    tab.navigation = null;
  }
  const tabs = { ...s.tabs, [tab.id]: tab };
  const tabIds = [...w.tabIds];
  tabIds.splice(Math.min(o.index ?? insertionIndex(s, w, tab), tabIds.length), 0, tab.id);
  const window: BrowserWindow = {
    ...w,
    tabIds: pinnedFirst(tabIds, tabs),
    // A profile always has an active tab once it has tabs, even if this one opened in the background.
    activeTabIds: w.activeTabIds[profileId] ? w.activeTabIds : { ...w.activeTabIds, [profileId]: tab.id },
  };
  let next: BrowserState = {
    ...s,
    tabs,
    live: { ...s.live, [tab.id]: IDLE_LIVE },
    windows: { ...s.windows, [windowId]: window },
  };
  if (!o.background) next = apply(next, activated(next, tab.id));
  return [next, tab.id];
}

export const createTabsSlice: StateCreator<BrowserState, [], [], TabsSlice> = (set, get) => ({
  tabs: {},
  live: {},
  closedTabs: [],

  newTab(windowId, options) {
    if (options?.url && !options.adoptId && openOutsideTab(resolveInput(options.url, searchUrlPrefix(get().settings)), windowId)) return "";
    let [next, id] = withNewTab(get(), windowId, options);
    // ⌘-click on a link (a background tab with an opener): it joins its opener in a group.
    if (id && options?.openerId && options.background) next = groupWithOpener(next, id, options.openerId);
    set(next);
    return id;
  },

  closeTab(id) {
    const s = get();
    const tab = s.tabs[id];
    const w = tab && s.windows[tab.windowId];
    if (!tab || !w) return;
    if (inPinnedContainer(s, id)) return set(unloadPinnedTabs(s, [id]));
    // Last tab of the profile the window shows: the window closes (with all its profiles' tabs), like Dia.
    if (tab.profileId === w.profileId && viewTabIds(s, w.id).length === 1) return get().closeWindow(w.id);
    set(removeTabs(s, [id], true));
  },

  closeTabs(ids) {
    let s = unloadPinnedTabs(get(), ids);
    const closing = ids.filter((id) => !inPinnedContainer(s, id));
    // Keep the window: if its view would empty, leave a New Tab page.
    for (const w of Object.values(s.windows)) {
      const view = viewTabIds(s, w.id);
      if (view.length && view.every((id) => closing.includes(id))) s = withNewTab(s, w.id)[0];
    }
    set(removeTabs(s, closing, true));
  },

  activate(id) {
    set((s) => activated(s, id));
  },

  activateIndex(windowId, index) {
    const view = viewTabIds(get(), windowId);
    const id = index < 0 ? view.at(-1) : view[index];
    if (id) get().activate(id);
  },

  cycle(windowId, delta) {
    const s = get();
    const view = viewTabIds(s, windowId);
    const i = view.indexOf(s.windows[windowId]?.activeTabIds[s.windows[windowId]!.profileId] ?? "");
    if (view.length) get().activate(view[(i + delta + view.length) % view.length]!);
  },

  navigate(id, input, { userInitiated = true } = {}) {
    const s = get();
    const url = resolveInput(input, searchUrlPrefix(s.settings));
    const tab = s.tabs[id];
    if (!url || !tab) return;
    if (openOutsideTab(url, tab.windowId)) {
      if (get().windowUi[tab.windowId]?.panel.open) get().closePanel(tab.windowId);
      return;
    }
    // Setting `url` right away hides the New Tab page while the page loads.
    const { unloaded: _, ...rest } = tab;
    set(apply(s, { tabs: { ...s.tabs, [id]: { ...rest, navigation: navigationTo(url, userInitiated), url: tab.url || url } } }));
    const ui = get().windowUi[tab.windowId];
    if (ui?.panel.open) get().closePanel(tab.windowId);
  },

  updateTab(id, patch) {
    const tab = get().tabs[id];
    if (!tab) return;
    const url = patch.url;
    const next = merge(tab, url !== undefined && url !== tab.url ? { ...onUrlChange(get(), tab, url), ...patch } : patch);
    if (next !== tab) set((s) => ({ tabs: { ...s.tabs, [id]: next } }));
  },

  updateLive(id, patch) {
    const live = get().live[id];
    if (!live) return;
    const next = merge(live, patch);
    if (next !== live) set((s) => ({ live: { ...s.live, [id]: next } }));
  },

  duplicateTab(id) {
    const s = get();
    const source = s.tabs[id];
    if (!source) return undefined;
    const w = s.windows[source.windowId]!;
    const [next, copy] = withNewTab(s, w.id, {
      url: source.url || undefined,
      profileId: source.profileId,
      snapshot: { ...snapshotTab(source), pinned: false },
      index: w.tabIds.indexOf(id) + 1,
      // Chrome's Duplicate: the same back/forward list and session storage.
      adoptId: source.url ? `clone:${id}` : undefined,
    });
    set(next);
    return copy;
  },

  togglePin(id) {
    // Pinning appends to the pinned tiles (out of any group); unpinning puts it at the top of the list.
    const tab = get().tabs[id];
    if (tab) get().pinTabs([id], !tab.pinned);
  },

  moveTab(id, toIndex) {
    set((s) => {
      const tab = s.tabs[id];
      const w = tab && s.windows[tab.windowId];
      if (!tab || !w) return {};
      const inSection = (t: string) => s.tabs[t]?.profileId === tab.profileId && !!s.tabs[t]?.pinned === tab.pinned;
      const section = w.tabIds.filter(inSection);
      const moved = section.filter((t) => t !== id);
      moved.splice(Math.min(Math.max(toIndex, 0), moved.length), 0, id);
      // Refill the section's slots in the new order; other profiles' tabs stay put.
      let k = 0;
      const tabIds = w.tabIds.map((t) => (inSection(t) ? moved[k++]! : t));
      const window = { ...w, tabIds };
      return { windows: { ...s.windows, [w.id]: window }, groups: syncGroupOrder(s.groups, window) };
    });
  },
});
