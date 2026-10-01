import { forgetOpenedURL, type OpenWindowRequest } from "@netnyahoo/nncore";
import { openWindow } from "../../lib/actions";
import { useBrowser } from "../../store/browser";
import { engineProfile } from "../../store/model";
import { isSmall } from "../../store/small";
import { openLinkInSplit, openSplitPane } from "./splitActions";

// Where a page's new tab, window or split goes (the engine's openWindow): one place for tabs, extension
// popups and side panels. `tabId` is the page's tab, the new tab's opener; extension pages have none.
export function openFromPage({ url, adoptId, disposition, postBody }: OpenWindowRequest, from: { windowId: string; profileId: string; tabId?: string }) {
  const s = useBrowser.getState();
  const w = s.windows[from.windowId];
  if (!w) return releaseKept(adoptId);
  if (disposition === "current") {
    if (from.tabId) s.navigate(from.tabId, url, { userInitiated: false });
    return;
  }
  // A link opened behind (⌘-click, middle-click, Open Link in New Tab) loads when first shown, as in Dia; the
  // engine keeps its navigation (POST body, referrer) until then. A popup Chrome already made loads now.
  // A form's POST loads at once, as Chrome does, so it's never evicted from the engine and resent as a GET.
  const deferred = adoptId?.startsWith("open:") && !postBody ? { wakeAdoptId: adoptId } : { adoptId };
  // Links stay in Small Yahu; new tabs (target=_blank, ⌘-click, split) open behind, in a main window.
  if (isSmall(s, w.id) && disposition !== "window" && disposition !== "incognito") {
    return void s.newTab(w.id, { url, ...deferred, openerId: from.tabId, profileId: from.profileId, background: true });
  }
  if (disposition === "split") {
    if (from.tabId) return openLinkInSplit(from.tabId, url, adoptId);
    if (!openSplitPane(w.id, { url, adoptId })) releaseKept(adoptId);
    return;
  }
  if (disposition === "incognito") {
    // A private tab Chrome already made (an extension's incognito window, Open Link in Incognito Window) moves in
    // live; anything else loads afresh in the private window.
    if (adoptId?.startsWith("tab:")) return void openWindow({ incognito: true, url, adoptId });
    releaseKept(adoptId);
    return void openWindow({ incognito: true, url });
  }
  // A private window's new window is private too: a session of its own, so the page loads afresh there.
  if (disposition === "window") {
    if (w.incognito) releaseKept(adoptId);
    return void openWindow(w.incognito ? { incognito: true, url } : { profileId: from.profileId, url, adoptId });
  }
  const background = disposition === "background";
  s.newTab(w.id, { url, ...(background ? deferred : { adoptId }), openerId: from.tabId, profileId: from.profileId, background });
}

// A navigation the engine kept for a request that won't use it: the engine drops it now.
export function releaseKept(adoptId: string | undefined) {
  if (adoptId?.startsWith("open:")) forgetOpenedURL(Number(adoptId.slice(5)));
}

// The store profile of a page outside tabs (an extension popup or side panel): its engine profile's.
export function pageProfileId(windowId: string, pageProfile: string): string {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (w && engineProfile(w.profileId) === pageProfile) return w.profileId;
  return s.profileOrder.find((p) => engineProfile(p) === pageProfile) ?? w?.profileId ?? s.settings.defaultProfileId;
}
