import { BrowserWindow, Menu, app, ipcMain } from "electron";
import type { Input, MenuItemConstructorOptions, WebContents } from "electron";
import {
  BROWSER_COMMAND_CHANNEL,
  BROWSER_MENU_STATE_CHANNEL,
  isBrowserCommandName,
  isRepeatableBrowserCommand,
  type BrowserCommand,
  type BrowserCommandName,
  type BrowserMenuItemSnapshot,
  type BrowserMenuState,
} from "../shared/browser-commands";
import type { ExtensionManager } from "./extensions";

const emptyMenuState: BrowserMenuState = {
  tabCount: 0,
  nav: { canGoBack: false, canGoForward: false },
  recentBookmarks: [],
  recentHistory: [],
  recentlyClosedTabs: [],
};

let menuState = emptyMenuState;
let menuStateRegistered = false;
let extensionManager: ExtensionManager | null = null;

export function registerBrowserShortcuts(manager?: ExtensionManager) {
  extensionManager = manager ?? null;
  rebuildApplicationMenu();
  registerMenuStateUpdates();
  registerInputShortcuts();
}

function createMenuTemplate(): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: "File",
      submenu: [
        browserCommandItem("New Tab", "new-tab", {
          accelerator: "CommandOrControl+T",
        }),
        browserCommandItem("Reopen Closed Tab", "reopen-closed-tab", {
          accelerator: "Shift+CommandOrControl+T",
          enabled: menuState.recentlyClosedTabs.length > 0,
        }),
        { type: "separator" },
        browserCommandItem("Close Tab", "close-tab", {
          accelerator: "CommandOrControl+W",
          enabled: !!menuState.activeTab,
        }),
        ...(process.platform === "darwin"
          ? []
          : ([{ type: "separator" }, { role: "quit" }] as const)),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        browserCommandItem("Focus Address Bar", "focus-omnibox", {
          accelerator: "CommandOrControl+L",
        }),
        browserCommandItem("Keyboard Shortcuts", "open-keybinds", {
          accelerator: "CommandOrControl+/",
        }),
        { type: "separator" },
        browserCommandItem("Reload", "reload", {
          accelerator: "CommandOrControl+R",
        }),
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Tabs",
      submenu: [
        browserCommandItem("Go Back", "go-back", {
          accelerator: "CommandOrControl+[",
          enabled: menuState.nav.canGoBack,
        }),
        browserCommandItem("Go Forward", "go-forward", {
          accelerator: "CommandOrControl+]",
          enabled: menuState.nav.canGoForward,
        }),
        { type: "separator" },
        browserCommandItem("Next Tab", "next-tab", {
          accelerator: "Shift+CommandOrControl+]",
          enabled: hasMultipleTabs(),
        }),
        browserCommandItem("Previous Tab", "previous-tab", {
          accelerator: "Shift+CommandOrControl+[",
          enabled: hasMultipleTabs(),
        }),
        { type: "separator" },
        browserCommandItem("Search Tabs...", "search-tabs", {
          accelerator: "Shift+CommandOrControl+A",
        }),
        { type: "separator" },
        browserCommandItem(
          menuState.activeTab?.pinned ? "Unpin" : "Pin",
          "toggle-pin-tab",
          { enabled: !!menuState.activeTab },
        ),
        { type: "separator" },
        browserCommandItem("Duplicate", "duplicate-tab", {
          enabled: !!menuState.activeTab,
        }),
        { type: "separator" },
        browserCommandItem("New Group with Tab", "new-group-with-tab", {
          enabled: !!menuState.activeTab,
        }),
        { type: "separator" },
        browserCommandItem("Rename...", "rename-tab", {
          enabled: !!menuState.activeTab,
        }),
        { label: "Change Icon...", enabled: false },
      ],
    },
    {
      label: "Bookmarks",
      submenu: [
        browserCommandItem("Bookmark This Page", "bookmark-page", {
          accelerator: "CommandOrControl+D",
          enabled: !!menuState.activeTab?.bookmarkable,
        }),
        browserCommandItem("Manage Bookmarks", "manage-bookmarks", {
          accelerator: "Alt+CommandOrControl+B",
        }),
        { type: "separator" },
        { label: "Recent Bookmarks", enabled: false },
        ...recentUrlItems(menuState.recentBookmarks.slice(0, 5)),
        { type: "separator" },
        bookmarkFolderMenu("Bookmarks Bar"),
        bookmarkFolderMenu("Other Bookmarks"),
      ],
    },
    {
      label: "History",
      submenu: [
        { label: "Recently Closed", enabled: false },
        ...recentUrlItems(menuState.recentlyClosedTabs.slice(0, 5)),
        { type: "separator" },
        { label: "Recent History", enabled: false },
        ...recentUrlItems(menuState.recentHistory.slice(0, 5)),
        { type: "separator" },
        {
          label: "See More",
          submenu: recentUrlItems(menuState.recentHistory.slice(5, 17)),
          enabled: menuState.recentHistory.length > 5,
        },
        { type: "separator" },
        browserCommandItem("Show History...", "show-history", {
          accelerator: "CommandOrControl+Y",
        }),
      ],
    },
    {
      label: "Extensions",
      submenu: extensionMenuItems(),
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        ...(process.platform === "darwin"
          ? ([{ role: "zoom" }, { type: "separator" }, { role: "front" }] as const)
          : ([{ role: "close" }] as const)),
      ],
    },
  );

  return template;
}

