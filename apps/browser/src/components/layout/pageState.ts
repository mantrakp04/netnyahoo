import type { BlockedPopup, CrashInfo, MediaAccess, NavigationState, PasswordPrompt, PermissionRequest, SecurityInfo } from "@netnyahoo/cef";
import { create } from "zustand";
import { useBrowser } from "../../store/browser";

/**
 * Per-tab page state the chrome shows but the session never saves: the hovered
 * link, crash / fullscreen state, connection security, blocker counts and the
 * prompts a page is waiting on. Kept out of the main store so a status-text
 * burst doesn't touch it.
 */
export type PageState = {
  /** Hovered link URL (Chrome's status bubble). */
  status: string;
  crashed: CrashInfo | null;
  unresponsive: boolean;
  fullscreen: boolean;
  security: SecurityInfo | null;
  /** Requests the content blocker stopped on this page. */
  blocked: number;
  themeColorSource: NavigationState["themeColorSource"];
  /** window.open()s the pop-up blocker stopped on this page, newest last. */
  popups: BlockedPopup[];
  permission: PermissionRequest | null;
  /** Chrome's password manager wants to save / update a login (components/site/Prompts.tsx). */
  passwordPrompt: PasswordPrompt | null;
  /** Camera / microphone / screen capture in use (the toolbar's recording indicator). */
  mediaAccess: MediaAccess | null;
  /** The tab was showing its New Tab page when its web view was created (see ./history). */
  wasNewTab: boolean;
  /** Back from the web view's first page returns to the New Tab page. */
  backToNewTab: boolean;
  /** Back went to the New Tab page: the page it left, kept alive and hidden for Forward. */
  newTabShown: { url: string; title: string; favicon: string | null } | null;
};

export const IDLE_PAGE: PageState = {
  status: "",
  crashed: null,
  unresponsive: false,
  fullscreen: false,
  security: null,
  blocked: 0,
  themeColorSource: null,
  popups: [],
  permission: null,
  passwordPrompt: null,
  mediaAccess: null,
  wasNewTab: false,
  backToNewTab: false,
  newTabShown: null,
};

type Store = {
  pages: Record<string, PageState>;
  /** Engine browser id → tab (permission requests only carry the browser id). */
  browsers: Record<number, string>;
  /** Which popover is open over a tab's toolbar. */
  popover: Record<string, "siteControls" | "popups" | null>;
};

export const usePages = create<Store>()(() => ({ pages: {}, browsers: {}, popover: {} }));

export function patchPage(tabId: string, patch: Partial<PageState>) {
  usePages.setState((s) => {
    const current = s.pages[tabId] ?? IDLE_PAGE;
    for (const key in patch) {
      if (!Object.is(current[key as keyof PageState], patch[key as keyof PageState])) {
        return { pages: { ...s.pages, [tabId]: { ...current, ...patch } } };
      }
    }
    return s;
  });
}

export const pageOf = (tabId: string | undefined): PageState => (tabId && usePages.getState().pages[tabId]) || IDLE_PAGE;

export function usePage<T>(tabId: string | undefined, select: (p: PageState) => T): T {
  return usePages((s) => select((tabId && s.pages[tabId]) || IDLE_PAGE));
}

export function setBrowserId(tabId: string, browserId: number) {
  usePages.setState((s) => {
    const browsers = { ...s.browsers };
    for (const [id, tab] of Object.entries(browsers)) if (tab === tabId) delete browsers[Number(id)];
    browsers[browserId] = tabId;
    return { browsers };
  });
}

export const tabForBrowser = (browserId: number): string | undefined => usePages.getState().browsers[browserId];

export function setPopover(tabId: string, popover: Store["popover"][string]) {
  usePages.setState((s) => ({ popover: { ...s.popover, [tabId]: popover } }));
}

export const usePopover = (tabId: string | undefined) => usePages((s) => (tabId ? (s.popover[tabId] ?? null) : null));

/** Is any tab of the window showing a page in fullscreen? (The chrome hides.) */
export function useFullscreenTab(windowId: string): string | undefined {
  const tabIds = useBrowser((s) => s.windows[windowId]?.tabIds);
  return usePages((s) => tabIds?.find((id) => s.pages[id]?.fullscreen));
}

// Closed tabs take their page state with them.
useBrowser.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return;
  const { pages, browsers, popover } = usePages.getState();
  const gone = Object.keys(pages).filter((id) => !s.tabs[id]);
  const goneBrowsers = Object.entries(browsers).filter(([, id]) => !s.tabs[id]);
  if (!gone.length && !goneBrowsers.length) return;
  const nextPages = { ...pages };
  const nextPopover = { ...popover };
  for (const id of gone) {
    delete nextPages[id];
    delete nextPopover[id];
  }
  const nextBrowsers = { ...browsers };
  for (const [id] of goneBrowsers) delete nextBrowsers[Number(id)];
  usePages.setState({ pages: nextPages, browsers: nextBrowsers, popover: nextPopover });
});
