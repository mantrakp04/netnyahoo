import {
  closeWindow as closeNativeWindow,
  copyText,
  openExternalURL,
  pickFiles,
  prompt,
  setAppearance,
  type CommandEvent,
} from "@netnyahoo/shell";
import { markdownLink } from "@netnyahoo/core";
import { useBrowser } from "../store/browser";
import { activeTabId, bookmarkProfileId, resolveWindowId } from "../store/model";
import {
  closeTab,
  createProfile,
  cycleProfile,
  focus,
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
import { numberedTabs } from "../components/sidebar/entries";
import { openExtensionFromMenu } from "../components/extensions/bridge";
import { toggleCastPicker } from "../components/media/cast";
import { openManageExtensions, openPinDialog, openWebStore } from "../components/extensions/state";
import { requestAutofill } from "../components/site/Autofill";
import { copyPageUrl, jumpToSelection } from "../components/site/selection";
import { shareTab } from "../components/site/share";
import { openProfileMenu } from "../components/ProfileIndicator";
import { groupOf } from "../store/organize";
import { isSmall, mainWindowFor } from "../store/small";
import { closeSmallYahu, openInMainWindow, openSmallYahu } from "../components/smallYahu/actions";

export function runCommand({ command, arg, windowId: requested }: CommandEvent) {
  const s = useBrowser.getState();

  if (isUtilityWindowId(requested)) {
    if (command === "closeTab") return void closeNativeWindow(requested!);
    requested = null;
  }
  if (isSmall(s, requested) && runSmallYahuCommand(command, requested!)) return;

  switch (command) {
    case "newWindow":
      return void openWindow({ profileId: arg ?? undefined });
    case "newIncognitoWindow":
      return void openWindow({ incognito: true });
    case "newSmallYahu":
      return void openSmallYahu();
    case "toggleOpenLinksInSmallYahu":
      return s.updateSettings({ openLinksInSmallYahu: !s.settings.openLinksInSmallYahu });
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
    case "openFile":
      return void openFiles(requested);
    case "manageExtensions":
      return openManageExtensions();
    case "setBookmarksBar":
      if (arg === "always" || arg === "newTab" || arg === "never") s.updateSettings({ bookmarksBar: arg });
      return;
    case "toggleBookmarksBar": {
      const mode = s.settings.bookmarksBar;
      const target = resolveWindowId(s, requested);
      const active = target ? activeTabId(s, target) : undefined;
      const shown = mode === "always" || (mode === "newTab" && !(active && s.tabs[active]?.url));
      return s.updateSettings({ bookmarksBar: shown ? "never" : "always" });
    }
  }

  // From Small Yahu, tabs, windows and the sidebar's commands act on the main window.
  if (isSmall(s, requested) && !SMALL_YAHU_PAGE_COMMANDS.has(command)) {
    requested = mainWindowFor(s, s.windows[requested!]!.profileId) ?? null;
    if (requested) focus(requested);
  }

  const windowId = resolveWindowId(s, requested);
  if (!windowId) {
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
  if (runSidebarCommand(command, arg, windowId)) return;

  switch (command) {
    case "newTab":
      return void s.newTab(windowId);
    case "reopenClosedTab":
      return s.reopenClosed(windowId);
    case "restoreClosed":
      return arg ? s.restoreClosed(arg, windowId) : undefined;
    case "focusCommandBar":
      if (page) return s.openPanel(windowId, page.url);
      return focusHeroBar(windowId) ? undefined : tab ? s.openPanel(windowId, "") : undefined;
    case "closeTab":
      if (ui?.panel.open) return s.closePanel(windowId);
      if (tabId && find?.open) return closeFind(tabId);
      return tabId ? void closeTab(tabId) : undefined;
    case "print":
      return void web?.print();
    case "printWithSystemDialog":
      return void web?.runPageCommand("systemPrint");
    case "savePage":
      return void web?.runPageCommand("savePage");
    case "caretBrowsing":
      return void web?.runPageCommand("caretBrowsing");
    case "emailPageLocation":
      if (!page || !/^https?:/i.test(page.url)) return;
      return void openExternalURL(
        `mailto:?subject=${encodeURIComponent(page.customTitle || page.title || page.url)}&body=${encodeURIComponent(page.url)}`,
      );
    case "stop":
      return void web?.stopLoading();
    case "share":
      // File › Share's services send "via:<service>"; without one, the share sheet.
      return void shareTab(page, windowId, arg?.startsWith("via:") ? arg.slice(4) : null);
    case "copyUrl":
      return page ? void copyPageUrl(page.id) : undefined;
    case "copyUrlAsMarkdown":
      return page ? copyText(markdownLink(page.customTitle || page.title, page.url)) : undefined;
    case "findInPage":
      return page ? s.setFind(page.id, { open: true, replace: false, focusRequest: Date.now() }) : undefined;
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
      return page ? void web?.zoomStep(1) : undefined;
    case "zoomOut":
      return page ? void web?.zoomStep(-1) : undefined;
    case "zoomReset":
      return page ? void web?.zoomStep(0) : undefined;
    case "devTools":
      return void web?.showDevTools();
    case "toggleDevTools":
      return void web?.showDevTools("toggle");
    case "inspectElements":
      return void web?.showDevTools("inspect");
    case "javaScriptConsole":
      return void web?.showDevTools("console");
    case "viewSource":
      if (!page || !web || !/^(https?|file):/.test(page.url)) return;
      return void s.newTab(windowId, { url: `view-source:${page.url}`, openerId: page.id, profileId: page.profileId });
    case "back":
      return tabId ? goBack(tabId) : undefined;
    case "forward":
      return tabId ? goForward(tabId) : undefined;
    case "nextTab":
      return s.cycle(windowId, 1);
    case "previousTab":
      return s.cycle(windowId, -1);
    case "selectTab":
    case "selectLastTab": {
      const rows = numberedTabs(s, windowId);
      const id = command === "selectLastTab" ? rows.at(-1) : rows[Number(arg) - 1];
      return id ? s.activate(id) : undefined;
    }
    case "togglePin":
      return tab ? s.togglePin(tab.id) : undefined;
    case "moveTabDown":
    case "moveTabUp": {
      if (!tab) return;
      const section = s.windows[windowId]!.tabIds.filter((id) => s.tabs[id]?.profileId === tab.profileId && !!s.tabs[id]?.pinned === tab.pinned);
      const at = section.indexOf(tab.id) + (command === "moveTabDown" ? 1 : -1);
      return at >= 0 && at < section.length ? s.moveTab(tab.id, at) : undefined;
    }
    case "closeTabGroup": {
      const group = groupOf(s, tabId);
      return group ? s.closeGroup(group.id) : undefined;
    }
    case "openProfileMenu":
      return s.windows[windowId]?.incognito ? undefined : void openProfileMenu(windowId);
    case "duplicateTab":
      return tab ? void s.duplicateTab(tab.id) : undefined;
    case "moveTabToProfile":
      return tab && arg ? void moveTabToProfile(tab.id, arg) : undefined;
    case "moveTabToWindow":
      return tab && arg ? moveTabToWindow(tab.id, arg) : undefined;
    case "bookmarkPage":
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

// What Small Yahu runs on its own page; everything else goes to the main window (menuState disables the tab and
// sidebar commands that make no sense from there).
const SMALL_YAHU_PAGE_COMMANDS = new Set<string>([
  "print", "printWithSystemDialog", "savePage", "caretBrowsing", "emailPageLocation", "stop", "share", "copyUrl",
  "copyUrlAsMarkdown", "findInPage", "findAndReplace", "jumpToSelection", "useSelectionForFind", "findNext", "findPrevious",
  "reload", "forceReload", "zoomIn", "zoomOut", "zoomReset", "devTools", "toggleDevTools", "inspectElements",
  "javaScriptConsole", "viewSource", "back", "forward", "bookmarkPage", "addBookmarkToFolder", "openBookmark", "toggleMute",
  "cast", "openExtension", "addExtension", "autofill", "reopenClosedTab", "restoreClosed", "downloads",
]);

function runSmallYahuCommand(command: string, windowId: string): boolean {
  const s = useBrowser.getState();
  const tabId = activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  switch (command) {
    case "closeTab":
      // A blank Small Yahu (⌘⌥N, nothing typed yet) closes with its field open.
      if (s.windowUi[windowId]?.panel.open && tab?.url) s.closePanel(windowId);
      else if (tabId && s.find[tabId]?.open) closeFind(tabId);
      else closeSmallYahu(windowId);
      return true;
    case "focusCommandBar":
      s.openPanel(windowId, tab?.url ?? "");
      return true;
    case "openFile":
      openInMainWindow(windowId);
      return true;
  }
  return false;
}

function closeFind(tabId: string) {
  useBrowser.getState().setFind(tabId, { open: false, count: null, active: 0 });
  void webviews.get(tabId)?.stopFinding(false);
  void webviews.get(tabId)?.focus();
}

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
    parentId = useBrowser.getState().addBookmarkFolder({ profileId, title });
  }
  useBrowser.getState().addBookmark({ profileId, url: tab.url, title: tab.title, favicon: tab.favicon, parentId });
}

async function openFiles(windowId: string | null) {
  const urls = await pickFiles();
  if (!urls.length) return;
  const s = useBrowser.getState();
  const target = resolveWindowId(s, windowId);
  if (!target) return void openWindow({ url: urls[0] });
  let last: string | undefined;
  for (const url of urls) last = useBrowser.getState().newTab(target, { url });
  if (last) useBrowser.getState().activate(last);
}
