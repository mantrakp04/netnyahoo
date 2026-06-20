import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, shell } from "electron";
import { appRouter, ensureDefaultTab } from "@netnyahoo/backend";
import { getDb, initDb } from "@netnyahoo/db";
import { env } from "@netnyahoo/env";
import { registerBrowserShortcuts } from "./browser-shortcuts";
import { registerWebviewContextMenus } from "./context-menu";
import { createIPCHandler } from "./trpc-ipc";
// Packaged builds get their icon from build/icon.icns via electron-builder;
// this is the runtime icon for the dev dock (macOS) and the window/taskbar
// icon on Windows & Linux. electron-vite copies it next to the bundle.
import icon from "../../resources/icon.png?asset";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
let pendingWindowCreate: Promise<BrowserWindow> | null = null;

// In dev, expose a CDP endpoint so the renderer can be inspected/automated.
if (isDev) app.commandLine.appendSwitch("remote-debugging-port", "9222");

function createWindow() {
  pendingWindowCreate ??= createWindowInner().finally(() => {
    pendingWindowCreate = null;
  });
  return pendingWindowCreate;
}

async function createWindowInner() {
  await ensureDefaultTab(getDb());

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    // macOS draws the window icon from the app bundle, not this option.
    icon,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
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

  if (isDev && env.ELECTRON_RENDERER_URL) {
    win.loadURL(env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

app.whenReady().then(async () => {
  // Show the logo in the dev dock — packaged macOS builds use the bundle icon.
  if (process.platform === "darwin" && isDev) app.dock?.setIcon(icon);
  await initDb(env.NETNYAHOO_DB_URL, {
    migrationsFolder: getMigrationsFolder(),
  });
  createIPCHandler({
    router: appRouter,
    createContext: async () => ({ db: getDb() }),
  });
  registerWebviewContextMenus();
  registerBrowserShortcuts();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function getMigrationsFolder() {
  if (!isDev) return join(process.resourcesPath, "drizzle");
  return join(__dirname, "../../../../packages/db/drizzle");
}
