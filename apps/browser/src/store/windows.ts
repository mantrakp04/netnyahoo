import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import {
  findLast,
  IDLE_LIVE,
  incognitoProfileId,
  isIncognitoProfile,
  makeTab,
  navigationTo,
  newId,
  pinnedFirst,
  resolveWindowId,
  snapshotTab,
  viewTabIds,
  without,
} from "./model";
import { restoringGroup } from "./organize";
import { activated, apply, removeTabs, withNewTab } from "./tabs";
import type { BrowserWindow, ClosedTab, ClosedWindow, Frame, Tab, TabGroup } from "./types";

export type CreateWindowOptions = {
  /** Defaults to Settings › default profile. Ignored for incognito windows. */
  profileId?: string;
  incognito?: boolean;
  /** First tab's URL (typed input is resolved); omit for a New Tab page. */
  url?: string;
  /** Adopt a popup browser for the first tab (window.open with a new window keeps its opener). */
  adoptId?: string;
  /** Move these existing tabs into the new window instead of opening a New Tab page. */
  tabIds?: string[];
  frame?: Frame | null;
};

export type WindowsSlice = {
  windows: Record<string, BrowserWindow>;
  /** Creation order (the order of Window › Move to Window). */
  windowOrder: string[];
  closedWindows: ClosedWindow[];

  /** Adds a window to the store; lib/nativeWindows opens the NSWindow for it. */
  createWindow(options?: CreateWindowOptions): string;
  /** Removes a window and its tabs (recorded for Reopen Closed Window unless incognito). */
  closeWindow(id: string): void;
  setWindowFrame(id: string, frame: Frame): void;
  /** ⌘S Auto-Hide Tabs. */
  toggleSidebar(windowId: string): void;
  /** Shows another profile's tabs in the window (a New Tab page if it has none there). */
  switchProfile(windowId: string, profileId: string): void;
  /** Moves tabs to another window (their web views reload there). Returns the target window id. */
  moveTabsToWindow(tabIds: string[], windowId: string | null): string | undefined;
  /** Moves a tab to another profile in the same window; it reloads in that profile. */
  moveTabToProfile(tabId: string, profileId: string): void;
  /** Merges every regular window into `windowId` (Window › Merge All Windows). */
  mergeAllWindows(windowId: string): void;
  /** ⇧⌘T: whichever closed most recently, a tab or a window. */
  reopenClosed(windowId?: string | null): void;
  reopenClosedTab(windowId?: string | null): void;
  reopenClosedWindow(): void;
  /** Restores one entry of the closed-tab or closed-window stack. */
  restoreClosed(entryId: string, windowId?: string | null): void;
};

const MAX_CLOSED_WINDOWS = 10;

function emptyWindow(id: string, profileId: string, incognito: boolean, frame: Frame | null = null): BrowserWindow {
  return { id, profileId, incognito, tabIds: [], activeTabIds: {}, sidebarOpen: true, frame, createdAt: Date.now() };
}

/** Adds a window record (with no tabs yet) and makes it the focused one. */
function withWindow(s: BrowserState, w: BrowserWindow): BrowserState {
  return {
    ...s,
    windows: { ...s.windows, [w.id]: w },
    windowOrder: [...s.windowOrder, w.id],
    ui: { ...s.ui, focusedWindowId: w.id, focusOrder: [w.id, ...s.ui.focusOrder] },
  };
}

/**
 * Detaches tabs from their windows and appends them to `targetId`. The tabs
 * keep their ids and profile; loaded ones reload (a web view can't move between
 * windows). Incognito tabs never move: their profile is tied to their window.
 */
export function moveTabsInto(s: BrowserState, ids: string[], targetId: string): BrowserState {
  const target = s.windows[targetId];
  if (!target) return s;
  const moving = ids
    .map((id) => s.tabs[id])
    .filter((t): t is Tab => !!t && t.windowId !== targetId && !isIncognitoProfile(t.profileId) && !target.incognito);
  if (!moving.length) return s;

  const sources = new Set(moving.map((t) => t.windowId));
  let next = removeTabs(s, moving.map((t) => t.id), false);
  // removeTabs drops a target that only held these tabs; it can't here (they come from other windows).
  const w = next.windows[targetId]!;
  const tabs = { ...next.tabs };
  const live = { ...next.live };
  const activeTabIds = { ...w.activeTabIds };
  for (const { adoptId, ...t } of moving) {
    const loaded = !!t.url && (!!t.navigation || !!adoptId);
    tabs[t.id] = { ...t, windowId: targetId, navigation: loaded ? navigationTo(t.url) : null };
    live[t.id] = IDLE_LIVE;
    activeTabIds[t.profileId] ??= t.id;
  }
  next = {
    ...next,
    tabs,
    live,
    windows: { ...next.windows, [targetId]: { ...w, tabIds: pinnedFirst([...w.tabIds, ...moving.map((t) => t.id)], tabs), activeTabIds } },
  };
  // A source window whose current profile ran out of tabs shows its most recently used remaining profile.
  for (const id of sources) {
    const src = next.windows[id];
    if (!src || viewTabIds(next, id).length) continue;
    const recent = src.tabIds.map((t) => next.tabs[t]!).sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
    if (recent) next = apply(next, activated(next, src.activeTabIds[recent.profileId] ?? recent.id));
  }
  return next;
}

