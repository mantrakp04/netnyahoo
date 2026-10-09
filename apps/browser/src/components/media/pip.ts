import { setAutoPictureInPicture, setDisplayMediaPicker } from "@arcadia/arcadiacore";
import { useRef } from "react";
import { useBrowser } from "../../store/browser";
import { useStoreWhile } from "../../store/tabWatch";
import { usePages } from "../layout/pageState";
import { startCast } from "./cast";
import { startTabShareCleanup } from "./ShareBar";
import { cancelDisplayMediaOnNavigation } from "./SharePicker";

// Whether a tab's WebView pops its video out when the user leaves it. The native view decides when the user left
// (ArcadiaCoreWebView seenByUser: a tab switch, or the window covered or left for another app, never the window's own
// full-screen transition), opens Picture in Picture, and closes it, however it opened, when the user is back.
// Decided while the tab is shown, so a hidden tab's view doesn't follow the store at all (store/tabWatch.ts).
export function useAutoPictureInPicture(tabId: string, visible: boolean): boolean {
  const enabled = useStoreWhile(useBrowser, visible, (s) => s.settings.autoPictureInPicture ?? true);
  const audible = useStoreWhile(useBrowser, visible, (s) => !!s.live[tabId]?.playingAudio);
  const capturing = useStoreWhile(usePages, visible, (s) => !!s.pages[tabId]?.mediaAccess);
  const decided = useRef(false);
  if (visible) decided.current = enabled && (audible || capturing);
  return decided.current;
}

let started = false;

export function startMedia() {
  if (started) return;
  started = true;
  void setDisplayMediaPicker(true);
  // Chrome's automatic PiP (a call's own window on a tab switch, Dia's behaviour) goes with ours.
  let autoPip: boolean | null = null;
  const syncAutoPip = () => {
    const on = useBrowser.getState().settings.autoPictureInPicture ?? true;
    if (on !== autoPip) void setAutoPictureInPicture((autoPip = on));
  };
  syncAutoPip();
  useBrowser.subscribe(syncAutoPip);
  cancelDisplayMediaOnNavigation();
  startTabShareCleanup();
  startCast();
}
