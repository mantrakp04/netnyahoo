import { createContext, useContext } from "react";
import { useShallow } from "zustand/react/shallow";
import { isBookmarked } from "./bookmarks";
import { useBrowser } from "./browser";
import { activeTabId, bookmarkProfileId, IDLE_LIVE, profileFor, viewTabIds } from "./model";
import type { Settings } from "./settings";
import type { BrowserWindow, FindState, Profile, Tab, TabLive } from "./types";
import { CLOSED_FIND, DEFAULT_WINDOW_UI } from "./ui";

/**
 * React bindings. Every window renders its own React root with a `windowId`
 * (see index.js), provided through WindowContext; these hooks read that window's
 * slice of the shared store with narrow selectors, so a progress event in one
 * tab only re-renders what shows that tab.
 */
export const WindowContext = createContext<string | null>(null);

/** The window this component renders in. */
export function useWindowId(): string {
  return useContext(WindowContext) ?? useBrowser.getState().ui.focusedWindowId ?? "";
}

export function useWindowField<T>(select: (w: BrowserWindow) => T, fallback: T): T {
  const id = useWindowId();
  return useBrowser((s) => {
    const w = s.windows[id];
    return w ? select(w) : fallback;
  });
}

export const useIsIncognito = () => useWindowField((w) => w.incognito, false);
export const useSidebarOpen = () => useWindowField((w) => w.sidebarOpen, true);
/** The profile id the window shows (`incognito:<id>` in incognito windows). */
export const useWindowProfileId = () => useWindowField((w) => w.profileId, "");

export function useWindowProfile(): Profile {
  const profileId = useWindowProfileId();
  return useBrowser((s) => profileFor(s, profileId));
}

export const useProfiles = (): Profile[] => useBrowser(useShallow((s) => s.profileOrder.map((id) => s.profiles[id]!)));

/** The window's tabs for its current profile, in sidebar order. */
export function useViewTabIds(): string[] {
  const id = useWindowId();
  return useBrowser(useShallow((s) => viewTabIds(s, id)));
}

export function usePinnedTabIds(): string[] {
  const id = useWindowId();
  return useBrowser(useShallow((s) => viewTabIds(s, id).filter((t) => s.tabs[t]!.pinned)));
}

export function useRegularTabIds(): string[] {
  const id = useWindowId();
  return useBrowser(useShallow((s) => viewTabIds(s, id).filter((t) => !s.tabs[t]!.pinned)));
}

export function useActiveTabId(): string | undefined {
  const id = useWindowId();
  return useBrowser((s) => activeTabId(s, id));
}

export function useActiveTab(): Tab | undefined {
  const id = useWindowId();
  return useBrowser((s) => {
    const active = activeTabId(s, id);
    return active ? s.tabs[active] : undefined;
  });
}

export const useIsActiveTab = (tabId: string) => useBrowser((s) => activeTabId(s, s.tabs[tabId]?.windowId ?? "") === tabId);

export const useTab = (tabId: string | undefined): Tab | undefined => useBrowser((s) => (tabId ? s.tabs[tabId] : undefined));

/** Engine state (loading, progress, audio…). Pass `select` to re-render only on what you use. */
export function useTabLive(tabId: string | undefined): TabLive;
export function useTabLive<T>(tabId: string | undefined, select: (live: TabLive) => T): T;
export function useTabLive<T>(tabId: string | undefined, select?: (live: TabLive) => T) {
  return useBrowser((s) => {
    const live = (tabId && s.live[tabId]) || IDLE_LIVE;
    return select ? select(live) : live;
  });
}

export const useFind = (tabId: string | undefined): FindState => useBrowser((s) => (tabId && s.find[tabId]) || CLOSED_FIND);

export function useWindowUi() {
  const id = useWindowId();
  return useBrowser((s) => s.windowUi[id] ?? DEFAULT_WINDOW_UI);
}

export const useSettings = <T>(select: (settings: Settings) => T): T => useBrowser((s) => select(s.settings));

/** Whether `url` is bookmarked in this window's profile (the default profile for incognito). */
export function useIsBookmarked(url: string): boolean {
  const id = useWindowId();
  return useBrowser((s) => isBookmarked(s.bookmarks, bookmarkProfileId(s, s.windows[id]), url));
}
