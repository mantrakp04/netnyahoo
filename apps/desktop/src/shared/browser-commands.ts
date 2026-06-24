export const BROWSER_COMMAND_CHANNEL = "netnyahoo:browser-command";
export const BROWSER_MENU_STATE_CHANNEL = "netnyahoo:browser-menu-state";

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
  "go-back",
  "go-forward",
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
  return url === undefined || typeof url === "string";
}

export function isBrowserCommandName(value: unknown): value is BrowserCommandName {
  return (
    typeof value === "string" &&
    (browserCommandNames as readonly string[]).includes(value)
  );
}
