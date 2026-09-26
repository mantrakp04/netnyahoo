import { setSwitcherCapture } from "@netnyahoo/shell";
import { useBrowser } from "../../store/browser";
import { recentTabIds } from "../../store/organize";
import { setSidebarUi, sidebarUi } from "./state";

/**
 * ⌃Tab / ⌃⇧Tab: Dia's recent-tab switcher (RecentTabs). The first press picks the previous
 * tab (most recently used order); more presses, or → and ←, move on; releasing ⌃ switches.
 * The overlay only appears if ⌃ is held a moment, so a quick ⌃Tab just flips between the
 * last two tabs. As in Dia, Esc or a click outside closes it without switching, a click on a
 * row switches to that row, and leaving the app switches to the highlighted tab. While it's
 * up, other keys don't reach the page (setSwitcherCapture).
 */
const SHOW_AFTER_MS = 140;
let showTimer: ReturnType<typeof setTimeout> | undefined;

export function switcherStep(windowId: string, backward: boolean) {
  const current = sidebarUi().switcher;
  if (current && current.windowId === windowId) return moveSwitcher(backward ? -1 : 1);
  const ids = recentTabIds(useBrowser.getState(), windowId);
  if (ids.length < 2) return;
  setSidebarUi({ switcher: { windowId, ids, index: backward ? ids.length - 1 : 1, visible: false } });
  setSwitcherCapture(true);
  clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    const s = sidebarUi().switcher;
    if (s) setSidebarUi({ switcher: { ...s, visible: true } });
  }, SHOW_AFTER_MS);
}

/** ⌃Tab again, → or ←: the next or previous row. */
export function moveSwitcher(step: 1 | -1) {
  const s = sidebarUi().switcher;
  if (s) focusSwitcherRow(s.index + step);
}

/** Highlights a row (wrapping around), as the pointer over it does. */
export function focusSwitcherRow(index: number) {
  const s = sidebarUi().switcher;
  if (!s) return;
  const n = s.ids.length;
  setSidebarUi({ switcher: { ...s, index: (index + n) % n } });
}

/** ⌃ released, a row clicked or the app left: switch to the highlighted tab (or `index`). */
export function commitSwitcher(index?: number) {
  const s = sidebarUi().switcher;
  if (!s) return;
  endSwitcher();
  const id = s.ids[index ?? s.index];
  if (id && useBrowser.getState().tabs[id]) useBrowser.getState().activate(id);
}

/** Esc or a click outside: close without switching. */
export function cancelSwitcher() {
  if (sidebarUi().switcher) endSwitcher();
}

function endSwitcher() {
  clearTimeout(showTimer);
  setSwitcherCapture(false);
  setSidebarUi({ switcher: null });
}