function extensionMenuItems() {
  const extensions = extensionManager?.list() ?? [];
  const extensionItems =
    extensions.length > 0
      ? extensions.map((extension) => ({
          label: extension.name,
          submenu: [
            {
              label: extension.version ? `Version ${extension.version}` : "Loaded",
              enabled: false,
            },
            { type: "separator" },
            {
              label: "Open Extension URL",
              click: () =>
                sendBrowserCommand({
                  command: "open-url",
                  url: extension.url,
                }),
            },
            {
              label: "Remove",
              click: async () => {
                await extensionManager?.remove(extension.id);
                rebuildApplicationMenu();
              },
            },
          ],
        } satisfies MenuItemConstructorOptions))
      : [{ label: "No Extensions Installed", enabled: false }];

  return [
    ...extensionItems,
    { type: "separator" },
    {
      label: "Add Extension...",
      click: () =>
        sendBrowserCommand({
          command: "open-url",
          url: "https://chromewebstore.google.com/category/extensions",
        }),
    },
    {
      label: "Install Unpacked Extension...",
      click: async () => {
        await extensionManager?.installUnpacked(getCommandTargetWindow());
        rebuildApplicationMenu();
      },
      enabled: !!extensionManager,
    },
    {
      label: "Manage Extensions...",
      click: () =>
        sendBrowserCommand({
          command: "open-url",
          url: "netnyahoo://extensions",
        }),
    },
    {
      label: "Pin Extensions...",
      enabled: false,
    },
  ] satisfies MenuItemConstructorOptions[];
}

function browserCommandItem(
  label: string,
  command: BrowserCommandName,
  options: Omit<MenuItemConstructorOptions, "click" | "label"> = {},
): MenuItemConstructorOptions {
  return {
    label,
    ...options,
    click: () => sendBrowserCommand(command),
  };
}

function browserCommandUrlItem(item: BrowserMenuItemSnapshot) {
  return {
    label: item.title || item.url,
    click: () => sendBrowserCommand({ command: "open-url", url: item.url }),
  } satisfies MenuItemConstructorOptions;
}

function recentUrlItems(items: BrowserMenuItemSnapshot[]) {
  if (items.length === 0) return [{ label: "No Items", enabled: false }];
  return items.map(browserCommandUrlItem);
}

function bookmarkFolderMenu(folder: string) {
  const items = menuState.recentBookmarks.filter(
    (bookmark) => (bookmark.folder ?? "Other Bookmarks") === folder,
  );
  return {
    label: folder,
    submenu: recentUrlItems(items.slice(0, 12)),
  } satisfies MenuItemConstructorOptions;
}

function hasMultipleTabs() {
  return menuState.tabCount > 1;
}

function sendBrowserCommand(command: BrowserCommand) {
  const target = getCommandTargetWindow()?.webContents;
  if (!target) return;
  sendBrowserCommandToWebContents(target, command);
}

