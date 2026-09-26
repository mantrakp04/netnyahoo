import { appUrlOrigin, displayHost } from "@netnyahoo/core";
import type { BrowserState } from "./browser";
import { DEFAULT_PROFILE_ID } from "./settings";
import type { BrowserWindow, Profile, Tab, TabLive, TabSnapshot } from "./types";

/**
 * Pure helpers shared by the slices and selectors. Nothing here calls `set`.
 */

// Ids stay unique across launches (persisted tabs keep theirs): a per-launch
// prefix plus a counter.
const launch = Date.now().toString(36);
let counter = 0;
export const newId = (prefix: string) => `${prefix}-${launch}-${(++counter).toString(36)}`;

let navSeq = 0;
/** A navigation request; a fresh `seq` makes the same URL load again. */
export const navigationTo = (url: string, userInitiated = false) => ({ url, seq: ++navSeq, ...(userInitiated ? { userInitiated } : {}) });

export const incognitoProfileId = (windowId: string) => `incognito:${windowId}`;
export const isIncognitoProfile = (profileId: string) => profileId.startsWith("incognito:");

// Profiles that share another's data (Profile.dataId) → that id. store/profiles keeps it
// current, so the many engineProfile(id) callers need no state.
let sharedDataIds: Record<string, string> = {};
export const setSharedDataIds = (map: Record<string, string>) => {
  sharedDataIds = map;
};

/** The WebView `profile` prop: the engine's default context is "". Profiles sharing data use the other's context. */
export const engineProfile = (profileId: string) => {
  const id = sharedDataIds[profileId] ?? profileId;
  return id === DEFAULT_PROFILE_ID ? "" : id;
};

/** Stand-in shown for incognito windows (they have no real profile). */
export const INCOGNITO_PROFILE: Profile = { id: "incognito", name: "Incognito", color: "neutral", icon: null, createdAt: 0 };

export const IDLE_LIVE: TabLive = {
  isLoading: false,
  progress: 0,
  canGoBack: false,
  canGoForward: false,
  playingAudio: false,
  themeColor: null,
};

export function makeTab(windowId: string, profileId: string, url = "", snapshot?: Partial<TabSnapshot>): Tab {
  const now = Date.now();
  return {
    id: newId("tab"),
    windowId,
    profileId,
    url,
    title: "",
    favicon: null,
    pinned: false,
    muted: false,
    zoom: 1,
    customTitle: null,
    customIcon: null,
    pinnedUrl: null,
    openerId: null,
    ...snapshot,
    navigation: url ? navigationTo(url) : null,
    createdAt: now,
    lastActiveAt: now,
  };
}

export const snapshotTab = (t: Tab): TabSnapshot => ({
  url: t.url,
  title: t.title,
  favicon: t.favicon,
  pinned: t.pinned,
  muted: t.muted,
  zoom: t.zoom,
  customTitle: t.customTitle,
  customIcon: t.customIcon,
  pinnedUrl: t.pinnedUrl,
  profileId: t.profileId,
});

/** Pinned tabs sort before regular ones, keeping relative order. */
export function pinnedFirst(ids: string[], tabs: Record<string, Tab>): string[] {
  return [...ids.filter((id) => tabs[id]?.pinned), ...ids.filter((id) => !tabs[id]?.pinned)];
}

/**
 * Tabs the window shows: its current profile's, in sidebar order. `profileId` asks for
 * another profile's (the page beside it during a profile swipe).
 */
/**
 * Pinned tabs and the tabs of pinned groups: Dia's pinned container. Closing one (⌘W, its ×,
 * a middle-click) unloads its page and keeps its row (store/tabs `unloadPinnedTabs`).
 */
export function inPinnedContainer(s: Pick<BrowserState, "tabs" | "groups">, id: string): boolean {
  const tab = s.tabs[id];
  if (!tab) return false;
  if (tab.pinned) return true;
  for (const g of Object.values(s.groups)) if (g.pinned && g.tabIds.includes(id)) return true;
  return false;
}

export function viewTabIds(s: BrowserState, windowId: string, profileId?: string): string[] {
  const w = s.windows[windowId];
  if (!w) return [];
  const profile = profileId ?? w.profileId;
  return w.tabIds.filter((id) => s.tabs[id]?.profileId === profile);
}

/** The window's selected tab (for `profileId`: the one that profile comes back to). */
export function activeTabId(s: BrowserState, windowId: string, profileId?: string): string | undefined {
  const w = s.windows[windowId];
  if (!w) return undefined;
  const id = w.activeTabIds[profileId ?? w.profileId];
  return id && s.tabs[id]?.windowId === windowId ? id : undefined;
}

export function activeTab(s: BrowserState, windowId: string): Tab | undefined {
  const id = activeTabId(s, windowId);
  return id ? s.tabs[id] : undefined;
}

export function profileFor(s: BrowserState, profileId: string): Profile {
  return isIncognitoProfile(profileId) ? INCOGNITO_PROFILE : (s.profiles[profileId] ?? s.profiles[s.settings.defaultProfileId] ?? INCOGNITO_PROFILE);
}

/** Incognito windows bookmark into the default profile. */
export function bookmarkProfileId(s: BrowserState, window: BrowserWindow | undefined): string {
  return !window || window.incognito ? s.settings.defaultProfileId : window.profileId;
}

/** The window to act on: `id` if it exists, else the last focused one. */
export function resolveWindowId(s: BrowserState, id?: string | null): string | undefined {
  if (id && s.windows[id]) return id;
  return s.ui.focusOrder.find((w) => s.windows[w]) ?? s.windowOrder.find((w) => s.windows[w]);
}

/** Returns `obj` itself when `patch` changes nothing, so subscribers don't re-render. */
export function merge<T extends object>(obj: T, patch: Partial<T>): T {
  for (const key in patch) {
    if (!Object.is(obj[key], patch[key])) return { ...obj, ...patch };
  }
  return obj;
}

export function without<T>(map: Record<string, T>, ids: Iterable<string>): Record<string, T> {
  const next = { ...map };
  for (const id of ids) delete next[id];
  return next;
}

/** "youtube.com" for the window title / menus; falls back to the title or New Tab. */
export function tabLabel(t: Pick<Tab, "url" | "title" | "customTitle">): string {
  if (t.customTitle) return t.customTitle;
  if (!t.url) return "New Tab";
  const app = appUrlOrigin(t.url);
  if (app) return app;
  try {
    const u = new URL(t.url);
    if (u.protocol === "file:") return t.title || decodeURIComponent(u.pathname.split("/").pop() ?? "");
    return displayHost(u.hostname).replace(/^www\./, "") || t.title || t.url;
  } catch {
    return t.title || t.url;
  }
}

export function findLast<T>(list: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i]!)) return list[i];
  return undefined;
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Dia: "Personal — youtube.com & 1 Tab" (profile — current site & the window's other tabs). */
export function windowTitle(s: BrowserState, windowId: string): string {
  const w = s.windows[windowId];
  if (!w) return "";
  const tab = activeTab(s, windowId);
  const others = viewTabIds(s, windowId).length - 1;
  const label = tab ? tabLabel(tab) : "New Tab";
  return `${profileFor(s, w.profileId).name} — ${label}${others > 0 ? ` & ${plural(others, "Tab")}` : ""}`;
}