/** Recreates a group (same id if free) around restored tabs. */
function restoreGroup(groups: Record<string, TabGroup>, g: Omit<TabGroup, "tabIds">, tabIds: string[]) {
  const id = groups[g.id] ? newId("g") : g.id;
  return { ...groups, [id]: { ...g, id, tabIds } };
}

export const createWindowsSlice: StateCreator<BrowserState, [], [], WindowsSlice> = (set, get) => ({
  windows: {},
  windowOrder: [],
  closedWindows: [],

  createWindow(o = {}) {
    const s = get();
    const id = newId("w");
    const profileId = o.incognito
      ? incognitoProfileId(id)
      : o.profileId && s.profiles[o.profileId]
        ? o.profileId
        : s.settings.defaultProfileId;
    let next = withWindow(s, emptyWindow(id, profileId, !!o.incognito, o.frame ?? null));
    if (o.tabIds?.length) next = moveTabsInto(next, o.tabIds, id);
    if (!next.windows[id]!.tabIds.length) next = withNewTab(next, id, { url: o.url, adoptId: o.adoptId })[0];
    // Show the moved-in tabs' profile.
    const first = next.windows[id]!.tabIds[0]!;
    next = apply(next, activated(next, next.windows[id]!.activeTabIds[next.tabs[first]!.profileId] ?? first));
    set(next);
    return id;
  },

  closeWindow(id) {
    const s = get();
    const w = s.windows[id];
    if (!w) return;
    const tabs = w.tabIds.map((t) => s.tabs[t]).filter((t): t is Tab => !!t);
    let closedWindows = s.closedWindows;
    if (!w.incognito && tabs.some((t) => t.url)) {
      const active = new Set(Object.values(w.activeTabIds));
      const entry: ClosedWindow = {
        kind: "window",
        id: newId("cw"),
        window: { profileId: w.profileId, sidebarOpen: w.sidebarOpen, frame: w.frame },
        tabs: tabs.map((t) => ({ ...snapshotTab(t), active: active.has(t.id) })),
        groups: Object.values(s.groups)
          .filter((g) => g.windowId === id)
          .map(({ tabIds, windowId: _, ...g }) => ({ ...g, tabIndexes: tabIds.map((t) => w.tabIds.indexOf(t)) })),
        closedAt: Date.now(),
      };
      closedWindows = [...closedWindows, entry].slice(-MAX_CLOSED_WINDOWS);
    }
    const next = removeTabs(s, w.tabIds, false);
    set({
      ...next,
      // removeTabs drops the (now empty) window; make sure of it even if it had no tabs.
      windows: without(next.windows, [id]),
      windowOrder: next.windowOrder.filter((w) => w !== id),
      windowUi: without(next.windowUi, [id]),
      closedWindows,
      // An incognito window's closed tabs go with it.
      closedTabs: w.incognito ? next.closedTabs.filter((c) => c.windowId !== id) : next.closedTabs,
      ui: {
        ...next.ui,
        focusOrder: next.ui.focusOrder.filter((f) => f !== id),
        focusedWindowId: next.ui.focusedWindowId === id ? (next.ui.focusOrder.find((f) => f !== id) ?? null) : next.ui.focusedWindowId,
      },
    });
  },

  setWindowFrame(id, frame) {
    set((s) => {
      const w = s.windows[id];
      if (!w || (w.frame && w.frame.every((v, i) => v === frame[i]))) return {};
      return { windows: { ...s.windows, [id]: { ...w, frame } } };
    });
  },

  toggleSidebar(windowId) {
    set((s) => {
      const w = s.windows[windowId];
      return w ? { windows: { ...s.windows, [windowId]: { ...w, sidebarOpen: !w.sidebarOpen } } } : {};
    });
  },

  switchProfile(windowId, profileId) {
    let s = get();
    const w = s.windows[windowId];
    if (!w || w.incognito || !s.profiles[profileId] || w.profileId === profileId) return;
    const remembered = w.activeTabIds[profileId];
    let target = remembered && s.tabs[remembered]?.windowId === windowId ? remembered : undefined;
    target ??= w.tabIds.find((id) => s.tabs[id]?.profileId === profileId);
    if (!target) [s, target] = withNewTab(s, windowId, { profileId, background: true });
    set(apply(s, activated(s, target)));
  },

  moveTabsToWindow(tabIds, windowId) {
    const s = get();
    if (windowId === null) {
      const first = s.tabs[tabIds[0] ?? ""];
      if (!first || isIncognitoProfile(first.profileId)) return undefined;
      return get().createWindow({ profileId: first.profileId, tabIds });
    }
    let next = moveTabsInto(s, tabIds, windowId);
    const last = findLast(tabIds, (id) => next.tabs[id]?.windowId === windowId);
    if (last) next = apply(next, activated(next, last));
    set(next);
    return windowId;
  },

  moveTabToProfile(tabId, profileId) {
    const s = get();
    const tab = s.tabs[tabId];
    const w = tab && s.windows[tab.windowId];
    if (!tab || !w || w.incognito || !s.profiles[profileId] || tab.profileId === profileId) return;
    // Out of its old profile's groups and splits, then back in as the new profile's tab.
    let next = removeTabs(s, [tabId], false);
    // removeTabs may have dropped the window if this was its only tab; put the record back.
    const base = next.windows[w.id] ?? { ...w, tabIds: [], activeTabIds: {} };
    const loaded = !!tab.url && (!!tab.navigation || !!tab.adoptId);
    const { adoptId: _, ...rest } = tab;
    const moved: Tab = { ...rest, profileId, navigation: loaded ? navigationTo(tab.url) : null, lastActiveAt: Date.now() };
    const tabs = { ...next.tabs, [tabId]: moved };
    const index = Math.min(w.tabIds.indexOf(tabId), base.tabIds.length);
    const tabIds = [...base.tabIds];
    tabIds.splice(index, 0, tabId);
    next = {
      ...next,
      tabs,
      live: { ...next.live, [tabId]: IDLE_LIVE },
      windows: { ...next.windows, [w.id]: { ...base, tabIds: pinnedFirst(tabIds, tabs) } },
      windowOrder: next.windowOrder.includes(w.id) ? next.windowOrder : s.windowOrder,
    };
    set(apply(next, activated(next, tabId)));
  },

  mergeAllWindows(windowId) {
    const s = get();
    // Incognito windows can't take other profiles' tabs; merge into the most recent regular window.
    const target = s.windows[windowId]?.incognito ? s.ui.focusOrder.find((id) => s.windows[id] && !s.windows[id]!.incognito) : windowId;
    if (!target) return;
    const others = s.windowOrder.filter((id) => id !== target && !s.windows[id]?.incognito);
    const tabIds = others.flatMap((id) => s.windows[id]!.tabIds);
    if (!tabIds.length) return;
    // Moved groups stay groups in their new window.
    let next = moveTabsInto(s, tabIds, target);
    const groups = { ...s.groups };
    for (const g of Object.values(s.groups)) if (others.includes(g.windowId)) groups[g.id] = { ...g, windowId: target };
    next = { ...next, groups };
    set(next);
  },

  reopenClosed(windowId) {
    const s = get();
    const target = resolveWindowId(s, windowId);
    const lastTab = findLast(s.closedTabs, (c) => canRestoreTabInto(s, c, target));
    const lastWindow = s.windows[target ?? ""]?.incognito ? undefined : s.closedWindows.at(-1);
    const lastGroup = s.windows[target ?? ""]?.incognito ? undefined : s.closedGroups.at(-1);
    // Ties go to the window (its tabs were recorded as it closed).
    const entry = [lastWindow, lastGroup, lastTab].reduce<{ id: string; closedAt: number } | undefined>(
      (latest, e) => (e && (!latest || e.closedAt > latest.closedAt) ? e : latest),
      undefined,
    );
    if (entry) get().restoreClosed(entry.id, target);
  },

  reopenClosedTab(windowId) {
    const s = get();
    const target = resolveWindowId(s, windowId);
    const entry = findLast(s.closedTabs, (c) => canRestoreTabInto(s, c, target));
    if (entry) get().restoreClosed(entry.id, target);
  },

  reopenClosedWindow() {
    const entry = get().closedWindows.at(-1);
    if (entry) get().restoreClosed(entry.id);
  },

  restoreClosed(entryId, windowId) {
    const s = get();
    const closedTab = s.closedTabs.find((c) => c.id === entryId);
    if (closedTab) return set(restoreTab(s, closedTab, windowId));
    const closedWindow = s.closedWindows.find((c) => c.id === entryId);
    if (closedWindow) return set(restoreWindow(s, closedWindow));
    const closedGroup = s.closedGroups.find((c) => c.id === entryId);
    if (closedGroup) set(restoringGroup(s, closedGroup, windowId));
  },
});

