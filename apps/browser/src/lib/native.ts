import { onDownload, releaseProfile } from "@netnyahoo/nncore";
import {
  closeWindow,
  isDarkAppearance,
  onAppEvent,
  onCommand,
  onOpenURLs,
  onWindowEvent,
  openWindow,
  replyToTerminate,
  setAppearance,
  setMenuStateParts,
  setWindowTitle,
  windowIds,
  type MenuBookmark,
  type MenuState,
} from "@netnyahoo/shell";
import { Appearance } from "react-native";
import { folderChildren, isBookmarked } from "../store/bookmarks";
import { useBrowser, type BrowserState } from "../store/browser";
import { activeTab, bookmarkProfileId, engineProfile, IDLE_LIVE, incognitoProfileId, tabLabel, windowTitle } from "../store/model";
import { splitOf } from "../store/splits";
import { canGoBack, canGoForward } from "../components/layout/history";
import type { Bookmarks, BookmarkNode } from "../store/types";
import { isUtilityWindowId } from "../components/settings/windows";
import { isInternalTab } from "../components/pages/urls";
import { sidebarMenuState } from "../components/sidebar/commands";
import { openWindow as createWindow } from "./actions";
import { openExternalUrls } from "../components/smallYahu/actions";
import { SMALL_YAHU_DISABLED_COMMANDS } from "../components/smallYahu/menu";
import { runCommand } from "./commands";
import { flushPersistence, resumePersistence } from "./persist";
import { startWindowCloseGuard } from "./windowClose";
import { startExtensionsBridge } from "../components/extensions/bridge";
import { extensionMenu, useExtensions } from "../components/extensions/state";

let quitting = false;
export const isQuitting = () => quitting;

export function startNativeSync() {
  const store = useBrowser;
  if (!store.getState().windowOrder.length) store.getState().createWindow();

  onCommand(runCommand);
  startWindowCloseGuard();
  startExtensionsBridge();
  onOpenURLs((urls) => openExternalUrls(urls));
  onDownload((d) => store.getState().upsertDownload(d));

  store.getState().setAppDark(Appearance.getColorScheme() === "dark");
  void setAppearance(store.getState().settings.appearance);
  void isDarkAppearance().then((dark) => store.getState().setAppDark(dark));

  onAppEvent((e) => {
    const s = store.getState();
    if (e.type === "appearance") s.setAppDark(e.dark);
    if (e.type === "reopen") createWindow();
    if (e.type === "quitWarningSuppressed") s.updateSettings({ warnBeforeQuitting: false });
    if (e.type === "willQuit") {
      quitting = true;
      flushPersistence({ final: true });
      void replyToTerminate(true);
    }
    if (e.type === "quitCancelled") {
      quitting = false;
      resumePersistence();
    }
  });

  onWindowEvent((e) => {
    const s = store.getState();
    if (e.type === "focus") s.setFocusedWindow(e.id);
    if (e.type === "frame") s.setWindowFrame(e.id, e.frame);
    if (e.type === "close") {
      if (quitting) return;
      open.delete(e.id);
      s.closeWindow(e.id);
      releaseIfIncognito(e.id, s);
    }
  });

  const open = new Set<string>();
  const titles = new Map<string, string>();

  const releaseIfIncognito = (id: string, s: BrowserState) => {
    if (s.windows[id]?.incognito) void releaseProfile(incognitoProfileId(id));
  };

  const syncWindows = (s: BrowserState, prev?: BrowserState) => {
// Open the focused window last so it comes to front.
    const focused = s.ui.focusedWindowId;
    const order = s.windowOrder.filter((id) => id !== focused);
    if (focused && s.windows[focused]) order.push(focused);
    for (const id of order) {
      const w = s.windows[id]!;
      if (!open.has(id)) {
        open.add(id);
        titles.set(id, windowTitle(s, id));
        const profile = engineProfile(w.profileId);
        const small = w.kind === "small" ? { kind: "small" as const, size: s.settings.smallYahuSize } : {};
        void openWindow(id, { frame: w.frame, incognito: w.incognito, title: titles.get(id), focus: id === s.ui.focusedWindowId, profile, ...small });
      }
    }
    for (const id of [...open]) {
      if (s.windows[id]) continue;
      open.delete(id);
      titles.delete(id);
      void closeWindow(id);
      if (prev?.windows[id]?.incognito) void releaseProfile(incognitoProfileId(id));
    }
    if (prev && s.tabs === prev.tabs && s.windows === prev.windows && s.profiles === prev.profiles) return;
    for (const id of open) {
      const title = windowTitle(s, id);
      if (titles.get(id) !== title) {
        titles.set(id, title);
        void setWindowTitle(id, title);
      }
    }
  };

  let lastMenu = "";
  let lastBookmarkMenus: unknown[] = [];
  let menuTimer: ReturnType<typeof setTimeout> | undefined;
  const syncMenu = () => {
    menuTimer = undefined;
    const state = menuState(store.getState());
    // The bookmark menus are cached per bookmarks tree (bookmarkMenus), so they compare by identity;
    // stringifying them (thousands of bookmarks) on every store change is what this sync used to spend.
    const { bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks, ...rest } = state;
    const bookmarkMenus = [bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks];
    const json = JSON.stringify(rest);
    const bookmarksChanged = !bookmarkMenus.every((menu, i) => menu === lastBookmarkMenus[i]);
    if (json === lastMenu && !bookmarksChanged) return;
    lastMenu = json;
    lastBookmarkMenus = bookmarkMenus;
    void setMenuStateParts(state, bookmarksChanged);
  };

  // The windows open now, without first asking which exist: that answer comes from the main thread, which Chrome's
  // startup holds, and waiting for it put 20–100 ms before the first frame. Opening one that exists (after a JS reload)
  // only brings it forward; the ones the store doesn't have close when the answer comes.
  syncWindows(store.getState());
  syncMenu();
  store.subscribe((s, prev) => {
    syncWindows(s, prev);
    menuTimer ??= setTimeout(syncMenu, 120);
  });
  store.subscribe((s, prev) => {
    if (s.settings.appearance !== prev.settings.appearance) void setAppearance(s.settings.appearance);
  });
  useExtensions.subscribe((e, prev) => {
    if (e.lists !== prev.lists) menuTimer ??= setTimeout(syncMenu, 120);
  });
  void windowIds().then((ids) => {
    const s = store.getState();
    for (const id of ids) {
      if (!s.windows[id]) {
        if (!isUtilityWindowId(id)) void closeWindow(id);
        continue;
      }
      // One that already existed kept the title it had (openWindow leaves it be): send the current one.
      const title = windowTitle(s, id);
      titles.set(id, title);
      void setWindowTitle(id, title);
    }
  });
}

