import type { BrowserState } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { useTabState } from "../../store/tabWatch";
import type { Tab } from "../../store/types";

// What a sidebar row shows of its tab, in one read: the tab and its flags (one number). Woken only when this tab changes,
// goes active or is selected (store/tabWatch.ts useTabState): a sidebar has hundreds of rows, and none of them runs a
// selector for a store update that isn't about it.

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

type RowState = { tab: Tab | undefined; flags: number };
const sameRow = (a: RowState, b: RowState) => a.tab === b.tab && a.flags === b.flags;

export const useRowState = (tabId: string, windowId: string): RowState =>
  useTabState(tabId, (s) => ({ tab: s.tabs[tabId], flags: rowFlags(s, windowId, tabId) }), sameRow);
