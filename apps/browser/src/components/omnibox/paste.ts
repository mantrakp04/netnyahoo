import { classifyPaste, cleanUrl, searchUrl, type PasteAction } from "@netnyahoo/core";
import { copyText, showMenu, type MenuItem } from "@netnyahoo/shell";
import { NativeModules } from "react-native";
import { useBrowser } from "../../store/browser";
import { defaultSearchEngine } from "../../store/settings";
import type { Tab } from "../../store/types";

// RCTClipboard still ships with react-native-macos; going through NativeModules skips the
// "Clipboard has been extracted" warning that `import { Clipboard }` logs.
const NativeClipboard = NativeModules.Clipboard as { getString(): Promise<string> } | undefined;

export const readClipboard = (): Promise<string> => NativeClipboard?.getString().catch(() => "") ?? Promise.resolve("");

/** What Paste and Go / Paste and Search would do with the clipboard right now (null: nothing to paste). */
export async function clipboardPasteAction(): Promise<PasteAction | null> {
  return classifyPaste(await readClipboard());
}

/** Dia's menu item: "Paste and Go" for a URL, "Paste and Search" for text. */
export function pasteMenuItem(action: PasteAction | null): MenuItem[] {
  if (!action) return [];
  return [{ id: "pasteAndGo", title: action.kind === "go" ? "Paste and Go" : "Paste and Search", symbol: action.kind === "go" ? "arrow.right.circle" : "magnifyingglass" }];
}

/** The URL a paste action loads (searches use the default engine). */
export function pasteTarget(action: PasteAction): string {
  return action.kind === "go" ? action.url : searchUrl(defaultSearchEngine(useBrowser.getState().settings), action.query);
}

/**
 * Right-click on the navigation bar's URL: Paste and Go / Paste and Search (when the clipboard
 * has something) and Copy URL. Resolves once the menu closes.
 */
export async function showUrlBarMenu(tab: Pick<Tab, "id" | "url">) {
  const action = await clipboardPasteAction();
  const paste = pasteMenuItem(action);
  const choice = await showMenu([
    ...paste,
    ...(paste.length ? [{ separator: true as const }] : []),
    { id: "copy", title: "Copy URL", symbol: "link" },
  ]);
  if (choice === "pasteAndGo" && action) useBrowser.getState().navigate(tab.id, pasteTarget(action));
  if (choice === "copy") copyText(cleanUrl(tab.url));
}
