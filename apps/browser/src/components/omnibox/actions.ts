import type { CommandAction } from "@netnyahoo/core";
import type { BrowserCommand } from "@netnyahoo/shell";
import { runCommand } from "../../lib/commands";
import { isBookmarked } from "../../store/bookmarks";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTab, bookmarkProfileId } from "../../store/model";
import type { Tab } from "../../store/types";

/**
 * Browser actions the command bar offers ("close tab", "new window", "settings"…): an index
 * over the menu commands in lib/commands.ts. Titles follow the menus; `needs` hides actions
 * that can't run right now (page actions on the New Tab page, profile actions in incognito).
 */
type Context = { s: BrowserState; windowId: string; tab: Tab | undefined };

type ActionDef = {
  command: BrowserCommand;
  arg?: string;
  title: string | ((c: Context) => string);
  icon: string;
  hint?: string;
  keywords?: string[];
  needs?: "page" | "tab" | "profiles";
};

const page = "page" as const;

const DEFS: ActionDef[] = [
  { command: "newTab", title: "New Tab", icon: "plus", hint: "⌘T", keywords: ["open tab"] },
  { command: "newWindow", title: "New Window", icon: "macwindow", hint: "⌘N" },
  { command: "newIncognitoWindow", title: "New Incognito Window", icon: "eyeglasses", hint: "⇧⌘N", keywords: ["private window", "incognito"] },
  { command: "closeTab", title: "Close Tab", icon: "xmark", hint: "⌘W", needs: "tab" },
  { command: "closeAllTabs", title: "Close All Tabs", icon: "xmark.square", hint: "⇧⌘K" },
  { command: "reopenClosedTab", title: "Reopen Closed Tab", icon: "arrow.uturn.backward", hint: "⇧⌘T", keywords: ["undo close", "restore tab"] },
  // Dia's command bar names the pinned-tab dock "Top Apps" (its favorites).
  {
    command: "togglePin",
    title: ({ tab }) => (tab?.pinned ? "Unpin from Top Apps" : "Move to Top Apps"),
    icon: "pin",
    keywords: ["pin", "unpin", "pin tab", "unpin tab", "remove from top apps", "favorites"],
    needs: "tab",
  },
  { command: "duplicateTab", title: "Duplicate Tab", icon: "plus.square.on.square", needs: "tab" },
  { command: "renameTab", title: "Rename Tab", icon: "pencil", needs: "tab" },
  { command: "searchTabs", title: "Search Tabs", icon: "magnifyingglass", hint: "⇧⌘A" },
  { command: "cleanUpTabs", title: "Clean Up Tabs", icon: "sparkles", hint: "⌥⌘K", keywords: ["tidy tabs"] },
  { command: "newGroupWithTabs", title: "New Group with Tab", icon: "folder.badge.plus", hint: "⌃⌘N", keywords: ["tab group"], needs: "tab" },
  { command: "reload", title: "Reload Page", icon: "arrow.clockwise", hint: "⌘R", keywords: ["refresh"], needs: page },
  { command: "forceReload", title: "Force Reload Page", icon: "arrow.clockwise", hint: "⇧⌘R", keywords: ["hard reload", "hard refresh"], needs: page },
  { command: "toggleMute", title: ({ tab }) => (tab?.muted ? "Unmute Site" : "Mute Site"), icon: "speaker.slash", keywords: ["mute", "unmute", "silence"], needs: page },
  { command: "copyUrl", title: "Copy URL", icon: "link", hint: "⇧⌘C", keywords: ["copy link"], needs: page },
  { command: "copyUrlAsMarkdown", title: "Copy URL as Markdown", icon: "link", hint: "⌥⇧⌘C", keywords: ["markdown link"], needs: page },
  { command: "findInPage", title: "Find in Page", icon: "text.magnifyingglass", hint: "⌘F", needs: page },
  {
    command: "bookmarkPage",
    title: ({ s, windowId, tab }) =>
      tab?.url && isBookmarked(s.bookmarks, bookmarkProfileId(s, s.windows[windowId]), tab.url) ? "Remove Bookmark" : "Bookmark This Page",
    icon: "bookmark",
    hint: "⌘D",
    keywords: ["add bookmark", "bookmark"],
    needs: page,
  },
  { command: "print", title: "Print", icon: "printer", hint: "⌘P", needs: page },
  { command: "share", title: "Share", icon: "square.and.arrow.up", needs: page },
  { command: "zoomIn", title: "Zoom In", icon: "plus.magnifyingglass", hint: "⌘+", needs: page },
  { command: "zoomOut", title: "Zoom Out", icon: "minus.magnifyingglass", hint: "⌘-", needs: page },
  { command: "zoomReset", title: "Actual Size", icon: "1.magnifyingglass", hint: "⌘0", keywords: ["reset zoom"], needs: page },
  { command: "devTools", title: "Developer Tools", icon: "hammer", hint: "⌥⌘I", keywords: ["inspect", "devtools", "console"], needs: page },
  { command: "toggleFullUrl", title: ({ s }) => (s.settings.showFullUrl ? "Show Page Title" : "Show Full URL"), icon: "text.alignleft" },
  { command: "toggleSidebar", title: "Auto-Hide Tabs", icon: "sidebar.left", hint: "⌘S", keywords: ["toggle sidebar", "hide sidebar", "show sidebar", "focus mode"] },
  { command: "toggleBookmarksBar", title: "Toggle Bookmarks Bar", icon: "menubar.rectangle", hint: "⇧⌘B", keywords: ["bookmarks bar"] },
  { command: "downloads", title: "Downloads", icon: "arrow.down.circle", hint: "⇧⌘J", keywords: ["show downloads", "dl"] },
  { command: "showHistory", title: "History", icon: "clock", hint: "⌘Y", keywords: ["show history"] },
  { command: "manageBookmarks", title: "Bookmarks", icon: "book", hint: "⌥⌘B", keywords: ["manage bookmarks", "show bookmarks"] },
  { command: "openSettings", title: "Settings", icon: "gearshape", hint: "⌘,", keywords: ["preferences", "prefs", "options"] },
  { command: "clearBrowsingData", title: "Clear Browsing Data", icon: "trash", keywords: ["clear history", "clear cache", "clear cookies"] },
  { command: "importBrowserData", title: "Import Browser Data", icon: "square.and.arrow.down", keywords: ["import bookmarks", "import passwords"] },
  { command: "keyboardShortcuts", title: "Keyboard Shortcuts", icon: "keyboard", keywords: ["shortcuts", "hotkeys"] },
  { command: "mergeAllWindows", title: "Merge All Windows", icon: "rectangle.stack", needs: "profiles" },
  { command: "newProfile", title: "New Profile", icon: "person.crop.circle.badge.plus", keywords: ["create profile"], needs: "profiles" },
  { command: "setAppearance", arg: "dark", title: "Dark Appearance", icon: "moon", keywords: ["dark mode"] },
  { command: "setAppearance", arg: "light", title: "Light Appearance", icon: "sun.max", keywords: ["light mode"] },
  { command: "setAppearance", arg: "auto", title: "Use System Appearance", icon: "circle.lefthalf.filled", keywords: ["auto appearance", "system appearance"] },
];

