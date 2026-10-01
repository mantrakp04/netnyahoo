import type { Download } from "@netnyahoo/nncore";
import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { isIncognitoProfile } from "./model";
import type { FindState, WindowUi } from "./types";

export type UiSlice = {
  ui: {
    focusedWindowId: string | null;
    focusOrder: string[];
    appDark: boolean;
  };
  windowUi: Record<string, WindowUi>;
  find: Record<string, FindState>;
  downloads: Download[];

  setFocusedWindow(id: string): void;
  setAppDark(dark: boolean): void;
  openPanel(windowId: string, initialText?: string): void;
  closePanel(windowId: string): void;
  setDownloadsOpen(windowId: string, open: boolean): void;
  setFind(tabId: string, patch: Partial<FindState>): void;
  upsertDownload(d: Download): void;
  removeDownload(id: string): void;
  clearDownloads(windowId?: string): void;
  forgetDownloads(profile: string): void;
};

export function downloadVisibleIn(d: Pick<Download, "profile">, window: { incognito: boolean; profileId: string } | undefined): boolean {
  if (!window) return false;
  const incognito = !!d.profile && isIncognitoProfile(d.profile);
  return window.incognito ? d.profile === window.profileId : !incognito;
}

export const downloadsIn = (s: Pick<BrowserState, "downloads" | "windows">, windowId: string) =>
  s.downloads.filter((d) => downloadVisibleIn(d, s.windows[windowId]));

export const DEFAULT_WINDOW_UI: WindowUi = { panel: { open: false, initialText: "" }, downloadsOpen: false };
export const CLOSED_FIND: FindState = { open: false, query: "", count: null, active: 0 };
const MAX_DOWNLOADS = 100;

function patchWindowUi(s: BrowserState, windowId: string, patch: Partial<WindowUi>): Partial<BrowserState> {
  if (!s.windows[windowId]) return {};
  return { windowUi: { ...s.windowUi, [windowId]: { ...(s.windowUi[windowId] ?? DEFAULT_WINDOW_UI), ...patch } } };
}

export const createUiSlice: StateCreator<BrowserState, [], [], UiSlice> = (set, get) => ({
  ui: { focusedWindowId: null, focusOrder: [], appDark: true },
  windowUi: {},
  find: {},
  downloads: [],

  setFocusedWindow(id) {
    const { ui, windows } = get();
    if (!windows[id] || ui.focusedWindowId === id) return;
    set({ ui: { ...ui, focusedWindowId: id, focusOrder: [id, ...ui.focusOrder.filter((w) => w !== id)] } });
  },

  setAppDark(appDark) {
    if (get().ui.appDark !== appDark) set((s) => ({ ui: { ...s.ui, appDark } }));
  },

  openPanel(windowId, initialText = "") {
    set((s) => patchWindowUi(s, windowId, { panel: { open: true, initialText } }));
  },

  closePanel(windowId) {
    set((s) => patchWindowUi(s, windowId, { panel: { open: false, initialText: "" } }));
  },

  setDownloadsOpen(windowId, downloadsOpen) {
    set((s) => patchWindowUi(s, windowId, { downloadsOpen }));
  },

  setFind(tabId, patch) {
    set((s) => (s.tabs[tabId] ? { find: { ...s.find, [tabId]: { ...(s.find[tabId] ?? CLOSED_FIND), ...patch } } } : {}));
  },

  upsertDownload(d) {
    set((s) => {
      const exists = s.downloads.some((x) => x.id === d.id);
      // A private window's downloads leave with it; the engine's late "cancelled" update mustn't bring one back.
      if (!exists && d.profile && isIncognitoProfile(d.profile) && !Object.values(s.windows).some((w) => w.profileId === d.profile)) {
        return {};
      }
      const downloads = exists ? s.downloads.map((x) => (x.id === d.id ? d : x)) : [d, ...s.downloads].slice(0, MAX_DOWNLOADS);
      const focused = s.ui.focusedWindowId;
      const open = !exists && focused && downloadVisibleIn(d, s.windows[focused]);
      return { downloads, ...(open ? patchWindowUi(s, focused, { downloadsOpen: true }) : {}) };
    });
  },

  removeDownload(id) {
    set((s) => ({ downloads: s.downloads.filter((d) => d.id !== id) }));
  },

  clearDownloads(windowId) {
    set((s) => ({
      downloads: s.downloads.filter((d) => d.state === "downloading" || (windowId !== undefined && !downloadVisibleIn(d, s.windows[windowId]))),
    }));
  },

  forgetDownloads(profile) {
    set((s) => (s.downloads.some((d) => d.profile === profile) ? { downloads: s.downloads.filter((d) => d.profile !== profile) } : {}));
  },
});
