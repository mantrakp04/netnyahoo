import { onAppEvent } from "@netnyahoo/shell";
import { webviews } from "../../lib/webviews";
import { startLive } from "../../live";
import { useBrowser } from "../../store/browser";
import { commitSwitcher } from "./switcher";

/**
 * App-wide side effects of sidebar features, started once:
 * - web views follow tabs' `muted` (Mute Site / Mute All Tabs change many tabs at once);
 * - abandoned New Tab pages close when you switch apps or lock the screen (Dia 1.38);
 * - releasing ⌃ commits the ⌃Tab switcher;
 * - with Clean Up Daily on, untouched tabs are cleaned up in the background.
 */
const AUTO_CLEAN_EVERY_MS = 30 * 60 * 1000;
let started = false;

export function startSidebarEffects() {
  if (started) return;
  started = true;
  // Live folders and Live Calendar refresh, alert and group meetings in the background (src/live).
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
    if (e.type === "controlReleased") commitSwitcher();
  });

  setInterval(() => {
    const s = useBrowser.getState();
    const hours = s.settings.cleanUpInactiveTabsAfterHours;
    if (hours === null) return;
    for (const id of s.windowOrder) s.cleanUpTabs(id, { inactiveForMs: hours * 3_600_000 });
  }, AUTO_CLEAN_EVERY_MS);
}
