import { onDownload, releaseProfile } from "@netnyahoo/cef";
import {
  closeWindow,
  hasWindowHost,
  isDarkAppearance,
  onAppEvent,
  onCommand,
  onOpenURLs,
  onWindowEvent,
  openWindow,
  replyToTerminate,
  setAppearance,
  setMenuState,
  setWindowProfile,
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
import { openUrls, openWindow as createWindow } from "./actions";
import { runCommand } from "./commands";
import { flushPersistence } from "./persist";
import { startWindowCloseGuard } from "./windowClose";
import { startExtensionsBridge } from "../components/extensions/bridge";
import { extensionMenu, useExtensions } from "../components/extensions/state";

let quitting = false;
/** True once the app has started quitting (the session is saved and frozen). */
export const isQuitting = () => quitting;

/**
 * Keeps the native shell in step with the store: one NSWindow per store window
 * (opened/closed as windows come and go), window titles, the menu bar's dynamic
 * state, and app lifecycle events. Call once, after persistence has hydrated.
 */
export function startNativeSync() {
  const store = useBrowser;
  if (!store.getState().windowOrder.length) store.getState().createWindow();

  onCommand(runCommand);
  startWindowCloseGuard();
  startExtensionsBridge();
  onOpenURLs((urls) => openUrls(urls));
  onDownload((d) => store.getState().upsertDownload(d));

  if (!hasWindowHost) {
    // An app build from before multi-window: it hosts one root (see index.js); follow the system appearance.
    store.getState().setAppDark(Appearance.getColorScheme() === "dark");
    Appearance.addChangeListener(({ colorScheme }) => store.getState().setAppDark(colorScheme === "dark"));
    return;
  }

  store.getState().setAppDark(Appearance.getColorScheme() === "dark");
  void setAppearance(store.getState().settings.appearance);
  void isDarkAppearance().then((dark) => store.getState().setAppDark(dark));

  onAppEvent((e) => {
    const s = store.getState();
    if (e.type === "appearance") s.setAppDark(e.dark);
    if (e.type === "reopen") createWindow();
    if (e.type === "quitWarningSuppressed") s.updateSettings({ warnBeforeQuitting: false });
    if (e.type === "willQuit") {
      // Browsers close as the engine shuts down; those closes mustn't reach the saved session.
      quitting = true;
      flushPersistence({ final: true });
      void replyToTerminate(true);
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
    // Its in-memory cookies/cache go away with the window.
    if (s.windows[id]?.incognito) void releaseProfile(incognitoProfileId(id));
  };

  const windowProfiles = new Map<string, string>();
  const syncWindows = (s: BrowserState, prev?: BrowserState) => {
    // The focused window opens last so it ends up in front.
    const focused = s.ui.focusedWindowId;
    const order = s.windowOrder.filter((id) => id !== focused);
    if (focused && s.windows[focused]) order.push(focused);
    for (const id of order) {
      const w = s.windows[id]!;
      if (!open.has(id)) {
        open.add(id);
        titles.set(id, windowTitle(s, id));
        // An incognito window's profile is its own ("incognito:<id>").
        const profile = engineProfile(w.profileId);
        void openWindow(id, { frame: w.frame, incognito: w.incognito, title: titles.get(id), focus: id === s.ui.focusedWindowId, profile });
      }
    }
    for (const id of [...open]) {
      if (s.windows[id]) continue;
      open.delete(id);
      titles.delete(id);
      windowProfiles.delete(id);
      void closeWindow(id);
      if (prev?.windows[id]?.incognito) void releaseProfile(incognitoProfileId(id));
    }
    if (prev && s.tabs === prev.tabs && s.windows === prev.windows && s.profiles === prev.profiles) return;
    // Chrome-hosted windows (NETNYAHOO_CHROME_WINDOW) are one Chrome window per profile: the one of the
    // profile shown takes over, and its neighbours in profile order are made ahead. Others ignore it.
    for (const id of open) {
      const w = s.windows[id]!;
      const profile = engineProfile(w.profileId);
      const key = w.incognito ? profile : `${profile}|${s.profileOrder.join(",")}`;
      if (windowProfiles.get(id) === key) continue;
      windowProfiles.set(id, key);
      const at = s.profileOrder.indexOf(w.profileId);
      const neighbours = w.incognito || at < 0 ? [] : [s.profileOrder[at - 1], s.profileOrder[at + 1]].filter((p): p is string => !!p).map(engineProfile);
      void setWindowProfile(id, profile, neighbours);
    }
    for (const id of open) {
      const title = windowTitle(s, id);
      if (titles.get(id) !== title) {
        titles.set(id, title);
        void setWindowTitle(id, title);
      }
    }
  };

  let lastMenu = "";
  let menuTimer: ReturnType<typeof setTimeout> | undefined;
  const syncMenu = () => {
    menuTimer = undefined;
    const state = menuState(store.getState());
    const json = JSON.stringify(state);
    if (json === lastMenu) return;
    lastMenu = json;
    void setMenuState(state);
  };

  // Windows left over from before a JS reload: keep the ones the store knows, close the rest.
  void windowIds().then((ids) => {
    for (const id of ids) {
      if (store.getState().windows[id]) open.add(id);
      else if (!isUtilityWindowId(id)) void closeWindow(id);
    }
    syncWindows(store.getState());
    syncMenu();
    store.subscribe((s, prev) => {
      syncWindows(s, prev);
      // The menu only needs to be current when it's opened; batch bursts (progress, typing).
      menuTimer ??= setTimeout(syncMenu, 120);
    });
    store.subscribe((s, prev) => {
      if (s.settings.appearance !== prev.settings.appearance) void setAppearance(s.settings.appearance);
    });
    useExtensions.subscribe((e, prev) => {
      if (e.lists !== prev.lists) menuTimer ??= setTimeout(syncMenu, 120);
    });
  });
}

const PAGE_COMMANDS = [
  "reload", "forceReload", "zoomIn", "zoomOut", "zoomReset", "print", "devTools", "findInPage", "findNext",
  "findPrevious", "useSelectionForFind", "copyUrl", "copyUrlAsMarkdown", "bookmarkPage", "addBookmarkToFolder", "toggleMute",
  "findAndReplace", "jumpToSelection", "viewSource", "javaScriptConsole",
];
/** Page commands that still make sense on an internal page (netnyahoo://history…), which has no web view. */
const INTERNAL_PAGE_COMMANDS = ["copyUrl", "copyUrlAsMarkdown", "bookmarkPage", "addBookmarkToFolder"];
const WINDOW_COMMANDS = [
  ...PAGE_COMMANDS, "focusCommandBar", "closeTab", "closeAllTabs", "back", "forward", "nextTab", "previousTab", "togglePin",
  "duplicateTab", "moveTabToProfile", "moveTabToWindow", "toggleSidebar", "downloads", "mergeAllWindows", "switchProfile",
  "nextProfile", "previousProfile", "openBookmark", "selectTab", "selectLastTab",
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

/** The bookmark parts of the menu for a profile, memoised per bookmarks object. */
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

/** The menu bar's view of the focused window (see Menus.swift). */
export function menuState(s: BrowserState): MenuState {
  const windowId = s.ui.focusedWindowId && s.windows[s.ui.focusedWindowId] ? s.ui.focusedWindowId : undefined;
  const w = windowId ? s.windows[windowId] : undefined;
  const tab = windowId ? activeTab(s, windowId) : undefined;
  const live = tab ? s.live[tab.id] : undefined;
  const bookmarkProfile = bookmarkProfileId(s, w);
  const regularWindows = s.windowOrder.filter((id) => !s.windows[id]!.incognito);

  const disabled: string[] = [];
  if (!tab || !splitOf(s, tab.id)) disabled.push("focusNextPane", "focusPreviousPane");
  // Tabs along the top leave no sidebar to hold the address bar.
  if (w && (w.tabLayout ?? s.settings.tabLayout) === "top") disabled.push("toggleAddressBar");
  if (!w) disabled.push(...WINDOW_COMMANDS, "toggleTabLayout", "openSplitPane");
  else {
    if (!tab?.url) disabled.push(...PAGE_COMMANDS);
    else if (isInternalTab(tab)) disabled.push(...PAGE_COMMANDS.filter((c) => !INTERNAL_PAGE_COMMANDS.includes(c)));
    if (!tab || !canGoBack(tab.id, live ?? IDLE_LIVE)) disabled.push("back");
    if (!tab || !canGoForward(tab.id, live ?? IDLE_LIVE)) disabled.push("forward");
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

  const sidebar = sidebarMenuState(s, windowId);
  disabled.push(...sidebar.disabled);
  Object.assign(titles, sidebar.titles);

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
