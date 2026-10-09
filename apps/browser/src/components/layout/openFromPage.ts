import type { OpenWindowRequest } from "@arcadia/arcadiacore";
import { openWindow } from "../../lib/actions";
import { useBrowser } from "../../store/browser";
import { engineProfile } from "../../store/model";
import { isSmall, originalProfile, privateWindowProfile } from "../../store/small";
import { openLinkInSplit, openSplitPane } from "./splitActions";

// Where a page's new tab, window or split goes (the engine's openWindow): one place for tabs, extension
// popups and side panels. `tabId` is the page's tab, the new tab's opener; extension pages have none.
export function openFromPage({ url, adoptId, disposition, profile }: OpenWindowRequest, from: { windowId: string; profileId: string; tabId?: string }) {
  const s = useBrowser.getState();
  const w = s.windows[from.windowId];
  if (!w) return;
  if (disposition === "current") {
    if (from.tabId) s.navigate(from.tabId, url, { userInitiated: false });
    return;
  }
  // Links stay in Little Arcadia; new tabs (target=_blank, ⌘-click, split) open behind, in a main window.
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
    // live, in a private window of the profile it's off the record of (`profile`, the engine's name); anything else
    // loads afresh in a private window of the page's profile.
    const profileId = privateWindowProfile(s, w, profile);
    if (adoptId?.startsWith("tab:")) return void openWindow({ incognito: true, url, adoptId, profileId });
    return void openWindow({ incognito: true, url, profileId });
  }
  // A private window's new window is private too, in its session: the page loads afresh there.
  if (disposition === "window") {
    return void openWindow(w.incognito ? { incognito: true, url, profileId: originalProfile(s, w) } : { profileId: from.profileId, url, adoptId });
  }
  // A page of a Space the window isn't showing never brings it back: its tab opens behind (a stray drop on a page
  // painting unseen once opened the dropped link in the next Space, and the window went there).
  const background = disposition === "background" || from.profileId !== w.profileId;
  s.newTab(w.id, { url, adoptId, openerId: from.tabId, profileId: from.profileId, background });
}

// The store profile of a page outside tabs (an extension popup or side panel): its engine profile's.
export function pageProfileId(windowId: string, pageProfile: string): string {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (w && engineProfile(w.profileId) === pageProfile) return w.profileId;
  return s.profileOrder.find((p) => engineProfile(p) === pageProfile) ?? w?.profileId ?? s.settings.defaultProfileId;
}
