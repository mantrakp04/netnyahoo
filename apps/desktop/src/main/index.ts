import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, shell } from "electron";
import { createIPCHandler } from "electron-trpc/main";
import { appRouter } from "@netnyahoo/backend";
import { getDb, initDb } from "@netnyahoo/db";
import { env } from "@netnyahoo/env";
import { registerWebviewContextMenus } from "./context-menu";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

// In dev, expose a CDP endpoint so the renderer can be inspected/automated.
if (isDev) app.commandLine.appendSwitch("remote-debugging-port", "9222");

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#1a1a1e",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  win.on("ready-to-show", () => win.show());

  // Open target=_blank / window.open links in the OS browser instead of new
  // Electron windows (chrome stays inside <webview>).
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  createIPCHandler({
    router: appRouter,
    windows: [win],
    createContext: async () => ({ db: getDb() }),
  });

  if (isDev && env.ELECTRON_RENDERER_URL) {
    win.loadURL(env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  initDb(join(app.getPath("userData"), "netnyahoo.db"));
  registerWebviewContextMenus();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
