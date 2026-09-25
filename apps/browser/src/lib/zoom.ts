import { webviews } from "./webviews";

/**
 * ⌘+ / ⌘- / ⌘0 (direction +1 / -1 / 0). The engine keeps zoom per host, like
 * Chrome and Dia, steps along Chrome's ladder, and reports the result through
 * the tab's `onZoom` (which updates `tab.zoom`).
 */
export function setZoom(tabId: string, direction: -1 | 0 | 1) {
  void webviews.get(tabId)?.zoomStep(direction);
}
