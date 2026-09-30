import type { BlockedPopup, CrashInfo, ExternalAppRequest, MediaAccess, NavigationState, PasswordPrompt, PermissionRequest, SecurityInfo } from "@netnyahoo/cef";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { splitOf } from "../../store/splits";

export type PageState = {
  status: string;
  crashed: CrashInfo | null;
  unresponsive: boolean;
  fullscreen: boolean;
  security: SecurityInfo | null;
  blocked: number;
  themeColorSource: NavigationState["themeColorSource"];
  popups: BlockedPopup[];
  permission: PermissionRequest | null;
  passwordPrompt: PasswordPrompt | null;
  externalApp: ExternalAppRequest | null;
  mediaAccess: MediaAccess | null;
  wasNewTab: boolean;
  backToNewTab: boolean;
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
  externalApp: null,
  mediaAccess: null,
  wasNewTab: false,
  backToNewTab: false,
  newTabShown: null,
};

type Store = {
  pages: Record<string, PageState>;
  browsers: Record<number, string>;
  popover: Record<string, "siteControls" | "popups" | "zoom" | null>;
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

// Page (element) fullscreen: only a tab on screen counts, so switching tabs leaves it (the hidden
// web view exits fullscreen natively).
export function useFullscreenTab(windowId: string): string | undefined {
  const shown = useBrowser(
    useShallow((s) => {
      const active = activeTabId(s, windowId);
      return active ? (splitOf(s, active)?.tabIds ?? [active]) : [];
    }),
  );
  return usePages((s) => shown.find((id) => s.pages[id]?.fullscreen));
}

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
