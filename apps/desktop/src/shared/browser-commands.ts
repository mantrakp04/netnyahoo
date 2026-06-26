export const BROWSER_COMMAND_CHANNEL = "netnyahoo:browser-command";
export const BROWSER_MENU_STATE_CHANNEL = "netnyahoo:browser-menu-state";
export const BROWSER_VIEW_SOURCE_CHANNEL = "netnyahoo:browser-view-source";
export const BROWSER_SAVE_PAGE_CHANNEL = "netnyahoo:browser-save-page";
export const BROWSER_OPEN_FILE_CHANNEL = "netnyahoo:browser-open-file";

export const browserCommandNames = [
  "new-tab",
  "reopen-closed-tab",
  "close-tab",
  "next-tab",
  "previous-tab",
  "select-tab-1",
  "select-tab-2",
  "select-tab-3",
  "select-tab-4",
  "select-tab-5",
  "select-tab-6",
  "select-tab-7",
  "select-tab-8",
  "select-tab-9",
  "focus-omnibox",
  "search-tabs",
  "reload",
  "force-reload",
  "stop-loading",
  "go-back",
  "go-forward",
  "find-in-page",
  "find-next",
  "find-previous",
  "print-page",
  "save-page",
  "open-file",
  "view-source",
  "open-devtools",
  "toggle-pin-tab",
  "duplicate-tab",
  "new-group-with-tab",
  "rename-tab",
  "bookmark-page",
  "manage-bookmarks",
  "show-history",
  "open-keybinds",
  "open-url",
] as const;

export const browserCommands = browserCommandNames;

export type BrowserCommandName = (typeof browserCommandNames)[number];
export type BrowserCommand =
  | BrowserCommandName
  | {
      command: BrowserCommandName;
      url?: string;
      /** open-url: open the tab behind the current one instead of focusing it. */
      background?: boolean;
    };

export interface BrowserMenuItemSnapshot {
  title: string;
  url: string;
  favicon?: string | null;
  folder?: string | null;
}

export interface BrowserMenuState {
  activeTab?: {
    title: string;
    url: string;
    pinned: boolean;
    bookmarkable: boolean;
  };
  tabCount: number;
  nav: {
    canGoBack: boolean;
    canGoForward: boolean;
  };
  recentBookmarks: BrowserMenuItemSnapshot[];
  recentHistory: BrowserMenuItemSnapshot[];
  recentlyClosedTabs: BrowserMenuItemSnapshot[];
}

/**
 * Commands that should keep firing while their shortcut is held down
 * (OS key auto-repeat / long-press). Everything else fires once per press.
 * Add a command here to give it long-press behavior — e.g. holding Cmd+W to
 * auto-close tabs one after another.
 */
export const repeatableBrowserCommands = new Set<BrowserCommandName>([
  "close-tab",
]);

export function isRepeatableBrowserCommand(command: BrowserCommandName): boolean {
  return repeatableBrowserCommands.has(command);
}

export function isBrowserCommand(value: unknown): value is BrowserCommand {
  if (isBrowserCommandName(value)) return true;
  if (!value || typeof value !== "object") return false;
  const command = (value as { command?: unknown }).command;
  if (!isBrowserCommandName(command)) return false;
  const url = (value as { url?: unknown }).url;
  if (url !== undefined && typeof url !== "string") return false;
  const background = (value as { background?: unknown }).background;
  return background === undefined || typeof background === "boolean";
}

export function isBrowserCommandName(value: unknown): value is BrowserCommandName {
  return (
    typeof value === "string" &&
    (browserCommandNames as readonly string[]).includes(value)
  );
}
