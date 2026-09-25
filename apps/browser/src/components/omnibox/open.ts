import { openWindow, switchToTab } from "../../lib/actions";
import { useBrowser } from "../../store/browser";

/**
 * Where a command-bar choice opens. ↩ = this tab, ⌘↩ / ⌥↩ = a new tab (Dia / Chrome),
 * ⇧↩ = a new window (Chrome).
 */
export type Disposition = "current" | "newTab" | "newWindow";

/** Keyboard modifiers of a submit → where it opens. */
export function dispositionFor(mods: { metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): Disposition {
  if (mods.metaKey || mods.altKey) return "newTab";
  if (mods.shiftKey) return "newWindow";
  return "current";
}

/** Opens `url` from the bar that belongs to `tabId` (its window and profile). */
export function openFromBar(url: string, tabId: string, disposition: Disposition) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  if (!url || !tab) return;
  const w = s.windows[tab.windowId];
  if (disposition === "current") return s.navigate(tabId, url);
  s.closePanel(tab.windowId);
  if (disposition === "newTab") return void s.newTab(tab.windowId, { url, profileId: tab.profileId, openerId: tab.url ? tabId : undefined });
  openWindow(w?.incognito ? { incognito: true, url } : { profileId: tab.profileId, url });
}

/** "Switch to Tab"; with a modifier the page opens again instead, like Chrome. */
export function switchFromBar(targetTabId: string, url: string, barTabId: string, disposition: Disposition) {
  if (disposition !== "current") return openFromBar(url, barTabId, disposition);
  const s = useBrowser.getState();
  const bar = s.tabs[barTabId];
  if (bar) s.closePanel(bar.windowId);
  switchToTab(targetTabId);
}
