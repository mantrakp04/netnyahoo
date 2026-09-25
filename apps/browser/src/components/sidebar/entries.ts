import { useShallow } from "zustand/react/shallow";
import { useBrowser, type BrowserState } from "../../store/browser";
import { viewTabIds } from "../../store/model";

/**
 * What the sidebar shows, in order: pinned tiles, pinned groups, then the list.
 * List and group entries are `t:<tabId>`, `g:<groupId>` or `s:<splitId>` (a
 * split view shows as one row) — strings, so selectors compare shallowly.
 */
export type SidebarEntries = { tiles: string[]; pinnedGroups: string[]; list: string[] };

const memo = new Map<string, { inputs: unknown[]; result: SidebarEntries }>();

export function sidebarEntries(s: BrowserState, windowId: string): SidebarEntries {
  // Selectors run on every store change (progress events too); recompute only when the inputs do.
  const inputs = [s.tabs, s.windows, s.groups, s.splits];
  const cached = memo.get(windowId);
  if (cached && cached.inputs.every((v, i) => v === inputs[i])) return cached.result;
  const result = computeEntries(s, windowId);
  memo.set(windowId, { inputs, result });
  return result;
}

function computeEntries(s: BrowserState, windowId: string): SidebarEntries {
  const tiles: string[] = [];
  const pinnedGroups: string[] = [];
  const list: string[] = [];
  const groupOf = new Map<string, string>();
  for (const g of Object.values(s.groups)) if (g.windowId === windowId) g.tabIds.forEach((id) => groupOf.set(id, g.id));
  const seen = new Set<string>();
  for (const id of viewTabIds(s, windowId)) {
    const tab = s.tabs[id]!;
    // Opened from a live folder: the folder shows it (LiveFolderBlock).
    if (tab.liveItem && !tab.pinned) continue;
    if (tab.pinned) {
      tiles.push(id);
      continue;
    }
    const groupId = groupOf.get(id);
    const entry = groupId ? `g:${groupId}` : splitEntry(s, id);
    if (seen.has(entry)) continue;
    seen.add(entry);
    if (groupId && s.groups[groupId]!.pinned) pinnedGroups.push(groupId);
    else list.push(entry);
  }
  return { tiles, pinnedGroups, list };
}

/** A group's rows: tabs, and its splits as one row each. */
export function groupEntries(s: BrowserState, groupId: string): string[] {
  const g = s.groups[groupId];
  if (!g) return [];
  const out: string[] = [];
  for (const id of g.tabIds) {
    const entry = splitEntry(s, id);
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

/** `s:<splitId>` for a tab in a split with another unpinned tab, else `t:<tabId>`. */
function splitEntry(s: BrowserState, tabId: string): string {
  for (const v of Object.values(s.splits)) {
    if (v.tabIds.includes(tabId) && v.tabIds.filter((id) => s.tabs[id] && !s.tabs[id]!.pinned).length >= 2) return `s:${v.id}`;
  }
  return `t:${tabId}`;
}

export function useSidebarEntries(windowId: string): SidebarEntries {
  const tiles = useBrowser(useShallow((s) => sidebarEntries(s, windowId).tiles));
  const pinnedGroups = useBrowser(useShallow((s) => sidebarEntries(s, windowId).pinnedGroups));
  const list = useBrowser(useShallow((s) => sidebarEntries(s, windowId).list));
  return { tiles, pinnedGroups, list };
}

export const useGroupEntries = (groupId: string) => useBrowser(useShallow((s) => groupEntries(s, groupId)));

/** The tabs an entry stands for. */
export function entryTabIds(s: BrowserState, entry: string): string[] {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return s.groups[id]?.tabIds ?? [];
  if (entry.startsWith("s:")) return (s.splits[id]?.tabIds ?? []).filter((t) => s.tabs[t] && !s.tabs[t]!.pinned);
  return [id];
}
