import { BrowserWindow, Menu, app, dialog, ipcMain } from "electron";
import type { Input, MenuItemConstructorOptions, WebContents } from "electron";
import { pathToFileURL } from "node:url";
import {
  BROWSER_COMMAND_CHANNEL,
  BROWSER_MENU_STATE_CHANNEL,
  BROWSER_OPEN_FILE_CHANNEL,
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
  registerFileOpen();
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
        browserCommandItem("Open File...", "open-file", {
          accelerator: "CommandOrControl+O",
        }),
        { type: "separator" },
        browserCommandItem("Close Tab", "close-tab", {
          accelerator: "CommandOrControl+W",
          enabled: !!menuState.activeTab,
        }),
        { type: "separator" },
        browserCommandItem("Save Page As...", "save-page", {
          accelerator: "CommandOrControl+S",
          enabled: !!menuState.activeTab,
        }),
        browserCommandItem("Print...", "print-page", {
          accelerator: "CommandOrControl+P",
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
        browserCommandItem("Find in Page...", "find-in-page", {
          accelerator: "CommandOrControl+F",
          enabled: !!menuState.activeTab,
        }),
        browserCommandItem("Find Next", "find-next", {
          accelerator: "CommandOrControl+G",
          enabled: !!menuState.activeTab,
        }),
        browserCommandItem("Find Previous", "find-previous", {
          accelerator: "Shift+CommandOrControl+G",
          enabled: !!menuState.activeTab,
        }),
        { type: "separator" },
        browserCommandItem("Reload", "reload", {
          accelerator: "CommandOrControl+R",
        }),
        // A real command (not the role) so it reloads the focused page inside
        // the <webview>, not the app chrome's own webContents.
        browserCommandItem("Force Reload", "force-reload", {
          accelerator: "Shift+CommandOrControl+R",
        }),
        { role: "toggleDevTools" },
        browserCommandItem("View Page Source", "view-source", {
          accelerator: "Alt+CommandOrControl+U",
          enabled: !!menuState.activeTab,
        }),
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

export function sendBrowserCommandToWebContents(
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

    const hostOf = () =>
      type === "webview" ? contents.hostWebContents : contents;

    contents.on("before-input-event", (event, input) => {
      const command = getBrowserCommand(input);
      if (!command) return;

      // Esc maps to stop-loading, but it also dismisses in-page menus/dialogs.
      // Only consume it while the guest is actually loading, so an idle page
      // keeps its own Escape behavior.
      if (command === "stop-loading" && !contents.isLoadingMainFrame()) return;

      event.preventDefault();
      const target = hostOf();
      if (!target) return;
      sendBrowserCommandToWebContents(target, command);
    });
  });

  // Mouse thumb buttons (4/5) arrive as a window-level app-command, not key
  // input. Fires reliably on Windows/Linux; harmless where macOS omits it.
  app.on("browser-window-created", (_event, window) => {
    window.on("app-command", (_appEvent, command) => {
      const browserCommand = mouseAppCommand(command);
      if (browserCommand) {
        sendBrowserCommandToWebContents(window.webContents, browserCommand);
      }
    });
  });
}

function mouseAppCommand(command: string): BrowserCommandName | null {
  if (command === "browser-backward") return "go-back";
  if (command === "browser-forward") return "go-forward";
  return null;
}

// Cmd/Ctrl+O picks a local file via the native dialog, then opens it in a new
// tab through the renderer's normal open-url flow (file:// URLs navigate the
// webview like any other page).
function registerFileOpen() {
  ipcMain.on(BROWSER_OPEN_FILE_CHANNEL, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openFile"] })
      : await dialog.showOpenDialog({ properties: ["openFile"] });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return;
    sendBrowserCommandToWebContents(event.sender, {
      command: "open-url",
      url: pathToFileURL(filePath).toString(),
    });
  });
}

function getBrowserCommand(input: Input): BrowserCommandName | null {
  if (input.type !== "keyDown") return null;
  if (input.isComposing) return null;

  // Function keys and Esc act without Cmd/Ctrl, so resolve them before the
  // modifier gate; everything else needs Cmd or Ctrl held.
  const command =
    resolveModifierlessCommand(input) ??
    (input.meta || input.control ? resolveBrowserCommand(input) : null);
  if (!command) return null;

  // OS key auto-repeat fires while the shortcut is held. Pass it through only
  // for long-press commands; everything else stays one-shot per press.
  if (input.isAutoRepeat && !isRepeatableBrowserCommand(command)) return null;

  return command;
}

