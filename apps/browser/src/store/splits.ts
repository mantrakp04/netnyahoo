import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { leaveGroups, syncGroupOrder } from "./groups";
import { newId } from "./model";
import { activated, apply, removeTabs, withNewTab } from "./tabs";
import type { BrowserWindow, SplitView, Tab } from "./types";

/**
 * Split views (Dia: up to three panes). A split's tabs share a window and
 * profile and sit next to each other in window.tabIds, so the sidebar can show
 * them as one entry. The window's active tab is the split's focused pane:
 * selecting any member shows the whole split, and the toolbar follows it.
 */
export type SplitsSlice = {
  splits: Record<string, SplitView>;

  /** Splits existing tabs (the first one's position and group win). Returns the split id, or "". */
  createSplit(tabIds: string[], orientation?: SplitView["orientation"]): string;
  /**
   * Adds a pane next to `anchorTabId` (default: the window's active tab), splitting it if
   * needed: an existing tab (`tabId`), a page (`url`) or a New Tab page. Focuses the new
   * pane unless `background`.
   */
  openSplitPane(windowId: string, options?: OpenPaneOptions): OpenPaneResult;
  /** Shows `tabId` in `paneTabId`'s place and closes that pane's tab (an empty pane picking a tab). */
  replaceSplitPane(paneTabId: string, tabId: string): void;
  /** The tab stays open as a regular tab. */
  removeTabFromSplit(tabId: string): void;
  /** Separate All Tabs. */
  separateSplit(splitId: string): void;
  updateSplit(id: string, patch: { sizes?: number[]; stackSizes?: [number, number] }): void;
  /** Mirrors the panes (left ↔ right, top ↔ bottom). */
  flipSplit(splitId: string): void;
  /** Horizontal ↔ vertical. */
  toggleSplitOrientation(splitId: string): void;
  /** Swaps a pane with its neighbour in reading order (Move Pane Left / Right). */
  movePane(tabId: string, delta: 1 | -1): void;
  /** ⌃⇧] / ⌃⇧[: focus the next / previous pane of the active split. */
  focusPane(windowId: string, delta: 1 | -1): void;
  /** ⇧⌘S: sidebar ↔ top tab strip for this window (new windows follow the last choice). */
  toggleTabLayout(windowId: string): void;
};

export type SplitSide = "left" | "right" | "top" | "bottom";
export type OpenPaneOptions = {
  /** An existing tab of the window to show in the new pane. */
  tabId?: string;
  /** Typed input or URL for a new tab; omit (and `tabId`) for a New Tab page. */
  url?: string;
  anchorTabId?: string;
  side?: SplitSide;
  background?: boolean;
};
export type OpenPaneResult = { ok: true; tabId: string; splitId: string } | { ok: false; reason: "max" | "invalid" };

export const MAX_SPLIT_PANES = 3;

/** A top-level slot: one pane, or two stacked the other way. */
export type SplitSlot = string[];

export function slotsOf(split: Pick<SplitView, "tabIds" | "stack">): SplitSlot[] {
  const slots: SplitSlot[] = [];
  for (let i = 0; i < split.tabIds.length; i++) {
    if (split.stack?.index === i) slots.push([split.tabIds[i]!, split.tabIds[++i]!]);
    else slots.push([split.tabIds[i]!]);
  }
  return slots;
}

const equal = (n: number) => Array.from({ length: n }, () => 1 / n);

/** Rebuilds a split from its slots; sizes are kept when the slot count didn't change. */
function fromSlots(split: SplitView, slots: SplitSlot[], sizes?: number[]): SplitView {
  const tabIds = slots.flat();
  const stackAt = slots.findIndex((slot) => slot.length === 2);
  const stack = stackAt >= 0 ? { index: slots.slice(0, stackAt).flat().length, sizes: split.stack?.sizes ?? ([0.5, 0.5] as [number, number]) } : undefined;
  const next: SplitView = { ...split, tabIds, sizes: sizes && sizes.length === slots.length ? sizes : equal(slots.length) };
  if (stack) next.stack = stack;
  else delete next.stack;
  return next;
}

