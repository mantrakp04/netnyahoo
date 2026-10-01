import { dragPreview, hapticTick, windowFrame, type DragPreviewShape } from "@netnyahoo/shell";
import { create } from "zustand";
import { focus } from "../../lib/actions";
import { lastPicture, startTabPictures } from "../../lib/tabPictures";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import type { Frame } from "../../store/types";
import { splitOf, type SplitSide } from "../../store/splits";
import { dropTabIntoSplit } from "./splitActions";
import { dropTabsOutside, screenPoint, windowUnder } from "./windowDrop";

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
  // The pointer in `overWindow`, from its top-left, and where that window's tab strip would put the tab (it makes
  // room there; `beforeId` null is its end).
  overPoint: [number, number] | null;
  insert: { windowId: string; beforeId: string | null } | null;
};

export const useTabDrag = create<TabDrag>()(() => ({
  tabId: null,
  tabIds: [],
  windowId: null,
  x: 0,
  y: 0,
  lifted: null,
  onPage: false,
  target: null,
  outside: false,
  overWindow: null,
  overPoint: null,
  insert: null,
}));

if (__DEV__) (globalThis as { nnTabDrag?: typeof useTabDrag }).nnTabDrag = useTabDrag;

// Background tabs' last pictures, for their drag picture.
startTabPictures();

// Each drag's number: replies that arrive after it ended (its measure, its page's picture) don't touch the next.
let dragSeq = 0;
// The source window's frame as it is now (in full screen the store keeps the restored one).
let liveFrame: Frame | null = null;

export function beginTabDrag(tabId: string | null, tabIds: string[] = tabId ? [tabId] : []): number {
  dragPreview.cancel();
  const windowId = useBrowser.getState().tabs[tabIds[0] ?? ""]?.windowId ?? null;
  useTabDrag.setState({ ...IDLE, tabId, tabIds, windowId, x: -1, y: -1 });
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
  const screen = overWindow ? screenPoint(s, drag.windowId, x, y, liveFrame) : null;
  const over = overWindow ? s.windows[overWindow]?.frame : null;
  const overPoint: [number, number] | null = screen && over ? [screen[0] - over[0], over[1] + over[3] - screen[1]] : null;
  const insert = drag.insert?.windowId === overWindow ? drag.insert : null;
  useTabDrag.setState({ x, y, lifted, outside, overWindow, overPoint, insert });
  syncPreview();
}

// Each window's tab strip, for where the drop lands at the very pointer (its last move may not be drawn yet).
const insertResolvers = new Map<string, (point: [number, number]) => string | null | undefined>();
export function setInsertResolver(windowId: string, resolver: ((point: [number, number]) => string | null | undefined) | null) {
  if (resolver) insertResolvers.set(windowId, resolver);
  else insertResolvers.delete(windowId);
}

/** The tab strip of the window under the pointer: where it would put the tab (null: it isn't over the strip). */
export function setInsert(windowId: string, beforeId: string | null | undefined) {
  const { overWindow, insert } = useTabDrag.getState();
  const next = overWindow === windowId && beforeId !== undefined ? { windowId, beforeId } : null;
  if (insert?.windowId === next?.windowId && insert?.beforeId === next?.beforeId) return;
  if (!next && insert?.windowId !== windowId) return;
  useTabDrag.setState({ insert: next });
  syncPreview();
}

// The dragged tab's picture (a native panel, so it can leave the window): the pill over another window's tab
// strip (which makes room for it), the card over a page or anywhere else outside, nothing in its own list.
function previewShape(d: TabDrag): DragPreviewShape {
  if (!d.tabIds.length) return "hidden";
  if (d.outside) return d.overWindow && d.insert?.windowId === d.overWindow ? "pill" : "card";
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
  // The window's own snapshot has no web content: the engine paints the dragged tab's page if it's on screen; a
  // tab in the background shows its last picture (tabPictures.ts), or its icon and title. A selection or a split
  // shows the window's page.
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  const active = w?.activeTabIds[w.profileId];
  const shown = tabId ?? active;
  // Only a page on screen is painted: a background tab would wait out the capture's deadline.
  const onScreen = !!shown && (shown === active || !!splitOf(s, active)?.tabIds.includes(shown));
  const live = (onScreen && webviews.get(shown)?.capturePicture(0.35).catch(() => null)) || Promise.resolve(null);
  void live.then((picture) => {
    if (drag !== dragSeq || !useTabDrag.getState().tabIds.length) return;
    if (picture) return dragPreview.page(picture.data, picture.frame);
    // On screen with no web page (a New Tab page): the window's own snapshot already shows it.
    if (!shown || onScreen) return;
    const last = lastPicture(shown);
    if (last) return dragPreview.page(last.data, last.frame);
    const tab = useBrowser.getState().tabs[shown];
    if (tab) dragPreview.placeholder(tab.customTitle || tab.title || tab.url || "New Tab", tab.favicon);
  });
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

const IDLE = {
  tabId: null,
  tabIds: [],
  windowId: null,
  lifted: null,
  onPage: false,
  target: null,
  outside: false,
  overWindow: null,
  overPoint: null,
  insert: null,
} as const;

// True when the drop was the page's (a split) or away from the tab's list: outside the window (onto another
// window, or a new one) or, as in Dia, over the page away from a split target (a new window).
export function endTabDrag(): boolean {
  const drag = useTabDrag.getState();
  const { tabId, tabIds, windowId, outside, x, y, overWindow, overPoint } = drag;
  const resolveInsert = overWindow && overPoint ? insertResolvers.get(overWindow) : undefined;
  const insertBefore = resolveInsert ? resolveInsert(overPoint!) : drag.insert?.windowId === overWindow ? drag.insert?.beforeId : undefined;
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
  // Another window's tab strip made room for it: there.
  if (moved && moved === overWindow && insertBefore !== undefined) useBrowser.getState().placeTabs(tabIds, { pinned: false, beforeId: insertBefore });
  if (moved) focus(moved);
  return true;
}

export function cancelTabDrag() {
  useTabDrag.setState({ ...IDLE, tabIds: [] });
  dragSeq++;
  dragPreview.cancel();
}
