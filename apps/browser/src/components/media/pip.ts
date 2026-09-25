import { setDisplayMediaPicker } from "@netnyahoo/cef";
import { onAppEvent, onWindowEvent } from "@netnyahoo/shell";
import { useRef } from "react";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import { useSettings } from "../../store/hooks";
import { viewTabIds } from "../../store/model";
import { pageOf, usePage } from "../layout/pageState";
import { cancelDisplayMediaOnNavigation } from "./SharePicker";
import { exitPictureInPicture, inPictureInPicture, isPlaying, isTabShown, setPip, useMedia } from "./state";

/**
 * Dia's automatic Picture in Picture: a video you're watching (or a meeting)
 * pops out when you switch away from its tab or its window gets hidden, and
 * goes back when you return. Settings › Tabs can turn it off.
 *
 * Only videos you'd miss count: ones playing sound, or pages using the camera,
 * microphone or screen. A muted background loop (hero videos) doesn't pop out.
 */
const eligible = (tabId: string) => !!useBrowser.getState().live[tabId]?.playingAudio || !!pageOf(tabId).mediaAccess;

/**
 * The web view's `autoPictureInPicture` prop. The engine acts when the tab is
 * hidden (and on a prop change while hidden), so the value is decided while
 * the tab shows and kept while it's hidden: audio starting in a background tab
 * (or the setting turned on) doesn't pop its video out.
 */
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

/**
 * App-wide media effects, started once: window hidden → PiP, tab or window
 * back → leave PiP; getDisplayMedia() goes through our share picker.
 */
export function startMedia() {
  if (started) return;
  started = true;
  void setDisplayMediaPicker(true);
  cancelDisplayMediaOnNavigation();

  // Returning to a tab closes its PiP window, whoever opened it (the engine's
  // own tab-switch PiP closes itself).
  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows && s.splits === prev.splits) return;
    const { pip } = useMedia.getState();
    for (const tabId of Object.keys(pip)) {
      if (isTabShown(s, tabId) && !isTabShown(prev, tabId)) {
        exitPictureInPicture(tabId);
      }
    }
  });

  // Locking the screen hides every window: that's not "leaving" the video.
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
    if (!(s.settings.autoPictureInPicture ?? true) || Date.now() - lockedAt < LOCK_GRACE_MS) return;
    for (const tabId of tabs) {
      const session = useMedia.getState().sessions[tabId];
      if (!session?.hasVideo || !isPlaying(session) || !eligible(tabId)) continue;
      void (async () => {
        // Already popped out by hand: leave it to the user.
        if (await inPictureInPicture(tabId)) return;
        if (await webviews.get(tabId)?.requestPictureInPicture()) setPip(tabId, "auto");
      })();
    }
  });
}
