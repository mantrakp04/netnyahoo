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

export function isBrowserCommand(value: unknown): value is BrowserCommand {
  return (
    typeof value === "string" &&
    (browserCommands as readonly string[]).includes(value)
  );
}
