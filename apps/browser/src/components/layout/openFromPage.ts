import type { OpenWindowRequest } from "@netnyahoo/cef";
import { openWindow } from "../../lib/actions";
import { useBrowser } from "../../store/browser";
import { engineProfile } from "../../store/model";
import { isSmall } from "../../store/small";
import { openLinkInSplit, openSplitPane } from "./splitActions";

// Where a page's new tab, window or split goes (the engine's openWindow): one place for tabs, extension
// popups and side panels. `tabId` is the page's tab, the new tab's opener; extension pages have none.
export function openFromPage({ url, adoptId, disposition }: OpenWindowRequest, from: { windowId: string; profileId: string; tabId?: string }) {
  const s = useBrowser.getState();
  const w = s.windows[from.windowId];
  if (!w) return;
  if (disposition === "current") {
    if (from.tabId) s.navigate(from.tabId, url, { userInitiated: false });
    return;
  }
  // A link opened behind (⌘-click, middle-click, Open Link in New Tab) loads when first shown, as in Dia; the
  // engine keeps its navigation (POST body, referrer) until then. A popup Chrome already made loads now.
  const deferred = adoptId?.startsWith("open:") ? { wakeAdoptId: adoptId } : { adoptId };
  // Links stay in Small Yahu; new tabs (target=_blank, ⌘-click, split) open behind, in a main window.
  if (isSmall(s, w.id) && disposition !== "window" && disposition !== "incognito") {
    return void s.newTab(w.id, { url, ...deferred, openerId: from.tabId, profileId: from.profileId, background: true });
  }
  if (disposition === "split") return from.tabId ? openLinkInSplit(from.tabId, url, adoptId) : void openSplitPane(w.id, { url, adoptId });
  if (disposition === "incognito") return void openWindow({ incognito: true, url });
  // A private window's new window is private too: a session of its own, so the page loads afresh there.
  if (disposition === "window") return void openWindow(w.incognito ? { incognito: true, url } : { profileId: from.profileId, url, adoptId });
  const background = disposition === "background";
  s.newTab(w.id, { url, ...(background ? deferred : { adoptId }), openerId: from.tabId, profileId: from.profileId, background });
}

// The store profile of a page outside tabs (an extension popup or side panel): its engine profile's.
export function pageProfileId(windowId: string, pageProfile: string): string {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (w && engineProfile(w.profileId) === pageProfile) return w.profileId;
  return s.profileOrder.find((p) => engineProfile(p) === pageProfile) ?? w?.profileId ?? s.settings.defaultProfileId;
}
