import { closeWindow as closeNativeWindow, copyText, prompt, setAppearance, sharePage, type CommandEvent } from "@netnyahoo/shell";
import { markdownLink } from "@netnyahoo/core";
import { useBrowser } from "../store/browser";
import { activeTabId, bookmarkProfileId, resolveWindowId } from "../store/model";
import {
  closeTab,
  createProfile,
  cycleProfile,
  moveTabToProfile,
  moveTabToWindow,
  openWindow,
  switchProfile,
  toggleMute,
} from "./actions";
import { bookmarkActivePage, bookmarkAllTabs } from "../components/bookmarks/actions";
import { useClearDataRequest } from "../components/pages/ClearDataDialog";
import { openInternalPage } from "../components/pages/urls";
import { isUtilityWindowId, openImport, openSettings } from "../components/settings/windows";
import { focusHeroBar } from "../components/omnibox/barState";
import { webviews } from "./webviews";
import { goBack, goForward } from "../components/layout/history";
import { openSplitPane } from "../components/layout/splitActions";
import { runSidebarCommand } from "../components/sidebar/commands";
import { setZoom } from "./zoom";
import { openExtensionFromMenu } from "../components/extensions/bridge";
import { toggleCastPicker } from "../components/media/cast";
import { openManageExtensions, openPinDialog, openWebStore } from "../components/extensions/state";
import { requestAutofill } from "../components/site/Autofill";
import { copyPageUrl, jumpToSelection } from "../components/site/selection";

/**
 * Menu-bar, shortcut and Dock commands. `windowId` is the key browser window
 * (null from the Dock or with no window open); commands fall back to the last
 * focused window.
 */
