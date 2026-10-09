import type { BrowserState } from "./browser";
import { inPinnedContainer } from "./model";
import { groupOf, pinnedChildGroup } from "./organize";
import { splitOf } from "./splits";
import type { BrowserWindow, Tab } from "./types";

// Chrome's opener model (TabStripModel), which Dia keeps: a tab opened from a link remembers its opener
// (`Tab.openerId`) until the user starts something else. While it holds, links opened behind line up after
// the opener in the order they were opened, and closing the page goes back to the opener's other tabs,
// then to the opener. Switching to an unrelated tab, typing an address or opening a link in front forgets
// every opener in the window.

const regular = (s: BrowserState, id: string) => !inPinnedContainer(s, id);

// Where a new unpinned tab goes: next to its opener, else at the top or bottom of the list (the setting).
export function insertionIndex(s: BrowserState, w: BrowserWindow, tab: Tab, background: boolean): number {
  const opener = tab.openerId ? s.tabs[tab.openerId] : undefined;
  let index: number;
  if (opener && opener.windowId === w.id && opener.profileId === tab.profileId && regular(s, opener.id)) {
    // A split is one row: its tabs go after its last pane.
    const panes = splitOf(s, opener.id)?.tabIds ?? [opener.id];
    const at = Math.max(...panes.map((id) => w.tabIds.indexOf(id))) + 1;
    index = background ? afterFamily(s, w, tab, at, opener.id) : at;
  } else if (opener && opener.windowId === w.id && opener.profileId === tab.profileId) {
    // From a pinned tab: just below the pinned tabs, after the links it opened before (Dia gathers them there).
    const gathered = pinnedChildGroup(s, opener.id, tab.profileId);
    index = gathered
      ? Math.max(...gathered.tabIds.map((id) => w.tabIds.indexOf(id))) + 1
      : afterFamily(s, w, tab, firstRegular(s, w, tab), opener.id);
  } else {
    index = listStart(s, w, tab);
    // An opener in another window (Little Arcadia) still keeps its tabs in order.
    if (opener) index = afterFamily(s, w, tab, index, opener.id);
  }
  return outsideSplit(s, w, index);
}

function firstRegular(s: BrowserState, w: BrowserWindow, tab: Tab): number {
  const first = w.tabIds.findIndex((id) => s.tabs[id]?.profileId === tab.profileId && regular(s, id));
  return first >= 0 ? first : w.tabIds.length;
}

const listStart = (s: BrowserState, w: BrowserWindow, tab: Tab) =>
  s.settings.newTabPosition === "top" ? firstRegular(s, w, tab) : w.tabIds.length;

// Past the tabs the opener opened, and the tabs those opened, that follow `from` in the same group.
function afterFamily(s: BrowserState, w: BrowserWindow, tab: Tab, from: number, openerId: string): number {
  const family = new Set([openerId]);
  const group = s.tabs[openerId]?.windowId === w.id && regular(s, openerId) ? groupOf(s, openerId)?.id : undefined;
  let index = from;
  for (let i = from; i < w.tabIds.length; i++) {
    const t = s.tabs[w.tabIds[i]!];
    if (!t || t.profileId !== tab.profileId) continue;
    if (!t.openerId || !family.has(t.openerId) || groupOf(s, t.id)?.id !== group) break;
    family.add(t.id);
    index = i + 1;
  }
  return index;
}

// A split's panes stay next to each other in the list.
function outsideSplit(s: BrowserState, w: BrowserWindow, index: number): number {
  const before = w.tabIds[index - 1], after = w.tabIds[index];
  const split = before && after ? splitOf(s, before) : undefined;
  if (!split?.tabIds.includes(after!)) return index;
  return Math.max(...split.tabIds.map((id) => w.tabIds.indexOf(id))) + 1;
}

export function forgetOpeners(s: BrowserState, windowId: string, keep?: string): BrowserState {
  const w = s.windows[windowId];
  const ids = w?.tabIds.filter((id) => id !== keep && s.tabs[id]?.openerId);
  if (!ids?.length) return s;
  const tabs = { ...s.tabs };
  for (const id of ids) tabs[id] = { ...tabs[id]!, openerId: null };
  return { ...s, tabs };
}

// Chrome keeps the openers when the user moves between a tab and a tab it opened, or between two tabs that
// share an opener (TabStripModel::SetSelection).
export function switchKeepsOpeners(s: BrowserState, from: string, to: string): boolean {
  const a = s.tabs[from]?.openerId ?? null, b = s.tabs[to]?.openerId ?? null;
  return a === b || b === from || a === to;
}

// What to show when the shown tab `closed` goes: a tab it opened, then another tab its opener opened, then the
// opener (TabStripModel::DetermineNewSelectedIndex). `order` is the profile's tabs before the close, `left` the
// ones that stay.
export function openerSuccessor(s: BrowserState, closed: string, order: string[], left: string[]): string | undefined {
  const at = order.indexOf(closed);
  const candidates = [...left.filter((id) => order.indexOf(id) > at), ...left.filter((id) => order.indexOf(id) < at).reverse()].filter(
    (id) => !s.tabs[id]!.unloaded && !groupOf(s, id)?.collapsed,
  );
  const opener = s.tabs[closed]?.openerId;
  return (
    candidates.find((id) => s.tabs[id]!.openerId === closed) ??
    (opener ? (candidates.find((id) => s.tabs[id]!.openerId === opener) ?? (candidates.includes(opener) ? opener : undefined)) : undefined)
  );
}
