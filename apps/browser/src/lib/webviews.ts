import type { WebViewHandle } from "@netnyahoo/cef";

export const webviews = new Map<string, WebViewHandle>();

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
