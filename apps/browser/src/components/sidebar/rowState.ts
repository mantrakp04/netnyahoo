import { useBrowser, type BrowserState } from "../../store/browser";
import { useTab } from "../../store/hooks";
import { activeTabId } from "../../store/model";
import type { Tab } from "../../store/types";

// What a sidebar row shows of its tab: the tab, and its flags in one number (a sidebar has hundreds of rows, and each
// selector runs on every store update).

export const ACTIVE = 1;
export const SELECTED = 2;
export const PLAYING = 4;
export const LOADING = 8;

export function rowFlags(s: BrowserState, windowId: string, tabId: string): number {
  const tab = s.tabs[tabId];
  const live = s.live[tabId];
  let flags = 0;
  if (tab && activeTabId(s, tab.windowId, tab.profileId) === tabId) flags |= ACTIVE;
  if (s.selection[windowId]?.includes(tabId)) flags |= SELECTED;
  if (live?.playingAudio) flags |= PLAYING;
  if (live?.isLoading) flags |= LOADING;
  return flags;
}

export function useRowState(tabId: string, windowId: string): { tab: Tab | undefined; flags: number } {
  const tab = useTab(tabId);
  const flags = useBrowser((s) => rowFlags(s, windowId, tabId));
  return { tab, flags };
}
