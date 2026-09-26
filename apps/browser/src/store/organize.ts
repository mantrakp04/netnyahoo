import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { leaveGroups, orderSections, placeBlock, syncGroupOrder } from "./groups";
import { activeTabId, bookmarkProfileId, newId, snapshotTab, viewTabIds } from "./model";
import { activated, apply, removeTabs, withNewTab } from "./tabs";
import type { BrowserWindow, ClosedGroup, ClosedTab, Tab, TabGroup } from "./types";

/**
 * Organising tabs in the sidebar, after Dia: multi-selection, drag-and-drop
 * placement, pinned tabs' base URLs, site muting, group operations (pin,
 * duplicate, close to Recently Closed Groups, Move to Bookmark Bar), ⌘-click
 * groups, and Clean Up Tabs. Pure helpers are exported for the other slices.
 */
export type TabPlacement = {
  /** Pinned tiles, or the list. */
  pinned: boolean;
  /** Insert before this tab (window order); omitted/null = end of the section, or of `groupId`. */
  beforeId?: string | null;
  /** Join this group (list only); omitted/null = out of any group. */
  groupId?: string | null;
};

export type GroupPlacement = { pinned: boolean; beforeId?: string | null };

export type OrganizeSlice = {
  /** Sidebar multi-selection per window (⌘-click / ⇧-click); empty = just the active tab. */
  selection: Record<string, string[]>;
  /** Clean Up Tabs' "Recently Cleaned" (oldest first); restorable. */
  cleanedTabs: ClosedTab[];
  /** History › Recently Closed Groups (oldest first). */
  closedGroups: ClosedGroup[];
  /** Groups deleted with Delete Group (Dia's soft delete): restorable for a week, oldest first. */
  deletedGroups: ClosedGroup[];

  setSelection(windowId: string, ids: string[]): void;
  /** Drag-and-drop / Move: pins or unpins, reorders and (un)groups tabs of one window. */
  placeTabs(ids: string[], placement: TabPlacement): void;
  pinTabs(ids: string[], pinned: boolean): void;
  /** ⌘↩ / Back to Pinned URL / Reset Pinned Tab. */
  returnToPinnedUrl(tabId: string): void;
  /** Replace Pin with Current Page (no `url`) / Edit Pinned Page… */
  setPinnedUrl(tabId: string, url?: string): void;
  setMuted(ids: string[], muted: boolean): void;
  /** Mute Site: every tab of the site in that profile, now and when they navigate there later. */
  setSiteMuted(tabId: string, muted: boolean): void;

  /** New Group with Tab(s) (⌃⌘N). Dia pins groups made on purpose. Returns the group id or "". */
  groupTabs(ids: string[], options?: { pinned?: boolean; name?: string }): string;
  moveGroup(groupId: string, placement: GroupPlacement): void;
  duplicateGroup(groupId: string): string;
  /** ⌥⌘T: a New Tab page at the end of the group. */
  newTabInGroup(groupId: string): string;
  /** Closes the group into a Bookmarks Bar folder. */
  moveGroupToBookmarksBar(groupId: string): void;

  /** ⌥⌘K: closes duplicate and unused tabs into Recently Cleaned. Returns how many. */
  cleanUpTabs(windowId: string, options?: { inactiveForMs?: number }): number;
  /** Restores one cleaned tab, or all of them. */
  restoreCleaned(entryId?: string): void;
  /** New Tab pages you've moved away from (Dia clears them when you switch apps or lock the screen). */
  closeAbandonedNewTabs(): void;
};

/** Clean Up Tabs' default "haven't been touched in a while". */
export const CLEAN_UP_AFTER_MS = 12 * 60 * 60 * 1000;
const MAX_CLEANED = 100;
const MAX_CLOSED_GROUPS = 20;
/** Dia keeps deleted groups for 7 days (`cleanupSoftDeletedGroupsOlderThan`, run as its tab store loads). */
export const DELETED_GROUP_MS = 7 * 86_400_000;
/** Deleted groups still within their week. */
export const keptDeletedGroups = (list: ClosedGroup[], now = Date.now()) => list.filter((c) => now - c.closedAt < DELETED_GROUP_MS);

