import type { BrowserCommand } from "../../../shared/browser-commands";

declare global {
  interface Window {
    electronTRPC?: {
      sendMessage: (message: unknown) => void;
      onMessage: (callback: (message: unknown) => void) => () => void;
    };
    netnyahooBrowserCommands?: {
      onCommand: (callback: (command: BrowserCommand) => void) => () => void;
    };
  };
}

export {};
