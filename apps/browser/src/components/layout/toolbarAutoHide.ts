import { create } from "zustand";
import { useBrowser, type BrowserState } from "../../store/browser";
import { DEFAULT_WINDOW_UI } from "../../store/ui";

// The toolbar that tucks away while you read, with tabs across the top: scrolling the page down collapses it to a thin
// strip that keeps the site's name; scrolling up, the top of the page, a tab switch, a navigation or a click on the
// strip brings it back. The direction comes from the page (page_script.js › Scroll direction).

// The collapsed strip's height; the page gets the rest of the toolbar's back.
export const STRIP_HEIGHT = 20;

export type PageScroll = "down" | "up" | "top";
export type ToolbarMode = "shown" | "collapsed" | "peek";

type Store = {
  // Tabs whose page last scrolled down (since the bar was last brought back).
  scrolledDown: Record<string, true>;
  // Tabs whose collapsed bar the pointer is resting on: it draws over the page without moving it.
  peek: Record<string, true>;
};

export const useToolbarAutoHide = create<Store>()(() => ({ scrolledDown: {}, peek: {} }));

const without = (map: Record<string, true>, tabId: string) => {
  if (!map[tabId]) return map;
  const next = { ...map };
  delete next[tabId];
  return next;
};

export function noteScroll(tabId: string, data: unknown) {
  const state = (data as { state?: unknown } | null)?.state;
  if (state !== "down" && state !== "up" && state !== "top") return;
  useToolbarAutoHide.setState((s) => {
    // The page moved under a peeking bar: it goes with the scroll.
    const peek = without(s.peek, tabId);
    const scrolledDown =
      state === "down" ? (s.scrolledDown[tabId] ? s.scrolledDown : { ...s.scrolledDown, [tabId]: true as const }) : without(s.scrolledDown, tabId);
    return scrolledDown === s.scrolledDown && peek === s.peek ? s : { scrolledDown, peek };
  });
}

// Brings the bar back until the page next scrolls down (tab switch, navigation, a click on the strip).
export function revealToolbar(tabId: string) {
  useToolbarAutoHide.setState((s) => {
    const scrolledDown = without(s.scrolledDown, tabId);
    const peek = without(s.peek, tabId);
    return scrolledDown === s.scrolledDown && peek === s.peek ? s : { scrolledDown, peek };
  });
}

export function setToolbarPeek(tabId: string, on: boolean) {
  useToolbarAutoHide.setState((s) => {
    if (!!s.peek[tabId] === on) return s;
    return { peek: on ? { ...s.peek, [tabId]: true } : without(s.peek, tabId) };
  });
}

export type ToolbarModeInput = {
  // The setting, the layout (tabs on top) and a toolbar to hide (not the sidebar's address bar, Small Yahu or fullscreen).
  enabled: boolean;
  // A page with an address: the New Tab page and the app's own pages keep the bar.
  hasPage: boolean;
  scrolledDown: boolean;
  peek: boolean;
  // Something that needs the bar: the command bar (⌘L), find, a popover or history menu anchored to it.
  needsBar: boolean;
};

export function toolbarMode(i: ToolbarModeInput): ToolbarMode {
  if (!i.enabled || !i.hasPage || !i.scrolledDown || i.needsBar) return "shown";
  return i.peek ? "peek" : "collapsed";
}

export function needsBar(s: BrowserState, tabId: string, windowId: string): boolean {
  return !!(s.windowUi[windowId] ?? DEFAULT_WINDOW_UI).panel.open || !!s.find[tabId]?.open;
}

// Forget closed tabs.
useBrowser.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return;
  const { scrolledDown, peek } = useToolbarAutoHide.getState();
  const gone: string[] = [];
  // Allocates nothing while every entry still has its tab: this runs on every tab update.
  for (const id in scrolledDown) if (!s.tabs[id]) gone.push(id);
  for (const id in peek) if (!s.tabs[id]) gone.push(id);
  if (!gone.length) return;
  useToolbarAutoHide.setState((st) => {
    let { scrolledDown: d, peek: p } = st;
    for (const id of gone) {
      d = without(d, id);
      p = without(p, id);
    }
    return { scrolledDown: d, peek: p };
  });
});
