import type { BrowserState } from "../../store/browser";
import { viewTabIds } from "../../store/model";
import { springParams } from "./swipeMotion";

// Tab groups in the top strip, measured from a 2x recording of Dia 1.50.1 (dia-spec.md › Top tab strip › Groups).
// A group is one container: the chip (glyph + name), then its members. Collapsed, only the window's active tab
// stays out when it's a member; expanded, every member at full width, then a divider and Close Group.

// The container sits 8 from the pinned dock and from the next tab.
export const GROUP_MARGIN_LEFT = 3.5;
export const GROUP_MARGIN_RIGHT = 4;
// Chip → first member, and the room after the last member: 4.5 collapsed, divider + close button expanded.
export const MEMBERS_INSET = 6.5;
export const TAIL_COLLAPSED = 4.5;
export const TAIL_EXPANDED = 30.25;
export const CHIP_WIDTH_GUESS = 49;
// Both ways, the members and the container move on one spring: response 0.30 s, damping 0.82 (1 % overshoot,
// settled in ~0.3 s). A tab tucked back into the group fades out in ~0.12 s.
export const GROUP_SPRING = springParams(0.3, 0.82);
export const TUCK_FADE_MS = 120;

export type GroupLayout = { offsets: number[]; width: number };

/**
 * Member offsets from the first member's slot when expanded, and the container width. Collapsed, the shown
 * member (the active tab, `shown` ≥ 0) sits in the first slot and the others under it.
 */
export function groupLayout(chip: number, widths: number[], gap: number, expanded: boolean, shown: number): GroupLayout {
  const offsets: number[] = [];
  let x = 0;
  for (const w of widths) {
    offsets.push(x);
    x += w + gap;
  }
  const members = widths.length ? x - gap : 0;
  if (expanded && widths.length) return { offsets, width: chip + MEMBERS_INSET + members + TAIL_EXPANDED };
  if (shown >= 0 && widths[shown] !== undefined) return { offsets, width: chip + MEMBERS_INSET + widths[shown]! + TAIL_COLLAPSED };
  return { offsets, width: chip };
}

/** Dia's "–" on the active tab of a collapsed group: the tab to go back to, the most recent one outside the group. */
export function tuckTarget(s: BrowserState, windowId: string, profileId: string, groupId: string): string | undefined {
  const members = new Set(s.groups[groupId]?.tabIds ?? []);
  let best: string | undefined;
  for (const id of viewTabIds(s, windowId, profileId)) {
    const t = s.tabs[id];
    if (!t || members.has(id)) continue;
    if (!best || t.lastActiveAt > s.tabs[best]!.lastActiveAt) best = id;
  }
  return best;
}