/** Incognito tabs only go back into their own window; regular tabs never into an incognito one. */
function canRestoreTabInto(s: BrowserState, c: ClosedTab, windowId: string | undefined): boolean {
  const w = windowId ? s.windows[windowId] : undefined;
  if (isIncognitoProfile(c.tab.profileId)) return c.windowId === windowId;
  return !w?.incognito;
}

function restoreTab(s: BrowserState, entry: ClosedTab, requested?: string | null): BrowserState {
  const closedTabs = s.closedTabs.filter((c) => c.id !== entry.id);
  const original = s.windows[entry.windowId];
  let windowId = original && canRestoreTabInto(s, entry, original.id) ? original.id : resolveWindowId(s, requested);
  let next: BrowserState = { ...s, closedTabs };
  if (!windowId || !canRestoreTabInto(s, entry, windowId)) {
    if (isIncognitoProfile(entry.tab.profileId)) return next;
    // No window to restore into: open one for it.
    windowId = newId("w");
    next = withWindow(next, emptyWindow(windowId, s.profiles[entry.tab.profileId] ? entry.tab.profileId : s.settings.defaultProfileId, false));
  }
  const w = next.windows[windowId]!;
  const profileId = isIncognitoProfile(entry.tab.profileId) || s.profiles[entry.tab.profileId] ? entry.tab.profileId : w.profileId;
  const [withTab, tabId] = withNewTab(next, windowId, {
    url: entry.tab.url || undefined,
    profileId,
    snapshot: entry.tab,
    index: w.id === entry.windowId ? entry.index : undefined,
    // With its back/forward list, if the engine still has it.
    adoptId: entry.tabId && entry.tab.url ? `restore:${entry.tabId}` : undefined,
  });
  next = withTab;
  const g = entry.group;
  if (g) {
    const existing = next.groups[g.id];
    if (existing && existing.windowId === windowId && existing.profileId === profileId) {
      next = { ...next, groups: { ...next.groups, [g.id]: { ...existing, tabIds: [...existing.tabIds, tabId] } } };
    } else if (!existing) {
      next = { ...next, groups: restoreGroup(next.groups, { ...g, windowId, profileId, collapsed: false, pinned: false, createdAt: Date.now() }, [tabId]) };
    }
  }
  return next;
}

