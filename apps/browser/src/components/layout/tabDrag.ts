import { hapticTick } from "@netnyahoo/shell";
import { create } from "zustand";
import { focus } from "../../lib/actions";
import { useBrowser } from "../../store/browser";
import type { SplitSide } from "../../store/splits";
import { dropTabIntoSplit } from "./splitActions";
import { dropTabsOutside, windowUnder } from "./windowDrop";

export type DropTarget = { tabId: string; side: SplitSide };

type TabDrag = {
  tabId: string | null;
  tabIds: string[];
  windowId: string | null;
  x: number;
  y: number;
  target: DropTarget | null;
  outside: boolean;
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