const PAGE_COMMANDS = [
  "reload", "forceReload", "zoomIn", "zoomOut", "zoomReset", "print", "devTools", "toggleDevTools", "findInPage", "findNext",
  "findPrevious", "useSelectionForFind", "copyUrl", "copyUrlAsMarkdown", "bookmarkPage", "addBookmarkToFolder", "toggleMute",
  "findAndReplace", "jumpToSelection", "viewSource", "javaScriptConsole", "inspectElements", "savePage", "emailPageLocation",
  "printWithSystemDialog", "stop", "caretBrowsing", "share",
];
const INTERNAL_PAGE_COMMANDS = ["copyUrl", "copyUrlAsMarkdown", "bookmarkPage", "addBookmarkToFolder"];
const WINDOW_COMMANDS = [
  ...PAGE_COMMANDS, "focusCommandBar", "closeTab", "closeAllTabs", "back", "forward", "nextTab", "previousTab", "togglePin",
  "duplicateTab", "moveTabToProfile", "moveTabToWindow", "toggleSidebar", "downloads", "mergeAllWindows", "switchProfile",
  "nextProfile", "previousProfile", "openBookmark", "selectTab", "selectLastTab", "moveTabDown", "moveTabUp", "closeTabGroup",
  "openProfileMenu",
];

function menuBookmarks(b: Bookmarks, folderId: string, depth = 0): MenuBookmark[] {
  return folderChildren(b, folderId).map((n: BookmarkNode) =>
    n.kind === "url"
      ? { id: n.id, title: n.title || n.url, url: n.url }
      : { id: n.id, title: n.title, children: depth < 6 ? menuBookmarks(b, n.id, depth + 1) : [] },
  );
}

type BookmarkMenus = Pick<MenuState, "bookmarkFolders" | "recentBookmarks" | "bookmarksBar" | "otherBookmarks">;
const bookmarkMenuCache = new WeakMap<Bookmarks, Map<string, BookmarkMenus>>();

function bookmarkMenus(b: Bookmarks, profileId: string): BookmarkMenus {
  let perProfile = bookmarkMenuCache.get(b);
  if (!perProfile) bookmarkMenuCache.set(b, (perProfile = new Map()));
  const cached = perProfile.get(profileId);
  if (cached) return cached;
  const roots = b.roots[profileId];
  const menus: BookmarkMenus = roots
    ? {
        bookmarkFolders: [
          { id: roots.bar, title: "Bookmarks Bar" },
          { id: roots.other, title: "Other Bookmarks" },
          ...[...folderChildren(b, roots.bar), ...folderChildren(b, roots.other)]
            .filter((n) => n.kind === "folder")
            .map((n) => ({ id: n.id, title: n.title })),
        ],
        recentBookmarks: Object.values(b.nodes)
          .filter((n): n is Extract<BookmarkNode, { kind: "url" }> => n.kind === "url" && isInTree(b, n.id, [roots.bar, roots.other]))
          .sort((x, y) => y.addedAt - x.addedAt)
          .slice(0, 5)
          .map((n) => ({ id: n.id, title: n.title || n.url, url: n.url })),
        bookmarksBar: menuBookmarks(b, roots.bar),
        otherBookmarks: menuBookmarks(b, roots.other),
      }
    : { bookmarkFolders: [], recentBookmarks: [], bookmarksBar: [], otherBookmarks: [] };
  perProfile.set(profileId, menus);
  return menus;
}

