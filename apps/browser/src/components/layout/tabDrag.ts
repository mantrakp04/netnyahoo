import { hapticTick } from "@netnyahoo/shell";
import { create } from "zustand";
import { focus } from "../../lib/actions";
import { useBrowser } from "../../store/browser";
import type { SplitSide } from "../../store/splits";
import { dropTabIntoSplit } from "./splitActions";
import { dropTabsOutside, windowUnder } from "./windowDrop";

/**
 * Dragging tabs out of a tab list (sidebar, top strip), reported here in window
 * coordinates (a PanResponder's moveX / moveY):
 * - onto the page to split (Dia's left / right drop targets; one tab);
 * - onto another window, which takes the tabs (their pages keep running); its tab list
 *   lights up while the pointer is over it;
 * - out of every window, which tears them off into a new window there.
 *
 *   onPanResponderGrant   → beginTabDrag(tabId) (or beginTabDrag(null, tabIds) for several)
 *   onPanResponderMove    → updateTabDrag(g.moveX, g.moveY)
 *   onPanResponderRelease → if (endTabDrag()) skip your own reorder
 *   onPanResponderTerminate → cancelTabDrag()
 */
export type DropTarget = { tabId: string; side: SplitSide };

type TabDrag = {
  /** The one tab dragged (split targets); null when several are. */
  tabId: string | null;
  tabIds: string[];
  /** The window the drag started in (x / y are in its coordinates). */
  windowId: string | null;
  x: number;
  y: number;
  /** Set by the content area while the pointer is over a target. */
  target: DropTarget | null;
  /** The pointer is outside the source window. */
  outside: boolean;
  /** Another window under the pointer that would take the tabs. */
  overWindow: string | null;
};

export const useTabDrag = create<TabDrag>()(() => ({ tabId: null, tabIds: [], windowId: null, x: 0, y: 0, target: null, outside: false, overWindow: null }));

export function beginTabDrag(tabId: string | null, tabIds: string[] = tabId ? [tabId] : []) {
  const windowId = useBrowser.getState().tabs[tabIds[0] ?? ""]?.windowId ?? null;
  useTabDrag.setState({ tabId, tabIds, windowId, x: -1, y: -1, target: null, outside: false, overWindow: null });
}

export function updateTabDrag(x: number, y: number) {
  const drag = useTabDrag.getState();
  if (!drag.tabIds.length || !drag.windowId) return;
  const s = useBrowser.getState();
  const { outside, overWindow } = windowUnder(s, drag.windowId, x, y);
  if (overWindow && overWindow !== drag.overWindow && s.settings.tabReorderHaptics) hapticTick();
  useTabDrag.setState({ x, y, outside, overWindow });
}

export function setDropTarget(target: DropTarget | null) {
  const current = useTabDrag.getState().target;
  if (current?.tabId === target?.tabId && current?.side === target?.side) return;
  useTabDrag.setState({ target });
}

const IDLE = { tabId: null, tabIds: [], windowId: null, target: null, outside: false, overWindow: null } as const;

/**
 * Ends the drag; true if it was dropped on a split target or outside its window (the caller
 * then skips its own drop handling).
 */
export function endTabDrag(): boolean {
  const { tabId, tabIds, windowId, target, outside, x, y } = useTabDrag.getState();
  useTabDrag.setState({ ...IDLE, tabIds: [] });
  if (target && tabId) {
    dropTabIntoSplit(tabId, target.tabId, target.side);
    return true;
  }
  if (!outside || !windowId || !tabIds.length) return false;
  const moved = dropTabsOutside(tabIds, windowId, x, y);
  if (moved) focus(moved);
  return true;
}

export function cancelTabDrag() {
  useTabDrag.setState({ ...IDLE, tabIds: [] });
}
