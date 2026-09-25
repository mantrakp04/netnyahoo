import type { WebViewHandle } from "@netnyahoo/cef";

/** Imperative handles for each tab's web view, keyed by tab id. */
export const webviews = new Map<string, WebViewHandle>();

/**
 * A ref callback for a tab's WebView. When a tab moves between windows its new
 * view (another React root) can mount before the old one unmounts, so only
 * forget the handle this view registered.
 */
export function webviewRef(tabId: string) {
  let mine: WebViewHandle | null = null;
  return (handle: WebViewHandle | null) => {
    if (handle) {
      mine = handle;
      webviews.set(tabId, handle);
    } else if (mine && webviews.get(tabId) === mine) {
      webviews.delete(tabId);
    }
  };
}