export function splitOf(s: Pick<BrowserState, "splits">, tabId: string | undefined): SplitView | undefined {
  if (!tabId) return undefined;
  for (const v of Object.values(s.splits)) if (v.tabIds.includes(tabId)) return v;
  return undefined;
}

/** Drops closed tabs from their splits; a split left with one pane goes away. */
export function removeFromSplits(splits: Record<string, SplitView>, gone: Set<string>): Record<string, SplitView> {
  if (!Object.values(splits).some((v) => v.tabIds.some((id) => gone.has(id)))) return splits;
  const next: Record<string, SplitView> = {};
  for (const v of Object.values(splits)) {
    if (!v.tabIds.some((id) => gone.has(id))) {
      next[v.id] = v;
      continue;
    }
    const slots = slotsOf(v)
      .map((slot) => slot.filter((id) => !gone.has(id)))
      .filter((slot) => slot.length);
    if (slots.flat().length < 2) continue;
    // A stack that lost a pane becomes a plain slot; the remaining slots share the space.
    const kept = slotsOf(v).map((slot) => slot.some((id) => !gone.has(id)));
    const sizes = v.sizes.filter((_, i) => kept[i]);
    const total = sizes.reduce((a, b) => a + b, 0);
    next[v.id] = fromSlots(v, slots, total > 0 ? sizes.map((x) => x / total) : undefined);
  }
  return next;
}

/** Repairs splits loaded from disk: members must exist in one window and profile. */
export function sanitizeSplits(splits: Record<string, SplitView>, tabs: Record<string, Tab>): Record<string, SplitView> {
  const next: Record<string, SplitView> = {};
  const used = new Set<string>();
  for (const v of Object.values(splits)) {
    const first = tabs[v.tabIds[0] ?? ""];
    const ok = (id: string) => tabs[id]?.windowId === v.windowId && tabs[id]?.profileId === first?.profileId && !used.has(id);
    const gone = new Set(v.tabIds.filter((id) => !ok(id)));
    const fixed = gone.size ? removeFromSplits({ [v.id]: v }, gone)[v.id] : v;
    if (!fixed || fixed.tabIds.length > MAX_SPLIT_PANES) continue;
    fixed.tabIds.forEach((id) => used.add(id));
    next[v.id] = fixed;
  }
  return next;
}

/**
 * Puts a split's members next to `anchorId` in window.tabIds (in pane order) and
 * into the anchor's group, so the sidebar can show them as one entry. Pinned
 * members stay where they are.
 */
function gather(s: BrowserState, anchorId: string, members: string[]): BrowserState {
  const anchor = s.tabs[anchorId];
  const w = anchor && s.windows[anchor.windowId];
  if (!anchor || !w || anchor.pinned) return s;
  const moving = new Set(members.filter((id) => id !== anchorId && s.tabs[id] && !s.tabs[id]!.pinned));
  if (!moving.size) return s;
  const block = members.filter((id) => id === anchorId || moving.has(id));
  const tabIds = w.tabIds.filter((id) => !moving.has(id));
  tabIds.splice(tabIds.indexOf(anchorId), 1, ...block);
  const window: BrowserWindow = { ...w, tabIds };
  let groups = leaveGroups(s.groups, moving);
  const group = Object.values(s.groups).find((g) => g.tabIds.includes(anchorId));
  if (group && groups[group.id]) groups = { ...groups, [group.id]: { ...groups[group.id]!, tabIds: [...groups[group.id]!.tabIds, ...moving] } };
  return { ...s, windows: { ...s.windows, [w.id]: window }, groups: syncGroupOrder(groups, window) };
}