export const groupOf = (s: Pick<BrowserState, "groups">, tabId: string | undefined): TabGroup | undefined =>
  tabId ? Object.values(s.groups).find((g) => g.tabIds.includes(tabId)) : undefined;

/** The tabs a sidebar action applies to: the selection, else the active tab. */
export function selectedTabIds(s: BrowserState, windowId: string): string[] {
  const view = viewTabIds(s, windowId);
  const selected = (s.selection[windowId] ?? []).filter((id) => view.includes(id));
  if (selected.length) return view.filter((id) => selected.includes(id));
  const active = activeTabId(s, windowId);
  return active ? [active] : [];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Same page, ignoring the fragment and a trailing slash. */
export function samePage(a: string, b: string): boolean {
  const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");
  return norm(a) === norm(b);
}

/** A pinned tab that has navigated away from its base URL (Dia's pinned-tab badge). */
export const awayFromPin = (t: Pick<Tab, "pinned" | "url" | "pinnedUrl">) =>
  t.pinned && !!t.pinnedUrl && !!t.url && !samePage(t.url, t.pinnedUrl);

/** Shown for groups without a name: the first tab's site. */
export function groupLabel(s: Pick<BrowserState, "tabs">, g: TabGroup): string {
  if (g.name) return g.name;
  const first = s.tabs[g.tabIds[0] ?? ""];
  return (first && hostOf(first.url)) || "New Group";
}

/** What changes on a tab when its URL does: site mute follows it, and a new pin adopts its first URL. */
export function onUrlChange(s: BrowserState, tab: Tab, url: string): Partial<Tab> {
  const patch: Partial<Tab> = {};
  const muted = s.settings.mutedSites ?? [];
  const before = hostOf(tab.url);
  const after = hostOf(url);
  if (before !== after) {
    if (muted.includes(after)) patch.muted = true;
    else if (muted.includes(before)) patch.muted = false;
  }
  if (tab.pinned && !tab.pinnedUrl && url) patch.pinnedUrl = url;
  return patch;
}

/** Drops closed tabs from the multi-selection. */
export function pruneSelection(selection: Record<string, string[]>, gone: Set<string>): Record<string, string[]> {
  if (!Object.values(selection).some((ids) => ids.some((id) => gone.has(id)))) return selection;
  return Object.fromEntries(Object.entries(selection).map(([w, ids]) => [w, ids.filter((id) => !gone.has(id))]));
}

/**
 * ⌘-click (Dia 1.16): a link opened in the background from a tab lands in a
 * group with its opener — the opener's group, or a new one that ungroups itself
 * when only one tab is left. Pinned openers just get a background tab.
 */
export function groupWithOpener(s: BrowserState, tabId: string, openerId: string): BrowserState {
  const tab = s.tabs[tabId];
  const opener = s.tabs[openerId];
  if (!s.settings.cmdClickCreatesTabGroup || !tab || !opener || opener.pinned) return s;
  if (opener.windowId !== tab.windowId || opener.profileId !== tab.profileId) return s;
  const w = s.windows[tab.windowId]!;
  const existing = groupOf(s, openerId);
  if (existing) {
    const members = [...existing.tabIds, tabId];
    const window = { ...w, tabIds: placeBlock(w.tabIds, w.tabIds.filter((id) => members.includes(id))) };
    const groups = { ...s.groups, [existing.id]: { ...existing, tabIds: window.tabIds.filter((id) => members.includes(id)) } };
    return { ...s, groups, windows: { ...s.windows, [w.id]: window } };
  }
  return withGroup(s, [openerId, tabId], { autoUngroup: true })[0];
}

/** Makes a group of tabs of one window (gathered at the first one's position). */
export function withGroup(
  s: BrowserState,
  ids: string[],
  o: { name?: string; pinned?: boolean; autoUngroup?: boolean } = {},
): [BrowserState, string] {
  const tabs = ids.map((id) => s.tabs[id]).filter((t): t is Tab => !!t && !t.pinned);
  const first = tabs[0];
  if (!first || tabs.some((t) => t.windowId !== first.windowId || t.profileId !== first.profileId)) return [s, ""];
  const w = s.windows[first.windowId]!;
  const members = new Set(tabs.map((t) => t.id));
  let tabIds = placeBlock(w.tabIds, w.tabIds.filter((id) => members.has(id)));
  const group: TabGroup = {
    id: newId("g"),
    windowId: w.id,
    profileId: first.profileId,
    name: o.name ?? "",
    icon: null,
    color: null,
    collapsed: false,
    pinned: !!o.pinned,
    tabIds: tabIds.filter((id) => members.has(id)),
    createdAt: Date.now(),
    ...(o.autoUngroup ? { autoUngroup: true } : {}),
  };
  const groups = { ...leaveGroups(s.groups, members), [group.id]: group };
  tabIds = orderSections(tabIds, s.tabs, groups);
  const window = { ...w, tabIds };
  return [{ ...s, groups: syncGroupOrder(groups, window), windows: { ...s.windows, [w.id]: window } }, group.id];
}

/** Recently-closed records for tabs about to be removed (like removeTabs' own). */
function closedEntries(s: BrowserState, ids: string[]): ClosedTab[] {
  const now = Date.now();
  return ids
    .map((id) => s.tabs[id])
    .filter((t): t is Tab => !!t && !!t.url)
    .map((t) => {
      const group = groupOf(s, t.id);
      return {
        kind: "tab" as const,
        id: newId("ct"),
        tab: snapshotTab(t),
        windowId: t.windowId,
        index: s.windows[t.windowId]?.tabIds.indexOf(t.id) ?? 0,
        group: group ? { id: group.id, name: group.name, icon: group.icon, color: group.color } : null,
        closedAt: now,
      };
    });
}

/** Removes tabs without touching Reopen Closed Tab, keeping a New Tab page where a view would empty. */
function closeQuietly(s: BrowserState, ids: string[]): BrowserState {
  for (const w of Object.values(s.windows)) {
    const view = viewTabIds(s, w.id);
    if (view.length && view.every((id) => ids.includes(id))) s = withNewTab(s, w.id)[0];
  }
  return removeTabs(s, ids, false);
}

/**
 * A group closed with its tabs, recorded for History › Recently Closed Groups; or, with `deleted`,
 * Dia's Delete: the tabs go without a Reopen Closed Tab record, and the group is kept for a week
 * under Recently Deleted Groups.
 */
export function closingGroup(s: BrowserState, groupId: string, deleted = false): BrowserState {
  const g = s.groups[groupId];
  const w = g && s.windows[g.windowId];
  if (!g || !w) return s;
  const entry: ClosedGroup = {
    kind: "group",
    id: newId("cg"),
    group: { id: g.id, name: groupLabel(s, g), icon: g.icon, color: g.color, pinned: g.pinned },
    tabs: g.tabIds.map((id) => snapshotTab(s.tabs[id]!)),
    windowId: w.id,
    index: w.tabIds.indexOf(g.tabIds[0]!),
    closedAt: Date.now(),
  };
  const recordable = !w.incognito && entry.tabs.some((t) => t.url);
  const next = closeQuietly(s, g.tabIds);
  if (!recordable) return next;
  if (deleted) return { ...next, deletedGroups: [...keptDeletedGroups(next.deletedGroups), entry] };
  return { ...next, closedGroups: [...next.closedGroups, entry].slice(-MAX_CLOSED_GROUPS) };
}

/** Puts tabs back from snapshots (loading), optionally as a group. Returns the new tab ids. */
function restoreSnapshots(
  s: BrowserState,
  windowId: string,
  entries: { tab: ClosedTab["tab"]; index?: number }[],
): [BrowserState, string[]] {
  const ids: string[] = [];
  const w = s.windows[windowId]!;
  for (const e of entries) {
    const profileId = s.profiles[e.tab.profileId] || w.incognito ? e.tab.profileId : w.profileId;
    const [next, id] = withNewTab(s, windowId, {
      url: e.tab.url || undefined,
      profileId,
      snapshot: e.tab,
      index: e.index,
      background: true,
    });
    s = next;
    ids.push(id);
  }
  return [s, ids];
}

/** The window to restore into: the original if it's still open (and compatible), else the focused one. */
function restoreTarget(s: BrowserState, original: string, requested?: string | null): string | undefined {
  const ok = (id: string | null | undefined) => !!id && !!s.windows[id] && !s.windows[id]!.incognito;
  if (ok(original)) return original;
  if (ok(requested)) return requested!;
  return s.ui.focusOrder.find((id) => ok(id)) ?? s.windowOrder.find((id) => ok(id));
}

/** Restores a closed group (History › Recently Closed Groups) and selects its first tab. */
export function restoringGroup(s: BrowserState, entry: ClosedGroup, requested?: string | null): BrowserState {
  const windowId = restoreTarget(s, entry.windowId, requested);
  if (!windowId) return s;
  let next: BrowserState = {
    ...s,
    closedGroups: s.closedGroups.filter((c) => c.id !== entry.id),
    deletedGroups: s.deletedGroups.filter((c) => c.id !== entry.id),
  };
  const index = windowId === entry.windowId ? entry.index : undefined;
  const [restored, ids] = restoreSnapshots(
    next,
    windowId,
    entry.tabs.map((tab, i) => ({ tab: { ...tab, pinned: false }, index: index === undefined ? undefined : index + i })),
  );
  next = restored;
  const [grouped, groupId] = withGroup(next, ids, { name: entry.group.name, pinned: entry.group.pinned });
  next = grouped;
  if (groupId && next.groups[groupId]) {
    next = { ...next, groups: { ...next.groups, [groupId]: { ...next.groups[groupId]!, icon: entry.group.icon, color: entry.group.color } } };
  }
  return ids[0] ? apply(next, activated(next, ids[0])) : next;
}

/** Tabs Clean Up Tabs would close in a window: duplicates, and untouched tabs outside groups. */
export function cleanUpCandidates(s: BrowserState, windowId: string, inactiveForMs = CLEAN_UP_AFTER_MS, now = Date.now()): string[] {
  const view = viewTabIds(s, windowId);
  const active = activeTabId(s, windowId);
  const grouped = new Set(Object.values(s.groups).flatMap((g) => g.tabIds));
  const inSplit = new Set(Object.values(s.splits).flatMap((v) => v.tabIds));
  const keep = (t: Tab) => t.id === active || t.pinned || s.live[t.id]?.playingAudio;
  const out = new Set<string>();
  // Duplicates: keep pinned ones, the active one, else the most recently used.
  const byPage = new Map<string, Tab[]>();
  for (const id of view) {
    const t = s.tabs[id]!;
    if (!t.url) continue;
    const key = t.url.replace(/#.*$/, "");
    byPage.set(key, [...(byPage.get(key) ?? []), t]);
  }
  for (const same of byPage.values()) {
    if (same.length < 2) continue;
    const keeper = same.find((t) => t.pinned) ?? same.find((t) => t.id === active) ?? [...same].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]!;
    for (const t of same) if (t !== keeper && !keep(t) && !inSplit.has(t.id)) out.add(t.id);
  }
  // Unused: untouched for a while, not in a group or split.
  for (const id of view) {
    const t = s.tabs[id]!;
    if (keep(t) || grouped.has(id) || inSplit.has(id)) continue;
    if (now - t.lastActiveAt >= inactiveForMs) out.add(id);
  }
  return view.filter((id) => out.has(id));
}

/**
 * New Tab pages in a window that the user has moved away from: not the one the
 * window shows, nor any profile's selected tab there. Never all of a window's
 * tabs (the window must survive), and pinned New Tab pages stay.
 */
export function abandonedNewTabs(s: BrowserState, windowId: string): string[] {
  const w = s.windows[windowId];
  if (!w) return [];
  const selected = new Set(Object.values(w.activeTabIds));
  const shown = w.activeTabIds[w.profileId];
  const out = w.tabIds.filter((id) => {
    const t = s.tabs[id];
    return !!t && t.windowId === w.id && !t.url && !t.navigation && !t.adoptId && !t.pinned && id !== shown && !selected.has(id);
  });
  return out.length >= w.tabIds.length ? out.slice(0, w.tabIds.length - 1) : out;
}

/** Most recently used first, for the ⌃Tab switcher; tabs untouched for a while are left out. */
export function recentTabIds(s: BrowserState, windowId: string, now = Date.now(), staleAfterMs = CLEAN_UP_AFTER_MS): string[] {
  const view = viewTabIds(s, windowId).map((id) => s.tabs[id]!);
  const sorted = view.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return sorted.filter((t, i) => i < 2 || now - t.lastActiveAt < staleAfterMs).map((t) => t.id);
}

/** Moves tabs of one window per `p` (see placeTabs). */
export function placing(s: BrowserState, ids: string[], p: TabPlacement): BrowserState {
  const first = s.tabs[ids[0] ?? ""];
  const w = first && s.windows[first.windowId];
  if (!first || !w) return s;
  const order = new Map(w.tabIds.map((id, i) => [id, i]));
  const moving = [...new Set(ids)]
    .filter((id) => s.tabs[id]?.windowId === w.id && s.tabs[id]?.profileId === first.profileId)
    .sort((a, b) => order.get(a)! - order.get(b)!);
  if (!moving.length) return s;
  const target = !p.pinned && p.groupId ? s.groups[p.groupId] : undefined;
  if (target && (target.windowId !== w.id || target.profileId !== first.profileId)) return s;
  const movingSet = new Set(moving);

  const tabs = { ...s.tabs };
  for (const id of moving) {
    const t = tabs[id]!;
    if (t.pinned !== p.pinned) tabs[id] = { ...t, pinned: p.pinned, pinnedUrl: p.pinned ? t.url || null : null };
  }
  const rest = w.tabIds.filter((id) => !movingSet.has(id));
  let at: number;
  if (p.beforeId && rest.includes(p.beforeId)) at = rest.indexOf(p.beforeId);
  else if (target) {
    const kept = target.tabIds.filter((id) => !movingSet.has(id));
    at = kept.length ? rest.indexOf(kept.at(-1)!) + 1 : Math.min(order.get(target.tabIds[0]!)!, rest.length);
  } else if (p.pinned) at = rest.reduce((last, id, i) => (tabs[id]?.pinned ? i + 1 : last), 0);
  else at = rest.length;
  rest.splice(at, 0, ...moving);

  let groups = leaveGroups(s.groups, movingSet);
  if (target) {
    const members = new Set([...target.tabIds, ...moving]);
    groups = { ...groups, [target.id]: { ...target, tabIds: rest.filter((id) => members.has(id)) } };
  }
  // Every group stays in one piece (a drop between two members of another group lands after it).
  let tabIds = rest;
  for (const g of Object.values(groups)) if (g.windowId === w.id) tabIds = placeBlock(tabIds, tabIds.filter((id) => g.tabIds.includes(id)));
  tabIds = orderSections(tabIds, tabs, groups);
  const window: BrowserWindow = { ...w, tabIds };
  return { ...s, tabs, groups: syncGroupOrder(groups, window), windows: { ...s.windows, [w.id]: window } };
}

export const createOrganizeSlice: StateCreator<BrowserState, [], [], OrganizeSlice> = (set, get) => ({
  selection: {},
  cleanedTabs: [],
  closedGroups: [],
  deletedGroups: [],

  setSelection(windowId, ids) {
    set((s) => {
      const view = new Set(viewTabIds(s, windowId));
      const next = [...new Set(ids)].filter((id) => view.has(id));
      const prev = s.selection[windowId] ?? [];
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return {};
      return { selection: { ...s.selection, [windowId]: next } };
    });
  },

  placeTabs(ids, placement) {
    set((s) => placing(s, ids, placement));
  },

  pinTabs(ids, pinned) {
    const s = get();
    const first = s.tabs[ids[0] ?? ""];
    const w = first && s.windows[first.windowId];
    if (!w) return;
    // Unpinned tabs go to the top of the list (below pinned groups), like Dia.
    const pinnedGroupMembers = new Set(Object.values(s.groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
    const beforeId = pinned ? null : w.tabIds.find((id) => !s.tabs[id]?.pinned && !pinnedGroupMembers.has(id) && !ids.includes(id));
    set(placing(s, ids, { pinned, beforeId }));
  },

  returnToPinnedUrl(tabId) {
    const t = get().tabs[tabId];
    if (!t?.pinnedUrl || samePage(t.url, t.pinnedUrl)) return;
    get().navigate(tabId, t.pinnedUrl);
  },

  setPinnedUrl(tabId, url) {
    const t = get().tabs[tabId];
    const next = url ?? t?.url;
    if (!t?.pinned || !next) return;
    get().updateTab(tabId, { pinnedUrl: next });
    // Editing the pinned page takes you there.
    if (url && !samePage(t.url, url)) get().navigate(tabId, url);
  },

  setMuted(ids, muted) {
    set((s) => {
      const tabs = { ...s.tabs };
      let changed = false;
      for (const id of ids) {
        const t = tabs[id];
        if (t && t.muted !== muted) {
          tabs[id] = { ...t, muted };
          changed = true;
        }
      }
      return changed ? { tabs } : {};
    });
  },

  setSiteMuted(tabId, muted) {
    const s = get();
    const tab = s.tabs[tabId];
    if (!tab) return;
    const host = hostOf(tab.url);
    if (!host) return get().setMuted([tabId], muted);
    const sites = new Set(s.settings.mutedSites ?? []);
    if (muted) sites.add(host);
    else sites.delete(host);
    get().setMuted(
      Object.values(s.tabs)
        .filter((t) => t.profileId === tab.profileId && hostOf(t.url) === host)
        .map((t) => t.id),
      muted,
    );
    get().updateSettings({ mutedSites: [...sites] });
  },

  groupTabs(ids, { pinned = true, name } = {}) {
    const [next, id] = withGroup(get(), ids, { pinned, name });
    if (id) set({ ...next, selection: { ...next.selection, [next.groups[id]!.windowId]: [] } });
    return id;
  },

  moveGroup(groupId, p) {
    set((s) => {
      const g = s.groups[groupId];
      const w = g && s.windows[g.windowId];
      if (!g || !w || (p.beforeId && g.tabIds.includes(p.beforeId))) return {};
      const groups = { ...s.groups, [groupId]: { ...g, pinned: p.pinned } };
      const rest = w.tabIds.filter((id) => !g.tabIds.includes(id));
      let at: number;
      if (p.beforeId && rest.includes(p.beforeId)) {
        // Before another group's member: before that whole group.
        const other = groupOf({ groups }, p.beforeId);
        at = rest.indexOf(other ? other.tabIds.find((id) => rest.includes(id))! : p.beforeId);
      } else if (p.pinned) {
        const pinnedGroup = new Set(Object.values(groups).filter((x) => x.pinned && x.id !== groupId).flatMap((x) => x.tabIds));
        at = rest.reduce((last, id, i) => (s.tabs[id]?.pinned || pinnedGroup.has(id) ? i + 1 : last), 0);
      } else at = rest.length;
      rest.splice(at, 0, ...g.tabIds);
      const window = { ...w, tabIds: orderSections(rest, s.tabs, groups) };
      return { groups: syncGroupOrder(groups, window), windows: { ...s.windows, [w.id]: window } };
    });
  },

  duplicateGroup(groupId) {
    let s = get();
    const g = s.groups[groupId];
    const w = g && s.windows[g.windowId];
    if (!g || !w) return "";
    const after = w.tabIds.indexOf(g.tabIds.at(-1)!) + 1;
    const [restored, ids] = restoreSnapshots(
      s,
      w.id,
      g.tabIds.map((id, i) => ({ tab: { ...snapshotTab(s.tabs[id]!), pinned: false }, index: after + i })),
    );
    let groupId2: string;
    [s, groupId2] = withGroup(restored, ids, { name: g.name, pinned: g.pinned });
    if (groupId2) s = { ...s, groups: { ...s.groups, [groupId2]: { ...s.groups[groupId2]!, icon: g.icon, color: g.color } } };
    set(s);
    return groupId2;
  },

  newTabInGroup(groupId) {
    const s = get();
    const g = s.groups[groupId];
    const w = g && s.windows[g.windowId];
    if (!g || !w) return "";
    const [next, id] = withNewTab(s, w.id, { profileId: g.profileId, index: w.tabIds.indexOf(g.tabIds.at(-1)!) + 1 });
    const window = next.windows[w.id]!;
    const groups = { ...next.groups, [groupId]: { ...g, collapsed: false, tabIds: [...g.tabIds, id] } };
    set({ ...next, groups: syncGroupOrder(groups, window) });
    return id;
  },

  moveGroupToBookmarksBar(groupId) {
    const s = get();
    const g = s.groups[groupId];
    if (!g) return;
    const profileId = bookmarkProfileId(s, s.windows[g.windowId]);
    const folder = get().addBookmarkFolder({ profileId, title: groupLabel(s, g) });
    for (const id of g.tabIds) {
      const t = s.tabs[id];
      if (t?.url) get().addBookmark({ profileId, url: t.url, title: t.customTitle || t.title || t.url, favicon: t.favicon, parentId: folder });
    }
    set(closingGroup(get(), groupId));
  },

  cleanUpTabs(windowId, options = {}) {
    const s = get();
    const hours = s.settings.cleanUpInactiveTabsAfterHours;
    const ids = cleanUpCandidates(s, windowId, options.inactiveForMs ?? (hours ? hours * 3_600_000 : CLEAN_UP_AFTER_MS));
    if (!ids.length) return 0;
    const entries = closedEntries(s, ids);
    const next = closeQuietly(s, ids);
    set({ ...next, cleanedTabs: [...next.cleanedTabs, ...entries].slice(-MAX_CLEANED) });
    return ids.length;
  },

  restoreCleaned(entryId) {
    const s = get();
    const entries = s.cleanedTabs.filter((c) => !entryId || c.id === entryId);
    if (!entries.length) return;
    let next: BrowserState = { ...s, cleanedTabs: s.cleanedTabs.filter((c) => !entries.includes(c)) };
    for (const e of entries) {
      const windowId = restoreTarget(next, e.windowId);
      if (!windowId) continue;
      const [restored, [id]] = restoreSnapshots(next, windowId, [{ tab: e.tab, index: windowId === e.windowId ? e.index : undefined }]);
      next = restored;
      const g = e.group && next.groups[e.group.id];
      if (id && g && g.windowId === windowId) {
        const w = next.windows[windowId]!;
        const members = [...g.tabIds, id];
        const window = { ...w, tabIds: placeBlock(w.tabIds, w.tabIds.filter((t) => members.includes(t))) };
        next = { ...next, windows: { ...next.windows, [windowId]: window }, groups: syncGroupOrder({ ...next.groups, [g.id]: { ...g, tabIds: members } }, window) };
      }
      if (id && entryId) next = apply(next, activated(next, id));
    }
    set(next);
  },

  closeAbandonedNewTabs() {
    const s = get();
    const abandoned = Object.values(s.windows).flatMap((w) => abandonedNewTabs(s, w.id));
    if (abandoned.length) set(removeTabs(s, abandoned, false));
  },
});
