export const BROWSER_COMMAND_CHANNEL = "netnyahoo:browser-command";

export const browserCommands = [
  "new-tab",
  "reopen-closed-tab",
  "close-tab",
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
