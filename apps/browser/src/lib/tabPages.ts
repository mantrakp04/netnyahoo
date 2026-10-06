import { claimLaunchTab, prepareTabTransfer, releaseTabTransfer } from "@netnyahoo/nncore";
import { isInternalTab } from "../components/pages/urls";
import { useBrowser } from "../store/browser";
import { changedIds } from "../store/changes";
import { earlyLaunchTabOn, launchTab } from "../store/launchTab";
import { engineProfile } from "../store/model";
import type { Tab } from "../store/types";
import { webviews } from "./webviews";

// A tab's web page across its views. A web view can go while its tab stays (the tab moved to another window, its pane
// remounted): the page then waits, parked, for the tab's next view instead of closing with this one, however long that
// takes (NNCoreWebView prepareTransfer). Its loss was a moved tab's page going when its new window mounted late
// (acceptance move-tab-slow-mount). Once the tab no longer wants that page (closed, asleep, on one of the app's own
// pages, in another profile), the app releases it.

/** Whether the tab has a web page: a WebView mounts for it in its window (ContentCard). */
export const wantsPage = (t: Tab | undefined): t is Tab => !!t && !!(t.navigation || t.adoptId) && !isInternalTab(t);

// Tabs whose page was handed off, by the engine profile it belongs to: released when the tab stops wanting it.
const handedOff = new Map<string, string>();

/** The tab's page outlives its current view (a view going, or the tab leaving its window). */
export function handOff(tabId: string, profile: string) {
  handedOff.set(tabId, profile);
  prepareTabTransfer(tabId);
}

/** Before lib/native.ts's sync (startNativeSync), which closes a window the store dropped: store listeners run in the
 *  order they subscribed, so a tab moved out of a window that closes with the move (its last tab) is handed off before
 *  that window's close reaches the main queue (NNCoreWebView keepTransfersOfWindow:). */
export function startTabPages() {
  claimLaunch();
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    for (const id of changedIds(s.tabs, prev.tabs)) {
      const tab = s.tabs[id];
      const before = prev.tabs[id];
      const profile = tab && engineProfile(tab.profileId);
      if (tab && before && tab.windowId !== before.windowId && webviews.has(id) && profile === engineProfile(before.profileId)) handOff(id, profile!);
      const kept = handedOff.get(id);
      if (kept !== undefined && !(wantsPage(tab) && profile === kept)) {
        handedOff.delete(id);
        releaseTabTransfer(id);
      }
    }
  });
}

// The engine started the launch's first page from session.json's hint before the app ran (NNCoreHost): the hydrated
// store says which page its focused window shows. That page waits, parked, for its tab's view as a handed-off one does,
// and is released the same way if the tab stops wanting it first; any other page the engine started closes. Before
// startNativeSync opens the windows, so the claim reaches the main queue ahead of the view.
function claimLaunch() {
  const s = useBrowser.getState();
  const launch = earlyLaunchTabOn() ? launchTab(s, s.ui.focusedWindowId) : null;
  const tab = launch ? s.tabs[launch.id] : undefined;
  const kept = launch && wantsPage(tab) && tab.navigation?.url === launch.url ? launch : null;
  if (kept) handedOff.set(kept.id, kept.profile);
  claimLaunchTab(kept?.id ?? "", kept?.url ?? "", kept?.profile ?? "");
}
