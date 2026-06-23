import { BrowserWindow, Menu, app } from "electron";
import type { Input, MenuItemConstructorOptions, WebContents } from "electron";
import {
  BROWSER_COMMAND_CHANNEL,
  isRepeatableBrowserCommand,
  type BrowserCommand,
} from "../shared/browser-commands";

export function registerBrowserShortcuts() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createMenuTemplate()));
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
        browserCommandItem("New Tab", "new-tab"),
        browserCommandItem("Reopen Closed Tab", "reopen-closed-tab"),
        { type: "separator" },
        browserCommandItem("Close Tab", "close-tab"),
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
        browserCommandItem("Focus Address Bar", "focus-omnibox"),
        browserCommandItem("Reload", "reload"),
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
      label: "Navigate",
      submenu: [
        browserCommandItem("Back", "go-back"),
        browserCommandItem("Forward", "go-forward"),
      ],
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

function browserCommandItem(
  label: string,
  command: BrowserCommand,
): MenuItemConstructorOptions {
  return {
    label,
    click: () => sendBrowserCommand(command),
  };
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

function getBrowserCommand(input: Input): BrowserCommand | null {
  if (input.type !== "keyDown") return null;
  if (input.isComposing) return null;
  if (input.alt || (!input.meta && !input.control)) return null;

  const command = resolveBrowserCommand(input);
  if (!command) return null;

  // OS key auto-repeat fires while the shortcut is held. Pass it through only
  // for long-press commands; everything else stays one-shot per press.
  if (input.isAutoRepeat && !isRepeatableBrowserCommand(command)) return null;

  return command;
}

function resolveBrowserCommand(input: Input): BrowserCommand | null {
  const key = input.key.toLowerCase();
  const code = input.code.toLowerCase();

  if (input.shift && key === "t") return "reopen-closed-tab";
  if (input.shift) return null;

  const tabIndexCommand = getTabIndexCommand(key, code);
  if (tabIndexCommand) return tabIndexCommand;

  if (key === "t") return "new-tab";
  if (key === "w") return "close-tab";
  if (key === "l") return "focus-omnibox";
  if (key === "r") return "reload";
  if (key === "arrowleft" || code === "bracketleft") return "go-back";
  if (key === "arrowright" || code === "bracketright") return "go-forward";

  return null;
}

function getTabIndexCommand(
  key: string,
  code: string,
): BrowserCommand | null {
  const digit = getShortcutDigit(key, code);
  if (digit < 1 || digit > 9) return null;
  return `select-tab-${digit}` as BrowserCommand;
}

function getShortcutDigit(key: string, code: string): number {
  if (/^[1-9]$/.test(key)) return Number(key);

  const digitCode = /^(?:digit|numpad)([1-9])$/.exec(code);
  return digitCode ? Number(digitCode[1]) : 0;
}