function restoreWindow(s: BrowserState, entry: ClosedWindow): BrowserState {
  const id = newId("w");
  const profileOk = (p: string) => (s.profiles[p] ? p : s.settings.defaultProfileId);
  const w = emptyWindow(id, profileOk(entry.window.profileId), false, entry.window.frame);
  w.sidebarOpen = entry.window.sidebarOpen;
  const tabs = { ...s.tabs };
  const live = { ...s.live };
  const ids: string[] = [];
  for (const { active, ...snap } of entry.tabs) {
    // Restored tabs load when first selected, like a relaunch.
    const t = makeTab(id, profileOk(snap.profileId), "", { ...snap, profileId: profileOk(snap.profileId) });
    tabs[t.id] = t;
    live[t.id] = IDLE_LIVE;
    ids.push(t.id);
    if (active || !w.activeTabIds[t.profileId]) w.activeTabIds[t.profileId] = t.id;
  }
  w.tabIds = pinnedFirst(ids, tabs);
  let groups = s.groups;
  for (const { tabIndexes, ...g } of entry.groups) {
    const members = tabIndexes.map((i) => ids[i]).filter((t): t is string => !!t);
    if (members.length) groups = restoreGroup(groups, { ...g, windowId: id }, members);
  }
  let next = withWindow({ ...s, tabs, live, groups, closedWindows: s.closedWindows.filter((c) => c.id !== entry.id) }, w);
  if (!w.activeTabIds[w.profileId]) w.activeTabIds[w.profileId] = w.tabIds[0]!;
  next = apply(next, activated(next, w.activeTabIds[w.profileId]!));
  return next;
}