/** Where `tabId` goes among `anchor`'s split (or a new one): returns the split's new shape. */
function withPane(existing: SplitView | undefined, anchorId: string, tabId: string, side: SplitSide, windowId: string): SplitView | null {
  const horizontal = side === "left" || side === "right";
  const before = side === "left" || side === "top";
  if (!existing) {
    return {
      id: newId("split"),
      windowId,
      tabIds: before ? [tabId, anchorId] : [anchorId, tabId],
      orientation: horizontal ? "horizontal" : "vertical",
      sizes: [0.5, 0.5],
    };
  }
  if (existing.tabIds.length >= MAX_SPLIT_PANES) return null;
  const slots = slotsOf(existing);
  const k = slots.findIndex((slot) => slot.includes(anchorId));
  if (k < 0) return null;
  if ((existing.orientation === "horizontal") === horizontal) {
    slots.splice(before ? k : k + 1, 0, [tabId]);
    return fromSlots(existing, slots);
  }
  // Across the split's direction: the anchor's slot becomes a stack (it's a single pane:
  // a split with a stack already has three).
  slots[k] = before ? [tabId, anchorId] : [anchorId, tabId];
  return { ...fromSlots(existing, slots, existing.sizes), stack: { index: slots.slice(0, k).flat().length, sizes: [0.5, 0.5] } };
}

