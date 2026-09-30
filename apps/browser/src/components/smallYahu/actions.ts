import { focus, openUrls, openWindow } from "../../lib/actions";
import { useBrowser } from "../../store/browser";
import { activeTabId, resolveWindowId } from "../../store/model";
import { isSmall, mainWindowFor } from "../../store/small";

const store = () => useBrowser.getState();

// ⌘⌥N, and links from other apps. Without a page the bar's field opens, ready to type.
export function openSmallYahu(url?: string, profileId?: string): string {
  const id = store().createWindow({ small: true, url, profileId });
  if (!url) store().openPanel(id, "");
  return id;
}

const opensInSmallYahu = (url: string) => /^(https?|file):/i.test(url);

// URLs from other apps (Launch Services, `open`, Handoff): one web link opens in its own Small Yahu, even when a
// Small Yahu is already in front; several at once, or with the setting off, open as tabs like before.
export function openExternalUrls(urls: string[]) {
  const [url] = urls;
  if (store().settings.openLinksInSmallYahu && urls.length === 1 && url && opensInSmallYahu(url)) return void openSmallYahu(url);
  const inFront = store().ui.focusedWindowId;
  openUrls(urls);
  // The tabs went to a main window; show it rather than leave them behind the Small Yahu in front.
  const target = resolveWindowId(store(), null);
  if (target && isSmall(store(), inFront)) focus(target);
}

// ⌘O / the bar's button: the live page (history, scroll, playback) moves into the frontmost main window of its
// profile, which opens if there's none, and Small Yahu closes with it.
export function openInMainWindow(windowId: string) {
  const s = store();
  if (!isSmall(s, windowId)) return;
  const tabId = activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  const target = mainWindowFor(s, tab?.profileId ?? s.windows[windowId]!.profileId);
  if (!tab?.url) {
    s.closeWindow(windowId);
    if (target) focus(target);
    else openWindow({ profileId: tab?.profileId });
    return;
  }
  const moved = s.moveTabsToWindow([tab.id], target ?? null);
  if (moved) focus(moved);
}

export function closeSmallYahu(windowId: string) {
  if (isSmall(store(), windowId)) store().closeWindow(windowId);
}

// An Esc the page didn't want (not typed into a field, no page full screen) closes Small Yahu.
export function closeSmallYahuOnEscape(tabId: string) {
  const s = store();
  const tab = s.tabs[tabId];
  if (!tab || !isSmall(s, tab.windowId) || s.find[tabId]?.open || s.windowUi[tab.windowId]?.panel.open) return;
  closeSmallYahu(tab.windowId);
}
