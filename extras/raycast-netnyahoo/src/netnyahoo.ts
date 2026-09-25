import { runAppleScript, useCachedPromise } from "@raycast/utils";
import { activateScript, closeTabScript, focusTabScript, listTabsScript, parseTabs, type Tab } from "./scripts";

export type { Tab } from "./scripts";

export async function getTabs(): Promise<Tab[]> {
  return parseTabs(await runAppleScript(listTabsScript(), { timeout: 10_000 }));
}

export function useTabs() {
  return useCachedPromise(getTabs, [], { keepPreviousData: true });
}

export async function focusTab(tab: Tab) {
  await runAppleScript(focusTabScript(tab));
  await runAppleScript(activateScript());
}

export async function closeTab(tab: Tab) {
  await runAppleScript(closeTabScript(tab));
}
