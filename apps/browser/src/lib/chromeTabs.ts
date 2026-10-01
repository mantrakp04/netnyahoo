import { devWindowAction, engineInfo, chromeWindows, forgetOpenedURL, prepareTabTransfer, type TabStripPlace } from "@netnyahoo/cef";
import { usePages } from "../components/layout/pageState";
import { useBrowser, type BrowserState } from "../store/browser";
import { engineProfile } from "../store/model";
import { splitOf } from "../store/splits";
import { isChromeSwitch } from "./tabStripEcho";
import { webviews } from "./webviews";

let started = false;

if (__DEV__) (globalThis as { nnChromeTabs?: unknown }).nnChromeTabs = { chromeWindows, engineInfo, devWindowAction };

export function startChromeTabs() {
  if (started) return;
  started = true;
  scheduleStripSync();
  useBrowser.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs) {
      announceMoves(s, prev);
      forgetUnopened(s, prev);
    }
    if (s.windows !== prev.windows || s.tabs !== prev.tabs) scheduleStripSync();
  });
  usePages.subscribe((s, prev) => {
    if (s.browsers !== prev.browsers) scheduleStripSync();
  });
}

const liveTabs = () =>
  new Map(
    Object.entries(usePages.getState().browsers)
      .filter(([, tabId]) => webviews.has(tabId))
      .map(([browserId, tabId]) => [tabId, browserId]),
  );

// MARK: Moves between windows

function announceMoves(s: BrowserState, prev: BrowserState) {
  let live: Map<string, string> | null = null;
  for (const [id, tab] of Object.entries(s.tabs)) {
    const before = prev.tabs[id];
    if (!before || before.windowId === tab.windowId) continue;
    if (engineProfile(before.profileId) !== engineProfile(tab.profileId)) continue;
    live ??= liveTabs();
    if (live.has(id)) prepareTabTransfer(id);
  }
}

// A tab opened behind that won't load the navigation the engine kept for it (closed before it was shown, moved to
// another profile): the engine drops it now.
function forgetUnopened(s: BrowserState, prev: BrowserState) {
  for (const id in prev.tabs) {
    const kept = prev.tabs[id]!.wakeAdoptId;
    if (!kept?.startsWith("open:")) continue;
    const now = s.tabs[id];
    if (now?.wakeAdoptId === kept || now?.adoptId === kept) continue;
    forgetOpenedURL(Number(kept.slice(5)));
  }
}

// MARK: Chrome's tab strip

const placed = new Map<string, string>();
// Ignore Chrome reports until asynchronous placement settles.
let lastPlacedAt = 0;
const ECHO_MS = 1000;
let syncQueued = false;

function scheduleStripSync() {
  if (syncQueued) return;
  syncQueued = true;
  setTimeout(() => {
    syncQueued = false;
    syncStrips();
  }, 0);
}

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
      const key = `${live.get(id)}|${index}|${tab.pinned ? 1 : 0}`;
      if (placed.get(id) === key) continue;
      placed.set(id, key);
      lastPlacedAt = Date.now();
      void webviews.get(id)?.setTabStrip(index, !!tab.pinned);
    }
  }
  for (const id of placed.keys()) if (!seen.has(id)) placed.delete(id);
}

export function onChromeTabStrip(tabId: string, place: TabStripPlace) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w) return;
  if (!!tab.pinned !== place.pinned) {
    // Reapply sidebar pin state after Chrome reports a stale placement.
    if (Date.now() - lastPlacedAt < ECHO_MS || !placed.get(tabId)?.startsWith(`${liveTabs().get(tabId)}|`)) {
      placed.delete(tabId);
      return scheduleStripSync();
    }
    placed.delete(tabId);
    s.togglePin(tabId);
  }
  const active = w.activeTabIds[tab.profileId];
  // A split pane that shows again (after another pane's page full screen, say) becomes Chrome's active tab; the
  // focused pane only changes when the user focuses a page (onPageFocus).
  if (active && active !== tabId && splitOf(s, active)?.tabIds.includes(tabId)) return;
  if (isChromeSwitch(tabId, active, place) && w.profileId === tab.profileId) s.activate(tabId);
}
