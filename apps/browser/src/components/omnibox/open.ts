import { openWindow, switchToTab } from "../../lib/actions";
import { useBrowser } from "../../store/browser";
import { originalProfile } from "../../store/small";

export type Disposition = "current" | "newTab" | "newWindow";

export function dispositionFor(mods: { metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): Disposition {
  if (mods.metaKey || mods.altKey) return "newTab";
  if (mods.shiftKey) return "newWindow";
  return "current";
}

export function openFromBar(url: string, tabId: string, disposition: Disposition) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  if (!url || !tab) return;
  const w = s.windows[tab.windowId];
  if (disposition === "current") return s.navigate(tabId, url);
  s.closePanel(tab.windowId);
  if (disposition === "newTab") return void s.newTab(tab.windowId, { url, profileId: tab.profileId, openerId: tab.url ? tabId : undefined });
  openWindow(w?.incognito ? { incognito: true, url, profileId: originalProfile(s, w) } : { profileId: tab.profileId, url });
}

export function switchFromBar(targetTabId: string, url: string, barTabId: string, disposition: Disposition) {
  if (disposition !== "current") return openFromBar(url, barTabId, disposition);
  const s = useBrowser.getState();
  const bar = s.tabs[barTabId];
  if (bar) s.closePanel(bar.windowId);
  switchToTab(targetTabId);
}
