import { classifyPaste, cleanUrl, searchUrl, type PasteAction } from "@arcadia/core";
import { copyText, showMenu, type MenuItem } from "@arcadia/shell";
import { NativeModules } from "react-native";
import { useBrowser } from "../../store/browser";
import { defaultSearchEngine } from "../../store/settings";
import type { Tab } from "../../store/types";

const NativeClipboard = NativeModules.Clipboard as { getString(): Promise<string> } | undefined;

export const readClipboard = (): Promise<string> => NativeClipboard?.getString().catch(() => "") ?? Promise.resolve("");

export async function clipboardPasteAction(): Promise<PasteAction | null> {
  return classifyPaste(await readClipboard());
}

export function pasteMenuItem(action: PasteAction | null): MenuItem[] {
  if (!action) return [];
  return [{ id: "pasteAndGo", title: action.kind === "go" ? "Paste and Go" : "Paste and Search", symbol: action.kind === "go" ? "arrow.right.circle" : "magnifyingglass" }];
}

export function pasteTarget(action: PasteAction): string {
  return action.kind === "go" ? action.url : searchUrl(defaultSearchEngine(useBrowser.getState().settings), action.query);
}

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
