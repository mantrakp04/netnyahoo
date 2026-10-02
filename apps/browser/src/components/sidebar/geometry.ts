// Where rows sit in the sidebar's list, from the store alone: rows are fixed-height, so a row's place is known before
// it mounts or lays out. GroupBlock and Fold draw groups by these numbers; revealing a tab scrolls by them.
import { layout } from "../../lib/theme";
import type { BrowserState } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { groupEntries, sidebarEntries } from "./entries";

export const GROUP_PAD = 2;
export const GROUP_BORDER = 0.5;
const ROW = layout.rowHeight;
const GAP = layout.rowGap;

export type Section = "pinnedGroups" | "list";

// The entry of a group that holds the window's active tab: it stays out while the group is collapsed.
export function keptEntry(s: BrowserState, windowId: string, profileId: string, entries: string[]): string | null {
  const active = activeTabId(s, windowId, profileId);
  if (!active) return null;
  return entries.find((e) => e === `t:${active}` || (e.startsWith("s:") && !!s.splits[e.slice(2)]?.tabIds.includes(active))) ?? null;
}

// A group's members: every row open; only the kept one collapsed (none: nothing, its padding included).
function membersHeight(s: BrowserState, windowId: string, profileId: string, groupId: string): number {
  const entries = groupEntries(s, groupId);
  if (!s.groups[groupId]?.collapsed) return entries.length ? entries.length * ROW + (entries.length - 1) * GAP + GROUP_PAD : GROUP_PAD;
  return keptEntry(s, windowId, profileId, entries) ? ROW + GROUP_PAD : 0;
}

/** A list entry's height: a tab or split row, or a group block (its border, header and members). */
export function entryHeight(s: BrowserState, windowId: string, profileId: string, entry: string): number {
  if (!entry.startsWith("g:")) return ROW;
  return GROUP_BORDER * 2 + ROW + membersHeight(s, windowId, profileId, entry.slice(2));
}

/** The room `entries` take in a list (gaps between them included). */
export function entriesHeight(s: BrowserState, windowId: string, profileId: string, entries: string[]): number {
  return entries.reduce((sum, e) => sum + entryHeight(s, windowId, profileId, e) + GAP, 0) - (entries.length ? GAP : 0);
}

/**
 * The row showing `tabId` in its section, from the section's top; null for a pinned tile or a live folder's row.
 * `newTabAtTop`: the list starts with the New Tab row.
 */
export function rowSpan(
  s: BrowserState,
  windowId: string,
  profileId: string,
  tabId: string,
  newTabAtTop: boolean,
): { section: Section; top: number; height: number } | null {
  const { pinnedGroups, list } = sidebarEntries(s, windowId, profileId);
  const sections: [Section, string[], number][] = [
    ["pinnedGroups", pinnedGroups.map((id) => `g:${id}`), 0],
    ["list", list, newTabAtTop ? ROW + GAP : 0],
  ];
  for (const [section, entries, start] of sections) {
    let top = start;
    for (const entry of entries) {
      const id = entry.slice(2);
      if (entry === `t:${tabId}` || (entry.startsWith("s:") && s.splits[id]?.tabIds.includes(tabId))) return { section, top, height: ROW };
      if (entry.startsWith("g:") && s.groups[id]?.tabIds.includes(tabId)) {
        const members = groupEntries(s, id);
        const at = members.findIndex((e) => e === `t:${tabId}` || (e.startsWith("s:") && !!s.splits[e.slice(2)]?.tabIds.includes(tabId)));
        const header = top + GROUP_BORDER;
        if (s.groups[id]!.collapsed) {
          // A collapsed group shows only the kept row; any other member is behind its header.
          const kept = keptEntry(s, windowId, profileId, members) === members[at];
          return kept ? { section, top: header + ROW, height: ROW } : { section, top: header, height: ROW };
        }
        return { section, top: header + ROW + at * (ROW + GAP), height: ROW };
      }
      top += entryHeight(s, windowId, profileId, entry) + GAP;
    }
  }
  return null;
}
