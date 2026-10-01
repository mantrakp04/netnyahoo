
export type Frame = [number, number, number, number];

export type ProfileColor = "plum" | "blue" | "purple" | "pink" | "red" | "orange" | "yellow" | "green" | "neutral";

export type Profile = {
  id: string;
  name: string;
  color: ProfileColor;
  icon: string | null;
  createdAt: number;
  dataId?: string;
};

export type BrowserWindow = {
  id: string;
  profileId: string;
  incognito: boolean;
  tabIds: string[];
  activeTabIds: Record<string, string>;
  sidebarOpen: boolean;
  tabLayout?: "sidebar" | "top";
  frame: Frame | null;
  createdAt: number;
  // Small Yahu (Arc's Little Arc): one page, no sidebar, never saved with the session (store/small.ts).
  kind?: "small";
};

export type Tab = {
  id: string;
  windowId: string;
  profileId: string;
  url: string;
  title: string;
  favicon: string | null;
  pinned: boolean;
  muted: boolean;
  zoom: number;
  customTitle: string | null;
  customIcon: string | null;
  pinnedUrl: string | null;
  // `opened`: load the navigation the engine kept for a link ("open:<id>": POST body, referrer) instead, if it can.
  navigation: { url: string; seq: number; userInitiated?: boolean; opened?: number } | null;
  adoptId?: string;
  openerId: string | null;
  // What a tab that hasn't loaded adopts when first shown (store/model.ts wake): a reopened window's tab
  // "restore:<closed tab>" (its back/forward list), a link opened behind "open:<id>" (its POST body, referrer).
  wakeAdoptId?: string;
  liveItem?: { folderId: string; itemId: string };
  unloaded?: boolean;
  createdAt: number;
  lastActiveAt: number;
};

export type TabLive = {
  isLoading: boolean;
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  playingAudio: boolean;
  themeColor: string | null;
  /** The page the tab last counted as a history visit: a title or icon update of it isn't another visit. */
  visitedUrl?: string;
};

export type GroupColor = "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";

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
  autoUngroup?: boolean;
  // The pinned tab whose links, opened behind, this group collects (Dia: they gather below the pinned tabs).
  pinnedOpenerId?: string;
};

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
  visitTimes?: number[];
};

export type BookmarkNode =
  | { kind: "url"; id: string; parentId: string; title: string; url: string; favicon: string | null; addedAt: number }
  | { kind: "folder"; id: string; parentId: string | null; title: string; children: string[]; addedAt: number };

export type BookmarkFolder = Extract<BookmarkNode, { kind: "folder" }>;

export type Bookmarks = {
  nodes: Record<string, BookmarkNode>;
  roots: Record<string, { bar: string; other: string }>;
};

export type TabSnapshot = Pick<
  Tab,
  "url" | "title" | "favicon" | "pinned" | "muted" | "zoom" | "customTitle" | "customIcon" | "profileId"
> &
  Partial<Pick<Tab, "pinnedUrl">>;

export type ClosedTab = {
  kind: "tab";
  id: string;
  tab: TabSnapshot;
  tabId?: string;
  windowId: string;
  index: number;
  group: Pick<TabGroup, "id" | "name" | "icon" | "color"> | null;
  closedAt: number;
  pinnedTile?: boolean;
  small?: boolean;
};

export type ClosedWindow = {
  kind: "window";
  id: string;
  window: Pick<BrowserWindow, "profileId" | "sidebarOpen" | "frame">;
  tabs: (TabSnapshot & { active: boolean; tabId?: string })[];
  groups: (Omit<TabGroup, "tabIds" | "windowId"> & { tabIndexes: number[] })[];
  closedAt: number;
};

export type ParkedPins = {
  tabs: (TabSnapshot & { id: string; groupId: string | null })[];
  groups: Pick<TabGroup, "id" | "name" | "icon" | "color" | "collapsed">[];
};

export type ClosedGroup = {
  kind: "group";
  id: string;
  group: Pick<TabGroup, "id" | "name" | "icon" | "color" | "pinned">;
  tabs: TabSnapshot[];
  windowId: string;
  index: number;
  closedAt: number;
};

export type FindState = {
  open: boolean;
  query: string;
  count: number | null;
  active: number;
  focusRequest?: number;
  replace?: boolean;
};

export type PanelState = { open: boolean; initialText: string };

export type WindowUi = { panel: PanelState; downloadsOpen: boolean };
