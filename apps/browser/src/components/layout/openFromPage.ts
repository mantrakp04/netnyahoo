import type { OpenWindowRequest } from "@netnyahoo/nncore";
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
  // Links stay in Small Yahu; new tabs (target=_blank, ⌘-click, split) open behind, in a main window.
  if (isSmall(s, w.id) && disposition !== "window" && disposition !== "incognito") {
    return void s.newTab(w.id, { url, adoptId, openerId: from.tabId, profileId: from.profileId, background: true });
  }
  if (disposition === "split") {
    if (from.tabId) return openLinkInSplit(from.tabId, url, adoptId);
    openSplitPane(w.id, { url, adoptId });
    return;
  }
  if (disposition === "incognito") {
    // A private tab Chrome already made (an extension's incognito window, Open Link in Incognito Window) moves in
    // live; anything else loads afresh in the private window.
    if (adoptId?.startsWith("tab:")) return void openWindow({ incognito: true, url, adoptId });
    return void openWindow({ incognito: true, url });
  }
  // A private window's new window is private too: a session of its own, so the page loads afresh there.
  if (disposition === "window") {
    return void openWindow(w.incognito ? { incognito: true, url } : { profileId: from.profileId, url, adoptId });
  }
  const background = disposition === "background";
  s.newTab(w.id, { url, adoptId, openerId: from.tabId, profileId: from.profileId, background });
}

// The store profile of a page outside tabs (an extension popup or side panel): its engine profile's.
export function pageProfileId(windowId: string, pageProfile: string): string {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (w && engineProfile(w.profileId) === pageProfile) return w.profileId;
  return s.profileOrder.find((p) => engineProfile(p) === pageProfile) ?? w?.profileId ?? s.settings.defaultProfileId;
}