export const createSplitsSlice: StateCreator<BrowserState, [], [], SplitsSlice> = (set, get) => ({
  splits: {},

  createSplit(tabIds, orientation = "horizontal") {
    const s = get();
    const tabs = [...new Set(tabIds)].map((id) => s.tabs[id]).filter((t): t is Tab => !!t);
    const first = tabs[0];
    if (tabs.length < 2 || tabs.length > MAX_SPLIT_PANES || !first) return "";
    if (tabs.some((t) => t.windowId !== first.windowId || t.profileId !== first.profileId)) return "";
    const ids = tabs.map((t) => t.id);
    // A tab is in at most one split.
    const splits = removeFromSplits(s.splits, new Set(ids));
    const split: SplitView = { id: newId("split"), windowId: first.windowId, tabIds: ids, orientation, sizes: equal(ids.length) };
    set(gather({ ...s, splits: { ...splits, [split.id]: split } }, first.id, ids));
    return split.id;
  },

  openSplitPane(windowId, o = {}) {
    let s = get();
    const w = s.windows[windowId];
    const anchorId = o.anchorTabId ?? (w ? w.activeTabIds[w.profileId] : undefined);
    const anchor = anchorId ? s.tabs[anchorId] : undefined;
    if (!w || !anchor || anchor.windowId !== windowId) return { ok: false, reason: "invalid" };
    const existing = Object.values(s.splits).find((v) => v.tabIds.includes(anchor.id));
    if (existing && existing.tabIds.length >= MAX_SPLIT_PANES) return { ok: false, reason: "max" };

    let tabId = o.tabId;
    if (tabId) {
      const t = s.tabs[tabId];
      if (!t || tabId === anchor.id || t.windowId !== windowId || t.profileId !== anchor.profileId) return { ok: false, reason: "invalid" };
      // It leaves any split it was in.
      s = { ...s, splits: removeFromSplits(s.splits, new Set([tabId])) };
    } else {
      [s, tabId] = withNewTab(s, windowId, { url: o.url, profileId: anchor.profileId, openerId: o.url ? anchor.id : undefined, background: true });
    }
    const current = existing && s.splits[existing.id];
    const split = withPane(current, anchor.id, tabId, o.side ?? "right", windowId);
    if (!split) return { ok: false, reason: "max" };
    s = gather({ ...s, splits: { ...s.splits, [split.id]: split } }, anchor.id, split.tabIds);
    if (!o.background) s = apply(s, activated(s, tabId));
    set(s);
    return { ok: true, tabId, splitId: split.id };
  },

  replaceSplitPane(paneTabId, tabId) {
    let s = get();
    const split = splitOf(s, paneTabId);
    const pane = s.tabs[paneTabId];
    const tab = s.tabs[tabId];
    if (!split || !pane || !tab || split.tabIds.includes(tabId) || tab.windowId !== pane.windowId || tab.profileId !== pane.profileId) return;
    s = { ...s, splits: removeFromSplits(s.splits, new Set([tabId])) };
    // The tab moves next to the pane (and into its group), takes its place in the split,
    // then the pane's own tab closes (a New Tab page: nothing to reopen).
    s = gather(s, paneTabId, [paneTabId, tabId]);
    const current = s.splits[split.id]!;
    s = { ...s, splits: { ...s.splits, [split.id]: { ...current, tabIds: current.tabIds.map((id) => (id === paneTabId ? tabId : id)) } } };
    s = removeTabs(s, [paneTabId], false);
    set(apply(s, activated(s, tabId)));
  },

  removeTabFromSplit(tabId) {
    set((s) => {
      const split = splitOf(s, tabId);
      if (!split) return {};
      const splits = removeFromSplits(s.splits, new Set([tabId]));
      if (!splits[split.id]) return { splits };
      // The tab goes right after what's left of the split, so the split stays contiguous.
      const w = s.windows[split.windowId]!;
      const rest = split.tabIds.filter((id) => id !== tabId);
      const tabIds = w.tabIds.filter((id) => id !== tabId);
      const last = Math.max(...rest.map((id) => tabIds.indexOf(id)));
      tabIds.splice(last + 1, 0, tabId);
      const window = s.tabs[tabId]?.pinned ? w : { ...w, tabIds };
      return { splits, windows: { ...s.windows, [w.id]: window }, groups: syncGroupOrder(s.groups, window) };
    });
  },

  separateSplit(splitId) {
    set((s) => {
      const { [splitId]: _, ...splits } = s.splits;
      return { splits };
    });
  },

  updateSplit(id, { sizes, stackSizes }) {
    set((s) => {
      const split = s.splits[id];
      if (!split) return {};
      const next = { ...split };
      if (sizes && sizes.length === split.sizes.length) next.sizes = sizes;
      if (stackSizes && split.stack) next.stack = { ...split.stack, sizes: stackSizes };
      return { splits: { ...s.splits, [id]: next } };
    });
  },

  flipSplit(splitId) {
    set((s) => {
      const split = s.splits[splitId];
      if (!split) return {};
      return { splits: { ...s.splits, [splitId]: fromSlots(split, slotsOf(split).reverse(), [...split.sizes].reverse()) } };
    });
  },

  toggleSplitOrientation(splitId) {
    set((s) => {
      const split = s.splits[splitId];
      if (!split) return {};
      const orientation = split.orientation === "horizontal" ? "vertical" : "horizontal";
      return { splits: { ...s.splits, [splitId]: { ...split, orientation } } };
    });
  },

  movePane(tabId, delta) {
    set((s) => {
      const split = splitOf(s, tabId);
      if (!split) return {};
      const i = split.tabIds.indexOf(tabId);
      const j = i + delta;
      if (j < 0 || j >= split.tabIds.length) return {};
      const tabIds = [...split.tabIds];
      [tabIds[i], tabIds[j]] = [tabIds[j]!, tabIds[i]!];
      return { splits: { ...s.splits, [split.id]: { ...split, tabIds } } };
    });
  },

  focusPane(windowId, delta) {
    const s = get();
    const w = s.windows[windowId];
    const active = w?.activeTabIds[w.profileId];
    const split = splitOf(s, active);
    if (!split || !active) return;
    const i = split.tabIds.indexOf(active);
    get().activate(split.tabIds[(i + delta + split.tabIds.length) % split.tabIds.length]!);
  },

  toggleTabLayout(windowId) {
    set((s) => {
      const w = s.windows[windowId];
      if (!w) return {};
      const tabLayout = (w.tabLayout ?? s.settings.tabLayout) === "sidebar" ? "top" : "sidebar";
      return { windows: { ...s.windows, [windowId]: { ...w, tabLayout } }, settings: { ...s.settings, tabLayout } };
    });
  },
});