function sendBrowserCommandToWebContents(
  target: WebContents,
  command: BrowserCommand,
) {
  if (target.isDestroyed()) return;
  target.send(BROWSER_COMMAND_CHANNEL, command);
}

function getCommandTargetWindow() {
  return (
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
  );
}

function rebuildApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createMenuTemplate()));
}

function registerMenuStateUpdates() {
  if (menuStateRegistered) return;
  menuStateRegistered = true;

  ipcMain.on(BROWSER_MENU_STATE_CHANNEL, (_event, nextState: unknown) => {
    if (!isBrowserMenuState(nextState)) return;
    menuState = nextState;
    rebuildApplicationMenu();
  });
}

function registerInputShortcuts() {
  app.on("web-contents-created", (_event, contents) => {
    const type = contents.getType();
    if (type !== "window" && type !== "webview") return;

    contents.on("before-input-event", (event, input) => {
      const command = getBrowserCommand(input);
      if (!command) return;

      event.preventDefault();
      const target =
        type === "webview" ? contents.hostWebContents : contents;
      if (!target) return;
      sendBrowserCommandToWebContents(target, command);
    });
  });
}

function getBrowserCommand(input: Input): BrowserCommandName | null {
  if (input.type !== "keyDown") return null;
  if (input.isComposing) return null;
  if (!input.meta && !input.control) return null;

  const command = resolveBrowserCommand(input);
  if (!command) return null;

  // OS key auto-repeat fires while the shortcut is held. Pass it through only
  // for long-press commands; everything else stays one-shot per press.
  if (input.isAutoRepeat && !isRepeatableBrowserCommand(command)) return null;

  return command;
}

function resolveBrowserCommand(input: Input): BrowserCommandName | null {
  const key = input.key.toLowerCase();
  const code = input.code.toLowerCase();

  if (input.alt) {
    if (!input.shift && key === "b") return "manage-bookmarks";
    return null;
  }

  if (input.shift) {
    if (key === "t") return "reopen-closed-tab";
    if (key === "/" || key === "?" || code === "slash") return "open-keybinds";
    if (key === "a") return "search-tabs";
    if (key === "]" || code === "bracketright") return "next-tab";
    if (key === "[" || code === "bracketleft") return "previous-tab";
    return null;
  }

  const tabIndexCommand = getTabIndexCommand(key, code);
  if (tabIndexCommand) return tabIndexCommand;

  if (key === "t") return "new-tab";
  if (key === "w") return "close-tab";
  if (key === "l") return "focus-omnibox";
  if (key === "/" || code === "slash") return "open-keybinds";
  if (key === "r") return "reload";
  if (key === "d") return "bookmark-page";
  if (key === "y") return "show-history";
  if (key === "arrowleft" || code === "bracketleft") return "go-back";
  if (key === "arrowright" || code === "bracketright") return "go-forward";

  return null;
}

function getTabIndexCommand(
  key: string,
  code: string,
): BrowserCommandName | null {
  const digit = getShortcutDigit(key, code);
  if (digit < 1 || digit > 9) return null;
  const command = `select-tab-${digit}`;
  return isBrowserCommandName(command) ? command : null;
}

function getShortcutDigit(key: string, code: string): number {
  if (/^[1-9]$/.test(key)) return Number(key);

  const digitCode = /^(?:digit|numpad)([1-9])$/.exec(code);
  return digitCode ? Number(digitCode[1]) : 0;
}

function isBrowserMenuState(value: unknown): value is BrowserMenuState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as BrowserMenuState;
  return (
    isNavState(candidate.nav) &&
    typeof candidate.tabCount === "number" &&
    Array.isArray(candidate.recentBookmarks) &&
    Array.isArray(candidate.recentHistory) &&
    Array.isArray(candidate.recentlyClosedTabs)
  );
}

function isNavState(value: unknown): value is BrowserMenuState["nav"] {
  if (!value || typeof value !== "object") return false;
  const nav = value as BrowserMenuState["nav"];
  return (
    typeof nav.canGoBack === "boolean" &&
    typeof nav.canGoForward === "boolean"
  );
}
