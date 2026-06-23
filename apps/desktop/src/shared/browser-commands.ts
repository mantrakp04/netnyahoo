export const BROWSER_COMMAND_CHANNEL = "netnyahoo:browser-command";

export const browserCommands = [
  "new-tab",
  "reopen-closed-tab",
  "close-tab",
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
  "reload",
  "go-back",
  "go-forward",
] as const;

export type BrowserCommand = (typeof browserCommands)[number];

/**
 * Commands that should keep firing while their shortcut is held down
 * (OS key auto-repeat / long-press). Everything else fires once per press.
 * Add a command here to give it long-press behavior — e.g. holding Cmd+W to
 * auto-close tabs one after another.
 */
export const repeatableBrowserCommands = new Set<BrowserCommand>([
  "close-tab",
]);

export function isRepeatableBrowserCommand(command: BrowserCommand): boolean {
  return repeatableBrowserCommands.has(command);
}

export function isBrowserCommand(value: unknown): value is BrowserCommand {
  return (
    typeof value === "string" &&
    (browserCommands as readonly string[]).includes(value)
  );
}
