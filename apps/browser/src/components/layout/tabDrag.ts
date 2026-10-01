import { hapticTick } from "@netnyahoo/shell";
import { create } from "zustand";
import { focus } from "../../lib/actions";
import { useBrowser } from "../../store/browser";
import type { SplitSide } from "../../store/splits";
import { dropTabIntoSplit } from "./splitActions";
import { dropTabsOutside, windowUnder } from "./windowDrop";

export type DropTarget = { tabId: string; side: SplitSide };

// One tab drag at a time, from the sidebar or the top strip. The page's split targets (SplitChrome.tsx) read it.
type TabDrag = {
  tabId: string | null;
  tabIds: string[];
  windowId: string | null;
  x: number;
  y: number;
  // The tab has left its list (the strip or the sidebar) for the page: the page shows its split targets.
  // `null` until the source says, and then the page decides by the pointer being over it (the sidebar).
  lifted: boolean | null;
  // The page shows the dragged tab as a card under the pointer (the sidebar hides its own ghost meanwhile).
  onPage: boolean;
  target: DropTarget | null;
  outside: boolean;
  overWindow: string | null;
};

export const useTabDrag = create<TabDrag>()(() => ({ tabId: null, tabIds: [], windowId: null, x: 0, y: 0, lifted: null, onPage: false, target: null, outside: false, overWindow: null }));

if (__DEV__) (globalThis as { nnTabDrag?: typeof useTabDrag }).nnTabDrag = useTabDrag;

export function beginTabDrag(tabId: string | null, tabIds: string[] = tabId ? [tabId] : []) {
  const windowId = useBrowser.getState().tabs[tabIds[0] ?? ""]?.windowId ?? null;
  useTabDrag.setState({ tabId, tabIds, windowId, x: -1, y: -1, lifted: null, onPage: false, target: null, outside: false, overWindow: null });
}

// `x`, `y`: the pointer in the source window's coordinates.
export function updateTabDrag(x: number, y: number, lifted: boolean | null = null) {
  const drag = useTabDrag.getState();
  if (!drag.tabIds.length || !drag.windowId) return;
  const s = useBrowser.getState();
  const { outside, overWindow } = windowUnder(s, drag.windowId, x, y);
  if (overWindow && overWindow !== drag.overWindow && s.settings.tabReorderHaptics) hapticTick();
  useTabDrag.setState({ x, y, lifted, outside, overWindow });
}

export function setDropTarget(target: DropTarget | null) {
  const current = useTabDrag.getState().target;
  if (current?.tabId === target?.tabId && current?.side === target?.side) return;
  useTabDrag.setState({ target });
}

// The page's split target for the pointer where the drag ends: the last move may not have been drawn yet, so a
// target the pointer just left (or the window) mustn't take the drop, and one it just reached should.
let resolveTarget: ((x: number, y: number, current: DropTarget | null, outside: boolean) => DropTarget | null) | null = null;
export function setTargetResolver(resolver: typeof resolveTarget) {
  resolveTarget = resolver;
}

export function setOnPage(onPage: boolean) {
  if (useTabDrag.getState().onPage !== onPage) useTabDrag.setState({ onPage });
}

const IDLE = { tabId: null, tabIds: [], windowId: null, lifted: null, onPage: false, target: null, outside: false, overWindow: null } as const;

// True when the drop was the page's (a split) or outside the window (another window, or a new one).
export function endTabDrag(): boolean {
  const drag = useTabDrag.getState();
  const { tabId, tabIds, windowId, outside, x, y } = drag;
  const target = resolveTarget ? resolveTarget(x, y, drag.target, outside) : drag.target;
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