const actionId = (d: Pick<ActionDef, "command" | "arg">) => (d.arg ? `${d.command}:${d.arg}` : d.command);

/** The actions available in `windowId` right now, with their current titles. */
export function barActions(s: BrowserState, windowId: string): CommandAction[] {
  const w = s.windows[windowId];
  const tab = activeTab(s, windowId);
  const c: Context = { s, windowId, tab };
  const out: CommandAction[] = [];
  for (const d of DEFS) {
    if (d.needs === "page" && !tab?.url) continue;
    if (d.needs === "tab" && !tab) continue;
    if (d.needs === "profiles" && w?.incognito) continue;
    out.push({
      id: actionId(d),
      title: typeof d.title === "string" ? d.title : d.title(c),
      icon: d.icon,
      ...(d.hint ? { hint: d.hint } : {}),
      ...(d.keywords ? { keywords: d.keywords } : {}),
    });
  }
  // "Switch to <Profile>": Dia's profiles replace Spaces, so switching is a common command.
  if (w && !w.incognito) {
    s.profileOrder.forEach((id, i) => {
      if (id === w.profileId) return;
      const name = s.profiles[id]?.name ?? "";
      out.push({ id: `switchProfile:${id}`, title: `Switch to ${name}`, icon: "person.crop.circle", hint: i < 9 ? `⌃${i + 1}` : undefined, keywords: [name, "profile"] });
    });
  }
  return out;
}

/** Runs an action picked in the bar (after the bar has closed, so ⌘W-style commands hit the page). */
export function runBarAction(id: string, windowId: string) {
  const i = id.indexOf(":");
  const command = (i < 0 ? id : id.slice(0, i)) as BrowserCommand;
  const arg = i < 0 ? null : id.slice(i + 1);
  runCommand({ command, arg, windowId });
}

/** For dev tooling / tests: every action id the bar knows. */
export const allBarActionIds = () => DEFS.map(actionId);

/** Current state snapshot for the bar (actions are cheap to rebuild per query). */
export const currentBarActions = (windowId: string) => barActions(useBrowser.getState(), windowId);
