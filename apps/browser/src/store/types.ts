import type { Download } from "@netnyahoo/cef";
import type { Settings } from "./settings";

/**
 * Data model, after Dia: the app has **profiles** (separate cookies/history/
 * bookmarks — Dia's replacement for Spaces) and **windows**. A window shows one
 * profile at a time but can hold tabs of several (switching profile swaps the
 * sidebar to that profile's tabs in the same window). Incognito windows use a
 * throwaway in-memory profile, `incognito:<windowId>`.
 */

/** Cocoa screen frame: [x, y (bottom-left), width, height]. */
export type Frame = [number, number, number, number];

/** Theme colours a profile can use; see PROFILE_THEMES in lib/theme.ts. */
export type ProfileColor = "plum" | "blue" | "purple" | "pink" | "red" | "orange" | "yellow" | "green" | "neutral";

export type Profile = {
  id: string;
  name: string;
  color: ProfileColor;
  /** An emoji, `symbol:<SF Symbol name>`, or null for the default monogram. */
  icon: string | null;
  createdAt: number;
  /**
   * Dia's "Share data with another profile" (chosen when the profile is created): the id
   * whose data this profile uses — engine context (cookies, logins, passwords, extensions,
   * site settings), history and bookmarks. Unset: its own. Tabs stay per profile.
   */
  dataId?: string;
};

export type BrowserWindow = {
  id: string;
  /** The profile whose tabs the window shows (for incognito: `incognito:<id>`). */
  profileId: string;
  incognito: boolean;
  /** Every tab in the window, across profiles, in sidebar order (pinned first). */
  tabIds: string[];
  /** Last active tab per profile, so switching back restores the selection. */
  activeTabIds: Record<string, string>;
  /** False = Auto-Hide Tabs (⌘S): the sidebar slides in on hover. */
  sidebarOpen: boolean;
  /** ⇧⌘S: tabs in the sidebar or in a strip along the top; unset follows Settings. */
  tabLayout?: "sidebar" | "top";
  frame: Frame | null;
  createdAt: number;
};

/** A tab's persistent state. Fast-changing engine state lives in TabLive. */
export type Tab = {
  id: string;
  windowId: string;
  profileId: string;
  /** Last URL the web view reported; "" means the New Tab page. */
  url: string;
  title: string;
  favicon: string | null;
  pinned: boolean;
  muted: boolean;
  /** 1 = 100%. */
  zoom: number;
  /** User-chosen title / emoji (Dia's Rename… / Change Icon…), shown instead of the page's. */
  customTitle: string | null;
  /** An emoji, or `symbol:<SF Symbol name>`. */
  customIcon: string | null;
  /** A pinned tab's base URL (⌘↩ returns to it); null when unpinned. */
  pinnedUrl: string | null;
  /**
   * Explicit navigation request; `seq` changes on every request, even to the same URL.
   * `userInitiated`: the user typed or picked it (the engine then loads a URL that was a
   * download before; restores and remounts leave it off).
   */
  navigation: { url: string; seq: number; userInitiated?: boolean } | null;
  /** A Chromium popup browser to adopt (link opened in a new tab keeps window.opener). */
  adoptId?: string;
  /** The tab whose link opened this one. */
  openerId: string | null;
  /** Opened from a live folder item: the tab shows inside that folder (src/live). */
  liveItem?: { folderId: string; itemId: string };
  createdAt: number;
  /** For MRU switching and cleaning up idle tabs. */
  lastActiveAt: number;
};

/** Engine state that changes often and is never persisted. */
export type TabLive = {
  isLoading: boolean;
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  playingAudio: boolean;
  /** The page's `<meta name="theme-color">`. */
  themeColor: string | null;
};

export type GroupColor = "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";

/**
 * A tab group (Dia's are named, get an emoji, and can be pinned). Members are
 * contiguous in the window's tab order; `tabIds` follows that order.
 */
export type TabGroup = {
  id: string;
  windowId: string;
  profileId: string;
  name: string;
  icon: string | null;
  color: GroupColor | null;
  collapsed: boolean;
  pinned: boolean;
  tabIds: string[];
  createdAt: number;
  /** Made by ⌘-clicking a link: ungroups itself once only one tab is left. */
  autoUngroup?: boolean;
};

/**
 * Up to three tabs shown side by side ("horizontal") or stacked ("vertical").
 * `tabIds` is the panes in reading order. With `stack`, the panes at
 * `stack.index` and `stack.index + 1` share one slot, split the other way
 * (Dia's Add Bottom Split). `sizes` are the top-level slots' fractions (sum 1).
 */
export type SplitView = {
  id: string;
  windowId: string;
  tabIds: string[];
  orientation: "horizontal" | "vertical";
  sizes: number[];
  stack?: { index: number; sizes: [number, number] };
};

export type HistoryEntry = {
  url: string;
  title: string;
  favicon: string | null;
  visits: number;
  lastVisit: number;
  /**
   * When the most recent visits happened (ms epoch, oldest first, at most
   * MAX_VISIT_TIMES), so clearing a time range removes visits, not pages. Older
   * visits are only counted in `visits`. Missing on entries saved before.
   */
  visitTimes?: number[];
};

export type BookmarkNode =
  | { kind: "url"; id: string; parentId: string; title: string; url: string; favicon: string | null; addedAt: number }
  | { kind: "folder"; id: string; parentId: string | null; title: string; children: string[]; addedAt: number };

export type BookmarkFolder = Extract<BookmarkNode, { kind: "folder" }>;

/** Chrome/Dia-style tree: each profile has a Bookmarks Bar and Other Bookmarks root. */
export type Bookmarks = {
  nodes: Record<string, BookmarkNode>;
  roots: Record<string, { bar: string; other: string }>;
};

/** Enough to put a tab back where it was. */
export type TabSnapshot = Pick<
  Tab,
  "url" | "title" | "favicon" | "pinned" | "muted" | "zoom" | "customTitle" | "customIcon" | "profileId"
> &
  Partial<Pick<Tab, "pinnedUrl">>;

export type ClosedTab = {
  kind: "tab";
  id: string;
  tab: TabSnapshot;
  windowId: string;
  /** Position in the window's tab order when it closed. */
  index: number;
  group: Pick<TabGroup, "id" | "name" | "icon" | "color"> | null;
  closedAt: number;
};

export type ClosedWindow = {
  kind: "window";
  id: string;
  window: Pick<BrowserWindow, "profileId" | "sidebarOpen" | "frame">;
  tabs: (TabSnapshot & { active: boolean })[];
  groups: (Omit<TabGroup, "tabIds" | "windowId"> & { tabIndexes: number[] })[];
  closedAt: number;
};

/** A closed tab group (History › Recently Closed Groups). */
export type ClosedGroup = {
  kind: "group";
  id: string;
  group: Pick<TabGroup, "id" | "name" | "icon" | "color" | "pinned">;
  tabs: TabSnapshot[];
  windowId: string;
  /** Position of its first tab in the window's tab order. */
  index: number;
  closedAt: number;
};

export type FindState = {
  open: boolean;
  query: string;
  count: number | null;
  active: number;
  /** Bumped by each ⌘F, so an open find bar refocuses its field. */
  focusRequest?: number;
  /** Edit › Find and Replace (⌥⌘F): the bar's replace row, for the page's focused text field. */
  replace?: boolean;
};

/** The command panel over the toolbar (⌘L / URL click). */
export type PanelState = { open: boolean; initialText: string };

export type WindowUi = { panel: PanelState; downloadsOpen: boolean };

export type { Download, Settings };
