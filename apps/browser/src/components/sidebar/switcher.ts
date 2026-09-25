import { useBrowser } from "../../store/browser";
import { recentTabIds } from "../../store/organize";
import { setSidebarUi, sidebarUi } from "./state";

/**
 * ⌃Tab / ⌃⇧Tab: Dia's recent-tab switcher. The first press picks the previous
 * tab (most recently used order); more presses move on; releasing ⌃ switches.
 * The overlay only appears if ⌃ is held a moment, so a quick ⌃Tab just flips
 * between the last two tabs.
 */
const SHOW_AFTER_MS = 140;
/** In case ⌃'s release is never reported (e.g. focus left the app mid-switch). */
const GIVE_UP_AFTER_MS = 6000;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let giveUpTimer: ReturnType<typeof setTimeout> | undefined;

export function switcherStep(windowId: string, backward: boolean) {
  const current = sidebarUi().switcher;
  clearTimeout(giveUpTimer);
  giveUpTimer = setTimeout(commitSwitcher, GIVE_UP_AFTER_MS);
  if (current && current.windowId === windowId) {
    const n = current.ids.length;
    return setSidebarUi({ switcher: { ...current, index: (current.index + (backward ? -1 : 1) + n) % n } });
  }
  const ids = recentTabIds(useBrowser.getState(), windowId);
  if (ids.length < 2) return;
  setSidebarUi({ switcher: { windowId, ids, index: backward ? ids.length - 1 : 1, visible: false } });
  clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    const s = sidebarUi().switcher;
    if (s) setSidebarUi({ switcher: { ...s, visible: true } });
  }, SHOW_AFTER_MS);
}

/** ⌃ released (or a row clicked): switch to the highlighted tab. */
export function commitSwitcher(index?: number) {
  clearTimeout(showTimer);
  clearTimeout(giveUpTimer);
  const s = sidebarUi().switcher;
  if (!s) return;
  setSidebarUi({ switcher: null });
  const id = s.ids[index ?? s.index];
  if (id && useBrowser.getState().tabs[id]) useBrowser.getState().activate(id);
}

export function cancelSwitcher() {
  clearTimeout(showTimer);
  clearTimeout(giveUpTimer);
  setSidebarUi({ switcher: null });
}
