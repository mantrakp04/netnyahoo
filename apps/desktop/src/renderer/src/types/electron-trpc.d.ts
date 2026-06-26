import type {
  BrowserCommand,
  BrowserMenuState,
} from "../../../shared/browser-commands";
import type { InstalledExtension } from "../../../shared/extensions";

declare global {
  interface Window {
    electronTRPC?: {
      sendMessage: (message: unknown) => void;
      onMessage: (callback: (message: unknown) => void) => () => void;
    };
    netnyahooBrowserCommands?: {
      onCommand: (callback: (command: BrowserCommand) => void) => () => void;
      updateMenuState: (state: BrowserMenuState) => void;
      openViewSource: (url: string) => void;
      savePage: (webContentsId: number) => void;
      openFile: () => void;
    };
    netnyahooExtensions?: {
      list: () => Promise<InstalledExtension[]>;
      installUnpacked: () => Promise<InstalledExtension[]>;
      installFromChromeWebStore: (
        input: string,
      ) => Promise<InstalledExtension[]>;
      remove: (id: string) => Promise<InstalledExtension[]>;
    };
  };
}

export {};
