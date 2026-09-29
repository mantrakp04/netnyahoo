import { webviews } from "./webviews";

export function setZoom(tabId: string, direction: -1 | 0 | 1) {
  void webviews.get(tabId)?.zoomStep(direction);
}
