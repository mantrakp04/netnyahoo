import type { Download } from "@netnyahoo/nncore";
import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { engineProfile, isIncognitoProfile, privateSession } from "./model";
import { originalProfile } from "./small";
import type { FindState, WindowUi } from "./types";

export type UiSlice = {
  ui: {
    focusedWindowId: string | null;
    focusOrder: string[];
    appDark: boolean;
    // The regular profile of the window used last (store/small.ts lastActiveProfile).
    lastProfileId: string | null;
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

// The private session a download is in (the engine names its regular profile and says it's off the record), or null.
export function downloadSession(d: Pick<Download, "profile" | "offTheRecord">): string | null {
  if (d.offTheRecord) return d.profile ?? "";
  return d.profile && isIncognitoProfile(d.profile) ? privateSession(d.profile) : null;
}

// A window lists its profile's downloads, as Chrome's per-profile list: a private window its session's (every private
// window of its profile's), a regular one the regular downloads of the profile it shows (an older one with no profile:
// Personal's).
export function downloadVisibleIn(d: Pick<Download, "profile" | "offTheRecord">, window: { incognito: boolean; profileId: string } | undefined): boolean {
  if (!window) return false;
  const session = downloadSession(d);
  if (window.incognito) return session !== null && session === privateSession(window.profileId);
  return session === null && (d.profile ?? "") === engineProfile(window.profileId);
}

const sessionOpen = (s: Pick<BrowserState, "windows">, session: string) =>
  Object.values(s.windows).some((w) => w.incognito && privateSession(w.profileId) === session);
// Downloads of private sessions that ended: a late update never brings one into the profile's next session.
const endedPrivateDownloads = new Set<string>();

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
  ui: { focusedWindowId: null, focusOrder: [], appDark: true, lastProfileId: null },
  windowUi: {},
  find: {},
  downloads: [],

  setFocusedWindow(id) {
    const s = get();
    const { ui, windows } = s;
    if (!windows[id]) return;
    // The store may already call it focused (it opened, or the one in front closed) before the window says it's key.
    const lastProfileId = originalProfile(s, windows[id]) ?? ui.lastProfileId;
    if (ui.focusedWindowId === id && ui.lastProfileId === lastProfileId) return;
    set({ ui: { ...ui, focusedWindowId: id, focusOrder: [id, ...ui.focusOrder.filter((w) => w !== id)], lastProfileId } });
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
      // A private session's downloads leave with its last window; the engine's late "cancelled" update mustn't bring one
      // back.
      const session = downloadSession(d);
      if (!exists && session !== null && (!sessionOpen(s, session) || endedPrivateDownloads.has(d.id))) {
        endedPrivateDownloads.add(d.id);
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
    // A private profile id: its whole session's.
    const session = privateSession(profile);
    const gone = (d: Download) => (session !== null ? downloadSession(d) === session : d.profile === profile);
    if (session !== null) for (const d of get().downloads) if (gone(d)) endedPrivateDownloads.add(d.id);
    set((s) => (s.downloads.some(gone) ? { downloads: s.downloads.filter((d) => !gone(d)) } : {}));
  },
});
