import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import {
  findLast,
  IDLE_LIVE,
  incognitoProfileId,
  inPinnedContainer,
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
import { adoptParkedPins, parkWindowPins } from "./parkedPins";
import { activated, apply, removeTabs, withNewTab } from "./tabs";
import type { BrowserWindow, ClosedTab, ClosedWindow, Frame, ParkedPins, Tab, TabGroup } from "./types";

export type CreateWindowOptions = {
  profileId?: string;
  incognito?: boolean;
  url?: string;
  adoptId?: string;
  tabIds?: string[];
  frame?: Frame | null;
};

export type WindowsSlice = {
  windows: Record<string, BrowserWindow>;
  windowOrder: string[];
  closedWindows: ClosedWindow[];
  parkedPins: Record<string, ParkedPins>;

  createWindow(options?: CreateWindowOptions): string;
  closeWindow(id: string): void;
  setWindowFrame(id: string, frame: Frame): void;
  toggleSidebar(windowId: string): void;
  switchProfile(windowId: string, profileId: string): void;
  moveTabsToWindow(tabIds: string[], windowId: string | null): string | undefined;
  moveTabToProfile(tabId: string, profileId: string): void;
  mergeAllWindows(windowId: string): void;
  reopenClosed(windowId?: string | null): void;
  reopenClosedTab(windowId?: string | null): void;
  reopenClosedWindow(): void;
  restoreClosed(entryId: string, windowId?: string | null): void;
};

const MAX_CLOSED_WINDOWS = 10;

function emptyWindow(id: string, profileId: string, incognito: boolean, frame: Frame | null = null): BrowserWindow {
  return { id, profileId, incognito, tabIds: [], activeTabIds: {}, sidebarOpen: true, frame, createdAt: Date.now() };
}

function withWindow(s: BrowserState, w: BrowserWindow): BrowserState {
  return {
    ...s,
    windows: { ...s.windows, [w.id]: w },
    windowOrder: [...s.windowOrder, w.id],
    ui: { ...s.ui, focusedWindowId: w.id, focusOrder: [w.id, ...s.ui.focusOrder] },
  };
}

export function moveTabsInto(s: BrowserState, ids: string[], targetId: string): BrowserState {
  const target = s.windows[targetId];
  if (!target) return s;
  const moving = ids
    .map((id) => s.tabs[id])
    .filter((t): t is Tab => !!t && t.windowId !== targetId && !isIncognitoProfile(t.profileId) && !target.incognito);
  if (!moving.length) return s;

  const sources = new Set(moving.map((t) => t.windowId));
  let next = removeTabs(s, moving.map((t) => t.id), false);
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
  for (const id of sources) {
    const src = next.windows[id];
    if (!src || viewTabIds(next, id).length) continue;
    const recent = src.tabIds.map((t) => next.tabs[t]!).sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
    if (recent) next = apply(next, activated(next, src.activeTabIds[recent.profileId] ?? recent.id));
  }
  return next;
}

function restoreGroup(groups: Record<string, TabGroup>, g: Omit<TabGroup, "tabIds">, tabIds: string[]) {
  const id = groups[g.id] ? newId("g") : g.id;
  return { ...groups, [id]: { ...g, id, tabIds } };
}

export const createWindowsSlice: StateCreator<BrowserState, [], [], WindowsSlice> = (set, get) => ({
  windows: {},
  windowOrder: [],
  closedWindows: [],
  parkedPins: {},

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
    const first = next.windows[id]!.tabIds[0]!;
    const shown = next.windows[id]!.activeTabIds[next.tabs[first]!.profileId] ?? first;
    next = adoptParkedPins(next, id, next.tabs[shown]!.profileId);
    next = apply(next, activated(next, shown));
    set(next);
    return id;
  },

  closeWindow(id) {
    const s = get();
    const w = s.windows[id];
    if (!w) return;
    const tabs = w.tabIds.map((t) => s.tabs[t]).filter((t): t is Tab => !!t && !inPinnedContainer(s, t.id));
    const tabIds = tabs.map((t) => t.id);
    let closedWindows = s.closedWindows;
    if (!w.incognito && tabs.some((t) => t.url)) {
      const active = new Set(Object.values(w.activeTabIds));
      const entry: ClosedWindow = {
        kind: "window",
        id: newId("cw"),
        window: { profileId: w.profileId, sidebarOpen: w.sidebarOpen, frame: w.frame },
        tabs: tabs.map((t) => ({ ...snapshotTab(t), active: active.has(t.id) })),
        groups: Object.values(s.groups)
          .filter((g) => g.windowId === id && !g.pinned)
          .map(({ tabIds: members, windowId: _, ...g }) => ({ ...g, tabIndexes: members.map((t) => tabIds.indexOf(t)) })),
        closedAt: Date.now(),
      };
      closedWindows = [...closedWindows, entry].slice(-MAX_CLOSED_WINDOWS);
    }
    const next = removeTabs(s, w.tabIds, false);
    set({
      ...next,
      windows: without(next.windows, [id]),
      windowOrder: next.windowOrder.filter((w) => w !== id),
      windowUi: without(next.windowUi, [id]),
      closedWindows,
      parkedPins: parkWindowPins(s.parkedPins, w, s),
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
    s = adoptParkedPins(s, windowId, profileId);
    const remembered = w.activeTabIds[profileId];
    let target = remembered && s.tabs[remembered]?.windowId === windowId ? remembered : undefined;
    target ??= s.windows[windowId]!.tabIds.find((id) => s.tabs[id]?.profileId === profileId && !s.tabs[id]!.unloaded);
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
    let next = removeTabs(s, [tabId], false);
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
    const target = s.windows[windowId]?.incognito ? s.ui.focusOrder.find((id) => s.windows[id] && !s.windows[id]!.incognito) : windowId;
    if (!target) return;
    const others = s.windowOrder.filter((id) => id !== target && !s.windows[id]?.incognito);
    const tabIds = others.flatMap((id) => s.windows[id]!.tabIds);
    if (!tabIds.length) return;
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
    const closedGroup = s.closedGroups.find((c) => c.id === entryId) ?? s.deletedGroups.find((c) => c.id === entryId);
    if (closedGroup) set(restoringGroup(s, closedGroup, windowId));
  },
});

function canRestoreTabInto(s: BrowserState, c: ClosedTab, windowId: string | undefined): boolean {
  const w = windowId ? s.windows[windowId] : undefined;
  if (isIncognitoProfile(c.tab.profileId)) return c.windowId === windowId;
  return !w?.incognito;
}

function restoreTab(s: BrowserState, entry: ClosedTab, requested?: string | null): BrowserState {
  const owner = entry.tab.profileId;
  if (entry.pinnedTile && entry.tabId && !s.tabs[entry.tabId] && s.parkedPins[owner]?.tabs.some((p) => p.id === entry.tabId)) {
    const target = resolveWindowId(s, requested);
    let windowId = target && !s.windows[target]!.incognito && s.windows[target]!.profileId === owner ? target : undefined;
    let next = s;
    if (!windowId) {
      windowId = newId("w");
      next = withWindow(next, emptyWindow(windowId, owner, false));
    }
    next = adoptParkedPins(next, windowId, owner);
    if (next.tabs[entry.tabId]) return restoreTab(next, entry, windowId);
  }
  const closedTabs = s.closedTabs.filter((c) => c.id !== entry.id);
  const tile = entry.pinnedTile && entry.tabId ? s.tabs[entry.tabId] : undefined;
  if (tile) {
    const unloaded = !tile.navigation && !tile.adoptId;
    const tabs = unloaded
      ? { ...s.tabs, [tile.id]: { ...tile, url: entry.tab.url, title: entry.tab.title, favicon: entry.tab.favicon, muted: entry.tab.muted, adoptId: `restore:${tile.id}` } }
      : s.tabs;
    const next: BrowserState = { ...s, closedTabs, tabs };
    return apply(next, activated(next, tile.id));
  }
  const original = s.windows[entry.windowId];
  let windowId = original && canRestoreTabInto(s, entry, original.id) ? original.id : resolveWindowId(s, requested);
  let next: BrowserState = { ...s, closedTabs };
  if (!windowId || !canRestoreTabInto(s, entry, windowId)) {
    if (isIncognitoProfile(entry.tab.profileId)) return next;
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
  const shown = w.activeTabIds[w.profileId] ?? w.tabIds[0]!;
  next = adoptParkedPins(next, id, w.profileId);
  next = apply(next, activated(next, shown));
  return next;
}
