import { create } from "zustand";
import type { SplitSide } from "../../store/splits";
import { dropTabIntoSplit } from "./splitActions";

/**
 * Dragging a tab onto the page to split (Dia's left / right drop targets). The
 * tab list that owns the drag (sidebar, top strip) reports it here, in window
 * coordinates (a PanResponder's moveX / moveY); the content area shows the
 * targets and resolves the drop.
 *
 *   onPanResponderGrant   → beginTabDrag(tabId)
 *   onPanResponderMove    → updateTabDrag(g.moveX, g.moveY)
 *   onPanResponderRelease → if (endTabDrag()) skip your own reorder
 *   onPanResponderTerminate → cancelTabDrag()
 */
export type DropTarget = { tabId: string; side: SplitSide };

type TabDrag = {
  tabId: string | null;
  x: number;
  y: number;
  /** Set by the content area while the pointer is over a target. */
  target: DropTarget | null;
};

export const useTabDrag = create<TabDrag>()(() => ({ tabId: null, x: 0, y: 0, target: null }));

export function beginTabDrag(tabId: string) {
  useTabDrag.setState({ tabId, x: -1, y: -1, target: null });
}

export function updateTabDrag(x: number, y: number) {
  if (useTabDrag.getState().tabId) useTabDrag.setState({ x, y });
}

export function setDropTarget(target: DropTarget | null) {
  const current = useTabDrag.getState().target;
  if (current?.tabId === target?.tabId && current?.side === target?.side) return;
  useTabDrag.setState({ target });
}

/** Ends the drag; true if it was dropped on a split target (the caller then skips its own drop handling). */
export function endTabDrag(): boolean {
  const { tabId, target } = useTabDrag.getState();
  useTabDrag.setState({ tabId: null, target: null });
  if (!tabId || !target) return false;
  dropTabIntoSplit(tabId, target.tabId, target.side);
  return true;
}

export function cancelTabDrag() {
  useTabDrag.setState({ tabId: null, target: null });
}
