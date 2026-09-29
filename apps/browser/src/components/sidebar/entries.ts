import { useShallow } from "zustand/react/shallow";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTabId, viewTabIds } from "../../store/model";

export type SidebarEntries = { tiles: string[]; pinnedGroups: string[]; list: string[] };

const memo = new Map<string, { inputs: unknown[]; result: SidebarEntries }>();

export function sidebarEntries(s: BrowserState, windowId: string, profileId?: string): SidebarEntries {
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

export function numberedTabs(s: BrowserState, windowId: string): string[] {
  const { tiles, pinnedGroups, list } = sidebarEntries(s, windowId);
  const active = activeTabId(s, windowId);
  const rowTab = (entry: string): string[] => {
    const id = entry.slice(2);
    if (entry.startsWith("g:")) return groupEntries(s, id).flatMap(rowTab);
    if (!entry.startsWith("s:")) return [id];
    const panes = (s.splits[id]?.tabIds ?? []).filter((tabId) => s.tabs[tabId] && !s.tabs[tabId]!.pinned);
    if (active && panes.includes(active)) return [active];
    const last = panes.reduce<string | undefined>((a, b) => (!a || s.tabs[b]!.lastActiveAt > s.tabs[a]!.lastActiveAt ? b : a), undefined);
    return last ? [last] : [];
  };
  return [...tiles, ...pinnedGroups.flatMap((id) => rowTab(`g:${id}`)), ...list.flatMap(rowTab)];
}

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
