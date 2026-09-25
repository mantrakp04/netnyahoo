import { useBrowser, type BrowserState } from "../../store/browser";
import type { Frame } from "../../store/types";

/**
 * Tabs dragged out of their window (layout/tabDrag.ts): which window is under the pointer,
 * and the drop (another window takes them, or they tear off into a new window there).
 * Window coordinates are the dragging window's content (top-left origin); frames are
 * Cocoa's (bottom-left origin).
 */

/** Cocoa screen point of a point in `windowId`'s content. */
function screenPoint(s: BrowserState, windowId: string, x: number, y: number): [number, number] | null {
  const frame = s.windows[windowId]?.frame;
  if (!frame) return null;
  return [frame[0] + x, frame[1] + frame[3] - y];
}

const contains = (frame: Frame, [px, py]: [number, number]) => px >= frame[0] && px <= frame[0] + frame[2] && py >= frame[1] && py <= frame[1] + frame[3];

/**
 * Whether the pointer left `source`, and the window that would take its tabs there: the
 * frontmost of ours (most recently focused first) that can hold them (incognito tabs stay put).
 */
export function windowUnder(s: BrowserState, source: string, x: number, y: number): { outside: boolean; overWindow: string | null } {
  const from = s.windows[source];
  const frame = from?.frame;
  const outside = !!frame && (x < 0 || y < 0 || x > frame[2] || y > frame[3]);
  const point = outside ? screenPoint(s, source, x, y) : null;
  if (!point || !from || from.incognito) return { outside, overWindow: null };
  const overWindow = s.ui.focusOrder.find((id) => {
    const w = s.windows[id];
    return !!w && id !== source && !w.incognito && !!w.frame && contains(w.frame, point);
  });
  return { outside, overWindow: overWindow ?? null };
}

/**
 * Drops `tabIds` from `source` at a point outside it: into the window there, else into a new
 * window of `source`'s size with the pointer over its sidebar. Returns the window that got
 * them (to bring forward), or null if nothing moved (incognito tabs; a window's only tabs).
 */
export function dropTabsOutside(tabIds: string[], source: string, x: number, y: number): string | null {
  const s = useBrowser.getState();
  const from = s.windows[source];
  if (!from || from.incognito || !tabIds.length) return null;
  const { overWindow } = windowUnder(s, source, x, y);
  if (overWindow) {
    s.moveTabsToWindow(tabIds, overWindow);
    return overWindow;
  }
  const point = screenPoint(s, source, x, y);
  // Tearing off all of a window's tabs would only move the window.
  if (!point || from.tabIds.every((id) => tabIds.includes(id))) return null;
  const [, , width, height] = from.frame ?? [0, 0, 1200, 800];
  const frame: Frame = [Math.round(point[0] - 90), Math.round(point[1] - height + 70), width, height];
  return s.createWindow({ profileId: s.tabs[tabIds[0]!]?.profileId, tabIds, frame });
}
