import type { TabStripPlace } from "@netnyahoo/cef";

// Chrome reports which of a window's tabs is active (onTabStrip), and that includes echoes of the app's own
// switches: showing a tab makes the engine activate it a moment later (NNWindowHost TabShown), and the tab that is
// still Chrome's active one reports again when its index changes (a tab opened before it). Taking an echo for a
// switch would switch back to a tab the app just left.
//
// The engine says which reports are which: `activated` when Chrome has just made the tab active (an index change
// of the tab that already was isn't), `byApp` when the app's own request did it. Only an activation the app didn't
// ask for is a switch (an extension's, say, or Chrome's own), even to a tab the app just left.
export const isChromeSwitch = (tabId: string, shownTabId: string | undefined, place: TabStripPlace) =>
  place.active && place.activated && !place.byApp && tabId !== shownTabId;
