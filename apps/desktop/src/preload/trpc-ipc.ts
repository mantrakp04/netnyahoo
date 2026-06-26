import { contextBridge, ipcRenderer } from "electron";
import {
  BROWSER_COMMAND_CHANNEL,
  BROWSER_MENU_STATE_CHANNEL,
  BROWSER_OPEN_FILE_CHANNEL,
  BROWSER_SAVE_PAGE_CHANNEL,
  BROWSER_VIEW_SOURCE_CHANNEL,
  isBrowserCommand,
  type BrowserCommand,
  type BrowserMenuState,
} from "../shared/browser-commands";
import {
  EXTENSIONS_INSTALL_UNPACKED_CHANNEL,
  EXTENSIONS_INSTALL_WEBSTORE_CHANNEL,
  EXTENSIONS_LIST_CHANNEL,
  EXTENSIONS_REMOVE_CHANNEL,
  type InstalledExtension,
} from "../shared/extensions";

export const ELECTRON_TRPC_CHANNEL = "electron-trpc";

export function exposeElectronTRPC() {
  contextBridge.exposeInMainWorld("electronTRPC", {
    sendMessage(message: unknown) {
      ipcRenderer.send(ELECTRON_TRPC_CHANNEL, message);
    },
    onMessage(callback: (message: unknown) => void) {
      const listener = (_event: Electron.IpcRendererEvent, message: unknown) => {
        callback(message);
      };

      ipcRenderer.on(ELECTRON_TRPC_CHANNEL, listener);
      return () => ipcRenderer.removeListener(ELECTRON_TRPC_CHANNEL, listener);
    },
  });

  contextBridge.exposeInMainWorld("netnyahooBrowserCommands", {
    onCommand(callback: (command: BrowserCommand) => void) {
      const listener = (
        _event: Electron.IpcRendererEvent,
        command: unknown,
      ) => {
        if (isBrowserCommand(command)) callback(command);
      };

      ipcRenderer.on(BROWSER_COMMAND_CHANNEL, listener);
      return () => ipcRenderer.removeListener(BROWSER_COMMAND_CHANNEL, listener);
    },
    updateMenuState(state: BrowserMenuState) {
      ipcRenderer.send(BROWSER_MENU_STATE_CHANNEL, state);
    },
    openViewSource(url: string) {
      ipcRenderer.send(BROWSER_VIEW_SOURCE_CHANNEL, url);
    },
    savePage(webContentsId: number) {
      ipcRenderer.send(BROWSER_SAVE_PAGE_CHANNEL, webContentsId);
    },
    openFile() {
      ipcRenderer.send(BROWSER_OPEN_FILE_CHANNEL);
    },
  });

  contextBridge.exposeInMainWorld("netnyahooExtensions", {
    list() {
      return ipcRenderer.invoke(
        EXTENSIONS_LIST_CHANNEL,
      ) as Promise<InstalledExtension[]>;
    },
    installUnpacked() {
      return ipcRenderer.invoke(
        EXTENSIONS_INSTALL_UNPACKED_CHANNEL,
      ) as Promise<InstalledExtension[]>;
    },
    installFromChromeWebStore(input: string) {
      return ipcRenderer.invoke(
        EXTENSIONS_INSTALL_WEBSTORE_CHANNEL,
        input,
      ) as Promise<InstalledExtension[]>;
    },
    remove(id: string) {
      return ipcRenderer.invoke(
        EXTENSIONS_REMOVE_CHANNEL,
        id,
      ) as Promise<InstalledExtension[]>;
    },
  });
}
