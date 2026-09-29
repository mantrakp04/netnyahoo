import { setDisplayMediaPicker } from "@netnyahoo/cef";
import { onAppEvent, onWindowEvent } from "@netnyahoo/shell";
import { useRef } from "react";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
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

export function startMedia() {
  if (started) return;
  started = true;
  void setDisplayMediaPicker(true);
  cancelDisplayMediaOnNavigation();
  startTabShareCleanup();
  startCast();

  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows && s.splits === prev.splits) return;
    const { pip } = useMedia.getState();
    for (const tabId of Object.keys(pip)) {
      if (isTabShown(s, tabId) && !isTabShown(prev, tabId)) {
        exitPictureInPicture(tabId);
      }
    }
  });

  let lockedAt = 0;
  onAppEvent((e) => {
    if (e.type === "screenLocked") lockedAt = Date.now();
  });

  onWindowEvent((e) => {
    if (e.type !== "occlusion") return;
    const s = useBrowser.getState();
    const tabs = viewTabIds(s, e.id).filter((id) => isTabShown(s, id));
    if (e.visible) {
      for (const tabId of tabs) {
        if (useMedia.getState().pip[tabId] !== "auto") continue;
        exitPictureInPicture(tabId);
      }
      return;
    }
    // Screen lock hides every window; it does not mean the user left the video.
    if (!(s.settings.autoPictureInPicture ?? true) || Date.now() - lockedAt < LOCK_GRACE_MS) return;
    for (const tabId of tabs) {
      const session = useMedia.getState().sessions[tabId];
      if (!session?.hasVideo || !isPlaying(session) || !eligible(tabId)) continue;
      void (async () => {
        if (await inPictureInPicture(tabId)) return;
        if (await webviews.get(tabId)?.requestPictureInPicture()) setPip(tabId, "auto");
      })();
    }
  });
}
