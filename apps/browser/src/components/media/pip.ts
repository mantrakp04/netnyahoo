import { setDisplayMediaPicker } from "@netnyahoo/nncore";
import { onAppEvent, onWindowEvent } from "@netnyahoo/shell";
import { useRef } from "react";
import { webviews } from "../../lib/webviews";
import { useBrowser, type BrowserState } from "../../store/browser";
import { useSettings } from "../../store/hooks";
import { viewTabIds } from "../../store/model";
import { pageOf, usePage } from "../layout/pageState";
import { startCast } from "./cast";
import { startTabShareCleanup } from "./ShareBar";
import { cancelDisplayMediaOnNavigation } from "./SharePicker";
import { exitPictureInPicture, inPictureInPicture, isPlaying, isTabShown, setPip, useMedia } from "./state";

const eligible = (tabId: string) => !!useBrowser.getState().live[tabId]?.playingAudio || !!pageOf(tabId).mediaAccess;

export function useAutoPictureInPicture(tabId: string, visible: boolean): boolean {
  const enabled = useSettings((s) => s.autoPictureInPicture ?? true);
  const audible = useBrowser((s) => !!s.live[tabId]?.playingAudio);
  const capturing = usePage(tabId, (p) => !!p.mediaAccess);
  const decided = useRef(false);
  if (visible) decided.current = enabled && (audible || capturing);
  return decided.current;
}

const LOCK_GRACE_MS = 3000;
let started = false;

// Tabs whose Picture in Picture window the user closed while the tab was out of view. The page doesn't pop out on
// its own again until the user has seen the tab and left it again.
const closedByUser = new Set<string>();
const windowVisible = new Map<string, boolean>();
const inView = (s: BrowserState, tabId: string) =>
  isTabShown(s, tabId) && windowVisible.get(s.tabs[tabId]?.windowId ?? "") !== false;

// A tab the user sees again takes its video back from Picture in Picture, however it got there (our auto PiP or
// menus, or the page's own button): the page reports every window it opens (`pipOpen`), and `pip` covers our own
// requests until it does.
const inPictureInPictureTabs = () => {
  const { pip, pipOpen } = useMedia.getState();
  return new Set([...Object.keys(pip), ...Object.keys(pipOpen)]);
};

export function startMedia() {
  if (started) return;
  started = true;
  void setDisplayMediaPicker(true);
  cancelDisplayMediaOnNavigation();
  startTabShareCleanup();
  startCast();

  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows && s.splits === prev.splits) return;
    for (const tabId of closedByUser) {
      if (!s.tabs[tabId] || (isTabShown(s, tabId) && !isTabShown(prev, tabId))) closedByUser.delete(tabId);
    }
    for (const tabId of inPictureInPictureTabs()) {
      if (isTabShown(s, tabId) && !isTabShown(prev, tabId)) exitPictureInPicture(tabId);
    }
  });

  useMedia.subscribe((m, prev) => {
    if (m.pipOpen === prev.pipOpen) return;
    const s = useBrowser.getState();
    for (const tabId of Object.keys(prev.pipOpen)) if (!m.pipOpen[tabId] && !inView(s, tabId)) closedByUser.add(tabId);
  });

  let lockedAt = 0;
  onAppEvent((e) => {
    if (e.type === "screenLocked") lockedAt = Date.now();
  });

  onWindowEvent((e) => {
    if (e.type !== "occlusion") return;
    windowVisible.set(e.id, e.visible);
    const s = useBrowser.getState();
    const tabs = viewTabIds(s, e.id).filter((id) => isTabShown(s, id));
    if (e.visible) {
      const pip = inPictureInPictureTabs();
      for (const tabId of tabs) {
        closedByUser.delete(tabId);
        if (pip.has(tabId)) exitPictureInPicture(tabId);
      }
      return;
    }
    // Screen lock hides every window; it does not mean the user left the video.
    if (!(s.settings.autoPictureInPicture ?? true) || Date.now() - lockedAt < LOCK_GRACE_MS) return;
    for (const tabId of tabs) {
      // Picture in Picture would take the video out of its element full screen.
      if (pageOf(tabId).fullscreen) continue;
      const session = useMedia.getState().sessions[tabId];
      if (closedByUser.has(tabId) || !session?.hasVideo || !isPlaying(session) || !eligible(tabId)) continue;
      void (async () => {
        if (await inPictureInPicture(tabId)) return;
        if (await webviews.get(tabId)?.requestPictureInPicture()) setPip(tabId, "auto");
      })();
    }
  });
}
