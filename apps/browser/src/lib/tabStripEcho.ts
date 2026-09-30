import type { BrowserState } from "../store/browser";

// Chrome reports which of a window's tabs is active (onTabStrip), and that includes echoes of the app's own
// switches: showing a tab makes the engine activate it a moment later (NNWindowHost TabShown), and the tab that is
// still Chrome's active one reports again when its index changes (a tab opened before it). A report for the tab the
// app just left, arriving before Chrome has caught up with the switch, would switch back; the app would show that
// tab again, Chrome would report the next one, and the two could trade switches for as long as the reports lag.
//
// So after the app switches a window's tab, reports that the tabs it left are active are echoes until Chrome
// reports the new tab active (or ECHO_MS passes, for tabs Chrome never reports: internal pages). Once Chrome has
// caught up, a tab it activates is a real switch (an extension's, say), even one the app just left.
export const ECHO_MS = 1000;

type Pending = { left: Set<string>; at: number };
const pending = new Map<string, Pending>();

// Records a window's switches (called on every store update).
export function noteActivations(s: BrowserState, prev: BrowserState, now = Date.now()) {
  if (s.windows === prev.windows) return;
  for (const id in s.windows) {
    const was = prev.windows[id]?.activeTabIds;
    const is = s.windows[id]!.activeTabIds;
    if (!was || was === is) continue;
    for (const profileId in was) {
      const before = was[profileId];
      if (!before || before === is[profileId]) continue;
      const p = pending.get(id);
      const left = p && now - p.at < ECHO_MS ? p.left : new Set<string>();
      left.add(before);
      for (const shown of Object.values(is)) left.delete(shown);
      pending.set(id, { left, at: now });
    }
  }
  for (const id of pending.keys()) if (!s.windows[id]) pending.delete(id);
}

// Chrome reported `tabId` active in `windowId`, whose shown tab is `shownTabId`: an echo, or a real switch?
export function isActivationEcho(windowId: string, tabId: string, shownTabId: string | undefined, now = Date.now()): boolean {
  const p = pending.get(windowId);
  if (!p) return false;
  if (tabId === shownTabId || now - p.at >= ECHO_MS) {
    pending.delete(windowId);
    return false;
  }
  return p.left.has(tabId);
}
