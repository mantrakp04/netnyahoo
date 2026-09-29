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

/** `profileId`: another profile's page (a profile swipe draws it beside the window's). */
export function sidebarEntries(s: BrowserState, windowId: string, profileId?: string): SidebarEntries {
  // Selectors run on every store change (progress events too); recompute only when the inputs do.
  const inputs = [s.tabs, s.windows, s.groups, s.splits];
  const key = profileId ? `${windowId}|${profileId}` : windowId;
  const cached = memo.get(key);
  if (cached && cached.inputs.every((v, i) => v === inputs[i])) return cached.result;
  const result = computeEntries(s, windowId, profileId);
  memo.set(key, { inputs, result });
  return result;
}

function computeEntries(s: BrowserState, windowId: string, profileId?: string): SidebarEntries {
  const tiles: string[] = [];
  const pinnedGroups: string[] = [];
  const list: string[] = [];
  const groupOf = new Map<string, string>();
  for (const g of Object.values(s.groups)) if (g.windowId === windowId) g.tabIds.forEach((id) => groupOf.set(id, g.id));
  const seen = new Set<string>();
  for (const id of viewTabIds(s, windowId, profileId)) {
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

export function useSidebarEntries(windowId: string, profileId?: string): SidebarEntries {
  const tiles = useBrowser(useShallow((s) => sidebarEntries(s, windowId, profileId).tiles));
  const pinnedGroups = useBrowser(useShallow((s) => sidebarEntries(s, windowId, profileId).pinnedGroups));
  const list = useBrowser(useShallow((s) => sidebarEntries(s, windowId, profileId).list));
  return { tiles, pinnedGroups, list };
}

export const useGroupEntries = (groupId: string) => useBrowser(useShallow((s) => groupEntries(s, groupId)));