export function runCommand({ command, arg, windowId: requested }: CommandEvent) {
  const s = useBrowser.getState();

  // Settings / Import windows: ⌘W closes them; tab commands go to the last browser window.
  if (isUtilityWindowId(requested)) {
    if (command === "closeTab") return void closeNativeWindow(requested!);
    requested = null;
  }

  // Commands that don't need a window.
  switch (command) {
    case "newWindow":
      return void openWindow({ profileId: arg ?? undefined });
    case "newIncognitoWindow":
      return void openWindow({ incognito: true });
    case "reopenClosedWindow":
      return s.reopenClosedWindow();
    case "setAppearance":
      if (arg === "auto" || arg === "light" || arg === "dark") {
        s.updateSettings({ appearance: arg });
        void setAppearance(arg);
      }
      return;
    case "toggleFullUrl":
      return s.updateSettings({ showFullUrl: !s.settings.showFullUrl });
    case "toggleAddressBar":
      return s.updateSettings({ addressBar: s.settings.addressBar === "sidebar" ? "toolbar" : "sidebar" });
    case "openSettings":
      return openSettings();
    case "keyboardShortcuts":
      return openSettings("shortcuts");
    case "importBrowserData":
      return openImport();
    case "manageExtensions":
      return openManageExtensions();
    case "setBookmarksBar":
      if (arg === "always" || arg === "newTab" || arg === "never") s.updateSettings({ bookmarksBar: arg });
      return;
    case "toggleBookmarksBar": {
      // Like Chrome: shown (in any mode) → Never; hidden → Always. "On New Tab Only" shows it on the
      // New Tab page alone, so on a web page ⇧⌘B shows it rather than setting Never (no change).
      const mode = s.settings.bookmarksBar;
      const target = resolveWindowId(s, requested);
      const active = target ? activeTabId(s, target) : undefined;
      const shown = mode === "always" || (mode === "newTab" && !(active && s.tabs[active]?.url));
      return s.updateSettings({ bookmarksBar: shown ? "never" : "always" });
    }
  }

  const windowId = resolveWindowId(s, requested);
  if (!windowId) {
    // No window open: ⌘T / ⇧⌘T still work, in a new window.
    if (command === "newTab") openWindow();
    if (command === "reopenClosedTab" || command === "restoreClosed") {
      if (arg) s.restoreClosed(arg);
      else s.reopenClosed();
    }
    return;
  }
  const tabId = activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  const page = tab?.url ? tab : undefined;
  const web = tabId ? webviews.get(tabId) : undefined;
  const ui = s.windowUi[windowId];
  const find = tabId ? s.find[tabId] : undefined;
  // Tabs & sidebar: groups, Search Tabs, ⌃Tab switcher, Clean Up Tabs, pinned tabs…
  if (runSidebarCommand(command, arg, windowId)) return;

  switch (command) {
    case "newTab":
      return void s.newTab(windowId);
    case "reopenClosedTab":
      return s.reopenClosed(windowId);
    case "restoreClosed":
      return arg ? s.restoreClosed(arg, windowId) : undefined;
    case "focusCommandBar":
      // On the New Tab page ⌘L focuses (and selects) the page's own bar; an empty split pane
      // has none, so it gets the command panel.
      if (page) return s.openPanel(windowId, page.url);
      return focusHeroBar(windowId) ? undefined : tab ? s.openPanel(windowId, "") : undefined;
    case "closeTab":
      // ⌘W dismisses the command panel / find bar before closing the tab.
      if (ui?.panel.open) return s.closePanel(windowId);
      if (tabId && find?.open) return closeFind(tabId);
      return tabId ? void closeTab(tabId) : undefined;
    case "print":
      return void web?.print();
    // File › Share… and the command bar's Share: the macOS share picker, for web pages.
    case "share":
      return page && /^https?:/i.test(page.url) ? void sharePage(page.url, page.customTitle || page.title, windowId) : undefined;
    // Dia copies links "without any trackers" (and offers a quote link for selected text).
    case "copyUrl":
      return page ? void copyPageUrl(page.id) : undefined;
    case "copyUrlAsMarkdown":
      return page ? copyText(markdownLink(page.customTitle || page.title, page.url)) : undefined;
    case "findInPage":
      return page ? s.setFind(page.id, { open: true, replace: false, focusRequest: Date.now() }) : undefined;
    // Replaces in the page's focused text field (components/FindBar).
    case "findAndReplace":
      return page ? s.setFind(page.id, { open: true, replace: true, focusRequest: Date.now() }) : undefined;
    case "jumpToSelection":
      return page ? void jumpToSelection(page.id) : undefined;
    case "useSelectionForFind":
      if (!page || !web) return;
      return void web.evaluate<string>("post('result', JSON.stringify(String(getSelection() || '').trim().slice(0, 500)))").then((query) => {
        if (query) useBrowser.getState().setFind(page.id, { open: true, query, focusRequest: Date.now() });
      });
    case "findNext":
    case "findPrevious":
      if (!page) return;
      if (!find?.query) return s.setFind(page.id, { open: true });
      return void web?.find(find.query, command === "findNext", true);
    case "reload":
      return void web?.reload();
    case "forceReload":
      return void web?.forceReload();
    case "toggleTabLayout":
      return s.toggleTabLayout(windowId);
    case "openSplitPane":
      return void openSplitPane(windowId);
    case "focusNextPane":
      return s.focusPane(windowId, 1);
    case "focusPreviousPane":
      return s.focusPane(windowId, -1);
    case "toggleSidebar":
      return s.toggleSidebar(windowId);
    case "zoomIn":
      return page ? setZoom(page.id, 1) : undefined;
    case "zoomOut":
      return page ? setZoom(page.id, -1) : undefined;
    case "zoomReset":
      return page ? setZoom(page.id, 0) : undefined;
    case "devTools":
      return void web?.showDevTools();
    // F12, Chrome's DevTools toggle: also closes an undocked DevTools window it's pressed in.
    case "toggleDevTools":
      return void web?.showDevTools("toggle");
    case "inspectElements":
      return void web?.showDevTools("inspect");
    case "javaScriptConsole":
      return void web?.showDevTools("console");
    // Like Chrome: the source in a new tab next to the page.
    case "viewSource":
      if (!page || !web || !/^(https?|file):/.test(page.url)) return;
      return void s.newTab(windowId, { url: `view-source:${page.url}`, openerId: page.id, profileId: page.profileId });
    // Through layout/history: the New Tab page a tab started on is its first back entry.
    case "back":
      return tabId ? goBack(tabId) : undefined;
    case "forward":
      return tabId ? goForward(tabId) : undefined;
    case "nextTab":
      return s.cycle(windowId, 1);
    case "previousTab":
      return s.cycle(windowId, -1);
    case "selectTab":
      return s.activateIndex(windowId, Number(arg) - 1);
    case "selectLastTab":
      return s.activateIndex(windowId, -1);
    case "togglePin":
      return tab ? s.togglePin(tab.id) : undefined;
    case "duplicateTab":
      return tab ? void s.duplicateTab(tab.id) : undefined;
    case "moveTabToProfile":
      return tab && arg ? void moveTabToProfile(tab.id, arg) : undefined;
    case "moveTabToWindow":
      return tab && arg ? moveTabToWindow(tab.id, arg) : undefined;
    case "bookmarkPage":
      // ⌘D bookmarks the page and opens the save dialog (name + folder tree), like Dia.
      return page ? bookmarkActivePage(windowId) : undefined;
    case "addBookmarkToFolder":
      return page && arg ? void addBookmarkToFolder(windowId, arg) : undefined;
    case "openBookmark": {
      const node = arg ? s.bookmarks.nodes[arg] : undefined;
      return node?.kind === "url" && tab ? s.navigate(tab.id, node.url) : undefined;
    }
    case "toggleMute":
      return page ? toggleMute(page.id) : undefined;
    case "downloads":
      return s.setDownloadsOpen(windowId, !ui?.downloadsOpen);
    case "cast":
      return void toggleCastPicker(windowId);
    case "showHistory":
      return openInternalPage("history", windowId);
    case "clearBrowsingData":
      openInternalPage("history", windowId);
      return useClearDataRequest.getState().request(windowId);
    case "manageBookmarks":
      return openInternalPage("bookmarks", windowId);
    case "bookmarkAllTabs":
      return bookmarkAllTabs(windowId);
    case "mergeAllWindows":
      return s.mergeAllWindows(windowId);
    case "switchProfile":
      return arg ? switchProfile(windowId, arg, true) : undefined;
    case "nextProfile":
      return cycleProfile(windowId, 1);
    case "previousProfile":
      return cycleProfile(windowId, -1);
    case "openExtension":
      return arg ? openExtensionFromMenu(windowId, arg) : undefined;
    case "addExtension":
      return void openWebStore(windowId);
    case "pinExtensions":
      return openPinDialog(windowId);
    case "autofill":
      return void requestAutofill(windowId, arg);
    case "newProfile":
      return void createProfile(windowId).then((id) => id && switchProfile(windowId, id));
  }
}

function closeFind(tabId: string) {
  useBrowser.getState().setFind(tabId, { open: false, count: null, active: 0 });
  void webviews.get(tabId)?.stopFinding(false);
  void webviews.get(tabId)?.focus();
}

/** Tabs › Add Bookmark to Folder (`new` asks for a folder name, on the Bookmarks Bar). */
async function addBookmarkToFolder(windowId: string, folder: string) {
  const s = useBrowser.getState();
  const tabId = activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  if (!tab?.url) return;
  const profileId = bookmarkProfileId(s, s.windows[windowId]);
  let parentId = folder;
  if (folder === "new") {
    const title = await prompt({ title: "New Folder", placeholder: "Folder name", confirmTitle: "Create", windowId });
    if (!title) return;
    // New folders go on the Bookmarks Bar.
    parentId = useBrowser.getState().addBookmarkFolder({ profileId, title });
  }
  useBrowser.getState().addBookmark({ profileId, url: tab.url, title: tab.title, favicon: tab.favicon, parentId });
}
