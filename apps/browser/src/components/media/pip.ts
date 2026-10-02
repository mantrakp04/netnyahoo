import { setAutoPictureInPicture, setDisplayMediaPicker } from "@netnyahoo/nncore";
import { useRef } from "react";
import { useBrowser } from "../../store/browser";
import { useSettings } from "../../store/hooks";
import { usePage } from "../layout/pageState";
import { startCast } from "./cast";
import { startTabShareCleanup } from "./ShareBar";
import { cancelDisplayMediaOnNavigation } from "./SharePicker";

// Whether a tab's WebView pops its video out when the user leaves it. The native view decides when the user left
// (NNCoreWebView seenByUser: a tab switch, or the window covered or left for another app, never the window's own
// full-screen transition), opens Picture in Picture, and closes it, however it opened, when the user is back.
export function useAutoPictureInPicture(tabId: string, visible: boolean): boolean {
  const enabled = useSettings((s) => s.autoPictureInPicture ?? true);
  const audible = useBrowser((s) => !!s.live[tabId]?.playingAudio);
  const capturing = usePage(tabId, (p) => !!p.mediaAccess);
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
