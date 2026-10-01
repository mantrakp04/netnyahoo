import { useBrowser, type BrowserState } from "../../store/browser";
import type { Frame } from "../../store/types";


// `live`: the window's frame now, when the store's isn't (it keeps the restored frame in full screen).
export function screenPoint(s: BrowserState, windowId: string, x: number, y: number, live?: Frame | null): [number, number] | null {
  const frame = live ?? s.windows[windowId]?.frame;
  if (!frame) return null;
  return [frame[0] + x, frame[1] + frame[3] - y];
}

const contains = (frame: Frame, [px, py]: [number, number]) => px >= frame[0] && px <= frame[0] + frame[2] && py >= frame[1] && py <= frame[1] + frame[3];

export function windowUnder(s: BrowserState, source: string, x: number, y: number, live?: Frame | null): { outside: boolean; overWindow: string | null } {
  const from = s.windows[source];
  const frame = live ?? from?.frame;
  const outside = !!frame && (x < 0 || y < 0 || x > frame[2] || y > frame[3]);
  const point = outside ? screenPoint(s, source, x, y, live) : null;
  if (!point || !from || from.incognito) return { outside, overWindow: null };
  const overWindow = s.ui.focusOrder.find((id) => {
    const w = s.windows[id];
    return !!w && id !== source && !w.incognito && w.kind !== "small" && !!w.frame && contains(w.frame, point);
  });
  return { outside, overWindow: overWindow ?? null };
}

// `onNewWindow`: the frame a new window gets, before it opens (the dragged tab's picture grows into it).
export function dropTabsOutside(
  tabIds: string[],
  source: string,
  x: number,
  y: number,
  onNewWindow?: (frame: Frame) => void,
  live?: Frame | null,
): string | null {
  const s = useBrowser.getState();
  const from = s.windows[source];
  if (!from || from.incognito || !tabIds.length) return null;
  const { overWindow } = windowUnder(s, source, x, y, live);
  if (overWindow) {
    s.moveTabsToWindow(tabIds, overWindow);
    return overWindow;
  }
  const point = screenPoint(s, source, x, y, live);
  if (!point || from.tabIds.every((id) => tabIds.includes(id))) return null;
  const [, , width, height] = from.frame ?? [0, 0, 1200, 800];
  const frame: Frame = [Math.round(point[0] - 90), Math.round(point[1] - height + 70), width, height];
  onNewWindow?.(frame);
  return s.createWindow({ profileId: s.tabs[tabIds[0]!]?.profileId, tabIds, frame });
}
