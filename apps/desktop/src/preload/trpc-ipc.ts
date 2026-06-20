import { contextBridge, ipcRenderer } from "electron";
import {
  BROWSER_COMMAND_CHANNEL,
  isBrowserCommand,
  type BrowserCommand,
} from "../shared/browser-commands";

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
  });
}
