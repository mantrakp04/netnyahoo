import { devWindowAction, engineInfo, ghostWindows, prepareTabTransfer, type TabStripPlace } from "@netnyahoo/cef";
import { usePages } from "../components/layout/pageState";
import { useBrowser, type BrowserState } from "../store/browser";
import { engineProfile } from "../store/model";
import { webviews } from "./webviews";

/**
 * Keeps the engine's tabs in step with the app's:
 * - A tab moving to another window keeps its page (history, form state, the Chrome
 *   tab) instead of reloading: the move is announced before its views re-render.
 * - With Chrome tabs (packages/cef NN_CHROME_TABS) each window's tabs of a profile are
 *   a real Chrome tab strip: its order and pins follow the sidebar, so extensions'
 *   chrome.tabs sees what the user sees; tabs an extension activates or pins come back
 *   here (`onChromeTabStrip`).
 */
let started = false;
let chromeTabs = false;

/** DEV: the ghost windows and engine state, for lib/devHarness scripts (`globalThis.nnChromeTabs`). */
if (__DEV__) (globalThis as { nnChromeTabs?: unknown }).nnChromeTabs = { ghostWindows, engineInfo, devWindowAction };

export function startChromeTabs() {
  if (started) return;
  started = true;
  void engineInfo().then((info) => {
    chromeTabs = !!info.chromeTabs;
    if (chromeTabs) scheduleStripSync();
  });
  useBrowser.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs) announceMoves(s, prev);
    if (chromeTabs && (s.windows !== prev.windows || s.tabs !== prev.tabs)) scheduleStripSync();
  });
  usePages.subscribe((s, prev) => {
    if (chromeTabs && s.browsers !== prev.browsers) scheduleStripSync();
  });
}

/** Tabs whose web view has a live browser (they're what the engine can hand over or place). */
const liveTabs = () => new Set(Object.values(usePages.getState().browsers));

// MARK: Moves between windows

function announceMoves(s: BrowserState, prev: BrowserState) {
  let live: Set<string> | null = null;
  for (const [id, tab] of Object.entries(s.tabs)) {
    const before = prev.tabs[id];
    if (!before || before.windowId === tab.windowId) continue;
    // Another profile's engine data can't take the page along.
    if (engineProfile(before.profileId) !== engineProfile(tab.profileId)) continue;
    live ??= liveTabs();
    if (live.has(id)) prepareTabTransfer(id);
  }
}

// MARK: Chrome's tab strip

/** Last place sent per tab, so unchanged tabs aren't touched. */
const placed = new Map<string, string>();
let syncQueued = false;

function scheduleStripSync() {
  if (syncQueued) return;
  syncQueued = true;
  setTimeout(() => {
    syncQueued = false;
    syncStrips();
  }, 0);
}

/**
 * Each window's tabs of a profile, in sidebar order (pinned first), are one Chrome
 * window's tab strip: index among those with a browser (Chrome only has those).
 */
function syncStrips() {
  const s = useBrowser.getState();
  const live = liveTabs();
  const seen = new Set<string>();
  for (const w of Object.values(s.windows)) {
    const indexes = new Map<string, number>();
    for (const id of w.tabIds) {
      const tab = s.tabs[id];
      if (!tab || !live.has(id)) continue;
      const profile = engineProfile(tab.profileId);
      const index = indexes.get(profile) ?? 0;
      indexes.set(profile, index + 1);
      seen.add(id);
      const key = `${index}|${tab.pinned ? 1 : 0}`;
      if (placed.get(id) === key) continue;
      placed.set(id, key);
      void webviews.get(id)?.setTabStrip(index, !!tab.pinned);
    }
  }
  for (const id of placed.keys()) if (!seen.has(id)) placed.delete(id);
}

/**
 * Chrome's tab strip changed under the app: an extension activated or pinned the tab
 * (chrome.tabs.update). Echoes of our own changes match the app already.
 */
export function onChromeTabStrip(tabId: string, place: TabStripPlace) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w) return;
  if (!!tab.pinned !== place.pinned) {
    // Ours to follow, and remembered so the next sync doesn't undo it.
    placed.delete(tabId);
    s.togglePin(tabId);
  }
  if (place.active && w.activeTabIds[tab.profileId] !== tabId && w.profileId === tab.profileId) s.activate(tabId);
}
