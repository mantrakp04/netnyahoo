import { dragPreview, hapticTick, windowFrame, type DragPreviewShape } from "@netnyahoo/shell";
import { create } from "zustand";
import { focus } from "../../lib/actions";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import type { Frame } from "../../store/types";
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

// Each drag's number: replies that arrive after it ended (its measure, its page's picture) don't touch the next.
let dragSeq = 0;
// The source window's frame as it is now (in full screen the store keeps the restored one).
let liveFrame: Frame | null = null;

export function beginTabDrag(tabId: string | null, tabIds: string[] = tabId ? [tabId] : []): number {
  dragPreview.cancel();
  const windowId = useBrowser.getState().tabs[tabIds[0] ?? ""]?.windowId ?? null;
  useTabDrag.setState({ tabId, tabIds, windowId, x: -1, y: -1, lifted: null, onPage: false, target: null, outside: false, overWindow: null });
  const seq = ++dragSeq;
  liveFrame = null;
  if (windowId)
    void windowFrame(windowId)
      .then((frame) => {
        if (seq === dragSeq) liveFrame = frame;
      })
      .catch(() => {});
  return seq;
}

// `x`, `y`: the pointer in the source window's coordinates.
export function updateTabDrag(x: number, y: number, lifted: boolean | null = null) {
  const drag = useTabDrag.getState();
  if (!drag.tabIds.length || !drag.windowId) return;
  const s = useBrowser.getState();
  const { outside, overWindow } = windowUnder(s, drag.windowId, x, y, liveFrame);
  if (overWindow && overWindow !== drag.overWindow && s.settings.tabReorderHaptics) hapticTick();
  useTabDrag.setState({ x, y, lifted, outside, overWindow });
  syncPreview();
}

// The dragged tab's picture (a native panel, so it can leave the window): the pill over another window's tabs,
// the card over the page or anywhere else outside, nothing while it's still in its list.
function previewShape(d: TabDrag): DragPreviewShape {
  if (!d.tabIds.length) return "hidden";
  if (d.outside) return d.overWindow ? "pill" : "card";
  return (d.lifted ?? d.onPage) ? "card" : "hidden";
}

function syncPreview() {
  const d = useTabDrag.getState();
  if (d.windowId) dragPreview.update(previewShape(d), [d.x, d.y]);
}

/** The dragged item's place in its window (from the top-left) and the pointer's, for its picture. `drag`: the
 * number beginTabDrag gave; a measure that comes back after its drag ended is dropped. */
export function setDragPicture(drag: number, chip: [number, number, number, number], grab: [number, number]) {
  const { windowId, tabId, tabIds } = useTabDrag.getState();
  if (drag !== dragSeq || !windowId || !tabIds.length) return;
  dragPreview.begin(windowId, chip, grab);
  // The pointer may have left the list before the measure came back.
  syncPreview();
  // The window's own snapshot has no web content: the engine paints the page shown (the dragged tab's if it is).
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  const shownTab = tabId && webviews.has(tabId) && tabId === w?.activeTabIds[w.profileId] ? tabId : w?.activeTabIds[w.profileId];
  const view = shownTab ? webviews.get(shownTab) : undefined;
  view
    ?.capturePicture(0.35)
    .then((picture) => {
      if (picture && drag === dragSeq && useTabDrag.getState().tabIds.length) dragPreview.page(picture.data, picture.frame);
    })
    .catch(() => {});
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
  if (useTabDrag.getState().onPage === onPage) return;
  useTabDrag.setState({ onPage });
  syncPreview();
}

const IDLE = { tabId: null, tabIds: [], windowId: null, lifted: null, onPage: false, target: null, outside: false, overWindow: null } as const;

// True when the drop was the page's (a split) or away from the tab's list: outside the window (onto another
// window, or a new one) or, as in Dia, over the page away from a split target (a new window).
export function endTabDrag(): boolean {
  const drag = useTabDrag.getState();
  const { tabId, tabIds, windowId, outside, x, y } = drag;
  const target = resolveTarget ? resolveTarget(x, y, drag.target, outside) : drag.target;
  const onPage = !outside && !!(drag.lifted ?? drag.onPage);
  useTabDrag.setState({ ...IDLE, tabIds: [] });
  dragSeq++;
  if (target && tabId) {
    dragPreview.end();
    dropTabIntoSplit(tabId, target.tabId, target.side);
    return true;
  }
  if (!(outside || onPage) || !windowId || !tabIds.length) {
    dragPreview.end();
    return false;
  }
  const asked: { frame: [number, number, number, number] | null } = { frame: null };
  const moved = dropTabsOutside(tabIds, windowId, x, y, (frame) => (asked.frame = frame), liveFrame);
  // A new window: the picture grows into it.
  dragPreview.end(asked.frame ? moved : null, asked.frame);
  if (moved) focus(moved);
  return true;
}

export function cancelTabDrag() {
  useTabDrag.setState({ ...IDLE, tabIds: [] });
  dragSeq++;
  dragPreview.cancel();
}