export function menuState(s: BrowserState): MenuState {
  const windowId = s.ui.focusedWindowId && s.windows[s.ui.focusedWindowId] ? s.ui.focusedWindowId : undefined;
  const w = windowId ? s.windows[windowId] : undefined;
  const tab = windowId ? activeTab(s, windowId) : undefined;
  const live = tab ? s.live[tab.id] : undefined;
  const bookmarkProfile = bookmarkProfileId(s, w);
  const regularWindows = s.windowOrder.filter((id) => !s.windows[id]!.incognito && s.windows[id]!.kind !== "small");

  const disabled: string[] = [];
  if (!tab || !splitOf(s, tab.id)) disabled.push("focusNextPane", "focusPreviousPane");
  if (w && (w.tabLayout ?? s.settings.tabLayout) === "top") disabled.push("toggleAddressBar");
  if (!w) disabled.push(...WINDOW_COMMANDS, "toggleTabLayout", "openSplitPane");
  else {
    if (!tab?.url) disabled.push(...PAGE_COMMANDS);
    else if (isInternalTab(tab)) disabled.push(...PAGE_COMMANDS.filter((c) => !INTERNAL_PAGE_COMMANDS.includes(c)));
    if (!tab || !canGoBack(tab.id, live ?? IDLE_LIVE)) disabled.push("back");
    if (!tab || !canGoForward(tab.id, live ?? IDLE_LIVE)) disabled.push("forward");
    if (!live?.isLoading) disabled.push("stop");
    if (w.incognito) disabled.push("moveTabToProfile", "moveTabToWindow", "switchProfile", "nextProfile", "previousProfile");
    else if (tab) disabled.push(`moveTabToProfile:${tab.profileId}`);
    if (regularWindows.length < 2) disabled.push("mergeAllWindows");
  }
  if (!s.closedTabs.length && !s.closedWindows.length && !s.closedGroups.length) disabled.push("reopenClosedTab");
  if (!s.closedWindows.length) disabled.push("reopenClosedWindow");

  const checked = [`setAppearance:${s.settings.appearance}`];
  if (s.settings.showFullUrl) checked.push("toggleFullUrl");
  if (s.settings.addressBar === "sidebar") checked.push("toggleAddressBar");
  checked.push(`setBookmarksBar:${s.settings.bookmarksBar}`);
  if ((w?.tabLayout ?? s.settings.tabLayout) === "sidebar") checked.push("toggleTabLayout");
  if (w && !w.sidebarOpen) checked.push("toggleSidebar");

  const titles: Record<string, string> = {};
  if (tab?.pinned) titles.togglePin = "Unpin";
  if (tab?.muted) titles.toggleMute = "Unmute Site";
  if (tab?.url && isBookmarked(s.bookmarks, bookmarkProfile, tab.url)) {
    titles.bookmarkPage = "Edit Bookmark…";
  }

  if (!s.settings.openLinksInSmallYahu) titles.toggleOpenLinksInSmallYahu = "Open Links from Other Apps in Small Yahu";

  const sidebar = sidebarMenuState(s, windowId);
  disabled.push(...sidebar.disabled);
  Object.assign(titles, sidebar.titles);
  if (w?.kind === "small") {
    disabled.push(...SMALL_YAHU_DISABLED_COMMANDS);
    // ⌘O is Open File in a main window and Open in Netnyahoo in Small Yahu, as in Little Arc.
    titles.openFile = "Open in Netnyahoo";
  }

  const closed = [
    ...s.closedTabs.filter((c) => !c.tab.profileId.startsWith("incognito:")).map((c) => ({ id: c.id, title: c.tab.title || tabLabel(c.tab), at: c.closedAt })),
    ...s.closedWindows.map((c) => ({ id: c.id, title: c.tabs.length === 1 ? "Window (1 Tab)" : `Window (${c.tabs.length} Tabs)`, at: c.closedAt })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 10)
    .map(({ id, title }) => ({ id, title }));

  return {
    checked,
    disabled,
    titles,
    profiles: s.profileOrder.map((id) => ({ id, title: s.profiles[id]!.name, current: w?.profileId === id })),
    windows: w?.incognito ? [] : regularWindows.filter((id) => id !== windowId).map((id) => ({ id, title: windowTitle(s, id) })),
    ...bookmarkMenus(s.bookmarks, bookmarkProfile),
    recentlyClosed: closed,
    recentlyClosedGroups: sidebar.recentlyClosedGroups,
    warnBeforeQuitting: s.settings.warnBeforeQuitting,
    warnBeforeClosingWindow: s.settings.warnBeforeClosingWindow,
    downloadsInProgress: s.downloads.filter((d) => d.state === "downloading").length,
    shortcuts: s.settings.shortcuts,
    extensions: extensionMenu(s, windowId),
  };
}

function isInTree(b: Bookmarks, id: string, roots: string[]): boolean {
  let node = b.nodes[id];
  for (let i = 0; node && i < 64; i++) {
    if (roots.includes(node.id)) return true;
    node = node.parentId ? b.nodes[node.parentId] : undefined;
  }
  return false;
}
