import { onAppEvent } from "@netnyahoo/shell";
import { webviews } from "../../lib/webviews";
import { startLive } from "../../live";
import { useBrowser } from "../../store/browser";
import { cancelSwitcher, commitSwitcher, moveSwitcher } from "./switcher";

const AUTO_CLEAN_EVERY_MS = 30 * 60 * 1000;
let started = false;

export function startSidebarEffects() {
  if (started) return;
  started = true;
  startLive();

  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    for (const id in s.tabs) {
      const muted = s.tabs[id]!.muted;
      if (prev.tabs[id] && prev.tabs[id]!.muted !== muted) void webviews.get(id)?.setMuted(muted);
    }
  });

  onAppEvent((e) => {
    if (e.type === "resignActive" || e.type === "screenLocked") useBrowser.getState().closeAbandonedNewTabs();
    if (e.type === "controlReleased" || e.type === "resignActive") commitSwitcher();
    if (e.type === "switcherMouseUp" || (e.type === "switcherKey" && e.key === "escape")) cancelSwitcher();
    if (e.type === "switcherKey" && e.key !== "escape") moveSwitcher(e.key === "next" ? 1 : -1);
  });

  setInterval(() => {
    const s = useBrowser.getState();
    const hours = s.settings.cleanUpInactiveTabsAfterHours;
    if (hours === null) return;
    for (const id of s.windowOrder) s.cleanUpTabs(id, { inactiveForMs: hours * 3_600_000 });
  }, AUTO_CLEAN_EVERY_MS);
}
