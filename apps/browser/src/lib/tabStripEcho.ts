import type { TabStripPlace } from "@netnyahoo/cef";
import type { BrowserState } from "../store/browser";

// Chrome reports which of a window's tabs is active (onTabStrip), and that includes echoes of the app's own
// switches: showing a tab makes the engine activate it a moment later (NNWindowHost TabShown), and the tab that is
// still Chrome's active one reports again when its index changes (a tab opened before it). Taking an echo for a
// switch would switch back to a tab the app just left.
//
// The engine says which reports are which: `activated` when Chrome has just made the tab active (an index change
// of the tab that already was isn't), `byApp` when the app's own request did it. Only an activation the app didn't
// ask for is a switch (an extension's, say, or Chrome's own), even to a tab the app just left.
export function isChromeSwitch(windowId: string, tabId: string, shownTabId: string | undefined, place: TabStripPlace, now = Date.now()) {
  if (!place.active) return false;
  if (place.activated !== undefined) return tabId !== shownTabId && place.activated && !place.byApp;
  // The shown tab's report is Chrome catching up: isActivationEcho clears the pending echoes on it.
  const echo = isActivationEcho(windowId, tabId, shownTabId, now);
  return !echo && tabId !== shownTabId;
}

// Older native builds say neither, so reports that the tabs the app left are active count as echoes until Chrome
// reports the new tab active, or ECHO_MS passes (for tabs Chrome never reports: internal pages).
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