// Shortcuts that fire without Cmd/Ctrl: bare Esc/function keys, plus the
// Windows/Linux Alt+D address-bar focus. Returning here bypasses the modifier
// gate in getBrowserCommand.
function resolveModifierlessCommand(input: Input): BrowserCommandName | null {
  if (input.meta || input.control) return null;
  const key = input.key.toLowerCase();
  const code = input.code.toLowerCase();

  if (input.alt) {
    // Chrome reserves Alt+D for the address bar on Windows/Linux; on macOS
    // Opt+D types a glyph, so leave it alone there.
    if (process.platform !== "darwin" && !input.shift && (key === "d" || code === "keyd")) {
      return "focus-omnibox";
    }
    return null;
  }

  if (input.shift) {
    if (key === "f3") return "find-previous";
    if (key === "f5") return "force-reload";
    return null;
  }

  // Bare Escape stops loading, but it also dismisses in-page menus/dialogs; the
  // before-input-event handler only consumes it while the guest is loading.
  if (key === "escape") return "stop-loading";
  if (key === "f3") return "find-next";
  if (key === "f5") return "reload";
  if (key === "f6") return "focus-omnibox";
  if (key === "f12") return "open-devtools";
  return null;
}

function resolveBrowserCommand(input: Input): BrowserCommandName | null {
  const key = input.key.toLowerCase();
  const code = input.code.toLowerCase();

  if (input.alt) {
    if (input.shift) return null;
    // Opt+letter is a dead key on macOS (Opt+U starts an umlaut), so match the
    // physical key code, which stays stable regardless of the composed glyph.
    if (key === "b" || code === "keyb") return "manage-bookmarks";
    if (key === "u" || code === "keyu") return "view-source";
    // mac canonical tab cycling: Cmd+Opt+Right / Cmd+Opt+Left.
    if (key === "arrowright" || code === "arrowright") return "next-tab";
    if (key === "arrowleft" || code === "arrowleft") return "previous-tab";
    return null;
  }

  if (input.shift) {
    if (key === "t") return "reopen-closed-tab";
    if (key === "/" || key === "?" || code === "slash") return "open-keybinds";
    if (key === "a") return "search-tabs";
    if (key === "r") return "force-reload";
    if (key === "g") return "find-previous";
    if (key === "]" || code === "bracketright") return "next-tab";
    if (key === "[" || code === "bracketleft") return "previous-tab";
    // Ctrl+Shift+Tab cycles to the previous tab (Windows/Linux canonical).
    if (key === "tab" || code === "tab") return "previous-tab";
    return null;
  }

  // Ctrl+Tab cycles to the next tab (Windows/Linux canonical).
  if (key === "tab" || code === "tab") return "next-tab";

  const tabIndexCommand = getTabIndexCommand(key, code);
  if (tabIndexCommand) return tabIndexCommand;

  if (key === "t") return "new-tab";
  if (key === "w") return "close-tab";
  if (key === "l") return "focus-omnibox";
  if (key === "/" || code === "slash") return "open-keybinds";
  if (key === "r") return "reload";
  if (key === "f") return "find-in-page";
  if (key === "g") return "find-next";
  if (key === "p") return "print-page";
  if (key === "s") return "save-page";
  if (key === "o") return "open-file";
  if (key === "d") return "bookmark-page";
  if (key === "y") return "show-history";
  // Ctrl+U is Chrome's canonical view-source on Windows/Linux; macOS uses the
  // Opt+Cmd+U mapping in the alt branch above (plain Cmd+U is unbound there).
  if (process.platform !== "darwin" && (key === "u" || code === "keyu")) {
    return "view-source";
  }
  if (key === "arrowleft" || code === "bracketleft") return "go-back";
  if (key === "arrowright" || code === "bracketright") return "go-forward";
  // Ctrl+PgDn / Ctrl+PgUp cycle tabs (Windows/Linux canonical).
  if (key === "pagedown" || code === "pagedown") return "next-tab";
  if (key === "pageup" || code === "pageup") return "previous-tab";

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
