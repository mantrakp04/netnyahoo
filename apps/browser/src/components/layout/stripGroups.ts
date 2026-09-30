import type { BrowserState } from "../../store/browser";
import { viewTabIds } from "../../store/model";
import { groupIndex, splitIndex, stableList } from "../../store/structure";
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

/** The tabs' width in the strip: what's left once the dock, the groups' own parts and the + button have their room. */
export function stripTabWidth(o: {
  pageWidth: number;
  dockWidth: number;
  groups: { chip: number; expanded: boolean; shown: boolean }[];
  tabUnits: number;
  gap: number;
  plus: number;
  min: number;
  max: number;
}): number {
  let room = o.pageWidth - o.dockWidth - o.plus - o.gap;
  for (const g of o.groups) {
    const parts = g.expanded ? MEMBERS_INSET + TAIL_EXPANDED : g.shown ? MEMBERS_INSET + TAIL_COLLAPSED : 0;
    room -= GROUP_MARGIN_LEFT + GROUP_MARGIN_RIGHT + g.chip + parts + o.gap;
  }
  const width = o.tabUnits ? room / o.tabUnits - o.gap : o.max;
  // Half points keep every tab edge on the 2x pixel grid, so the attached tab shows no seam against the card.
  return Math.round(Math.max(o.min, Math.min(o.max, width)) * 2) / 2;
}

/**
 * Dragging a tab along the strip. The slots are what it can trade places with, in strip order: at the top level
 * every tab, split and group (a group moves as one block, so a tab never lands between its members); inside an
 * open group, its members. Each has its tabs (in window order), its width and its outer margins.
 */
export type DragSlot = { tabIds: string[]; width: number; marginLeft?: number; marginRight?: number };
export type DragGeometry = { slots: DragSlot[]; lefts: number[] };

export function dragGeometry(slots: DragSlot[], gap: number): DragGeometry {
  const lefts: number[] = [];
  let x = 0;
  for (const slot of slots) {
    x += slot.marginLeft ?? 0;
    lefts.push(x);
    x += slot.width + (slot.marginRight ?? 0) + gap;
  }
  return { slots, lefts };
}

/** How far the dragged slot may travel: from the first slot's left edge to the last slot's right edge. */
export function dragRange({ slots, lefts }: DragGeometry, from: number): [number, number] {
  const last = slots.length - 1;
  return [lefts[0]! - lefts[from]!, lefts[last]! + slots[last]!.width - (lefts[from]! + slots[from]!.width)];
}

/** The slot index the dragged one lands on: past the centre of a neighbour, it takes that neighbour's place. */
export function dropIndex({ slots, lefts }: DragGeometry, from: number, dx: number): number {
  const centre = lefts[from]! + slots[from]!.width / 2 + dx;
  let index = 0;
  slots.forEach((slot, i) => {
    if (i !== from && lefts[i]! + slot.width / 2 < centre) index++;
  });
  return index;
}

/**
 * The index for store.moveTab (its section: the window's unpinned tabs of the profile, in order, without the tab)
 * that puts the dragged tab at slot `to`: before the first tab of the slot it lands on, or after the last one.
 */
export function moveIndex(section: string[], tabId: string, slots: DragSlot[], from: number, to: number): number | null {
  if (to === from) return null;
  const moved = section.filter((id) => id !== tabId);
  const others = slots.filter((_, i) => i !== from);
  const anchor = to < others.length ? others[to]!.tabIds[0] : others[others.length - 1]?.tabIds.at(-1);
  const at = anchor ? moved.indexOf(anchor) : -1;
  if (at < 0) return null;
  return to < others.length ? at : at + 1;
}

/** A member takes clicks when it's the tab shown after a collapsed group's chip, or once an open group has settled. */
export function memberInteractive(shown: boolean, expanded: boolean, moving: boolean): boolean {
  return shown || (expanded && !moving);
}

const stripMemo = new Map<string, { inputs: unknown[]; result: string[] }>();

/**
 * The strip's entries for a profile page, in order: `pinned:<tab>`, `group:<id>:<collapsed>`,
 * `split:<id>:<tabs>:<group>` and `tab:<id>:<group>`. Every member stays listed, collapsed or not, so a group can
 * slide them in and out. Recomputed only when tabs, windows, groups or splits change, and the same array comes
 * back while the entries don't, so a progress update costs a lookup.
 */
export function stripEntries(s: BrowserState, windowId: string, profileId: string): string[] {
  const key = `${windowId}|${profileId}`;
  const inputs = [s.tabs, s.windows, s.groups, s.splits];
  const cached = stripMemo.get(key);
  if (cached && cached.inputs.every((v, i) => v === inputs[i])) return cached.result;
  const groups = groupIndex(s.groups);
  const splits = splitIndex(s.splits);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of viewTabIds(s, windowId, profileId)) {
    const t = s.tabs[id]!;
    if (t.pinned) {
      out.push(`pinned:${id}`);
      continue;
    }
    const group = groups.get(id);
    if (group && !seen.has(group.id)) {
      seen.add(group.id);
      out.push(`group:${group.id}:${group.collapsed ? 1 : 0}`);
    }
    const split = splits.get(id)?.[0];
    if (split) {
      if (!seen.has(split.id)) out.push(`split:${split.id}:${split.tabIds.join(",")}:${group?.id ?? ""}`);
      seen.add(split.id);
      continue;
    }
    out.push(`tab:${id}:${group?.id ?? ""}`);
  }
  const result = stableList(cached?.result, out);
  stripMemo.set(key, { inputs, result });
  if (stripMemo.size > 8) for (const k of stripMemo.keys()) if (!s.windows[k.split("|")[0]!]) stripMemo.delete(k);
  return result;
}
