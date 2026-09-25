import {
  extensionActionStates,
  onExtensionsChanged,
  onExtensionTabsRequest,
  resolveOpenedTab,
  setExtensionTabModel,
  webStoreExtensionId,
  type ExtensionTabModel,
  type TabsRequest,
} from "@netnyahoo/cef";
import { AppState } from "react-native";
import { closeTab, focus, openWindow } from "../../lib/actions";
import { webviews } from "../../lib/webviews";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTabId, engineProfile, incognitoProfileId, viewTabIds } from "../../store/model";
import { tabForBrowser, usePages } from "../layout/pageState";
import * as state from "./state";
import { activateExtension, addFromWebStore, extensionProfile, findExtension, refreshExtensions, useExtensions } from "./state";

/**
 * Connects the engine's extension system to the app: the tab model extension
 * pages see through chrome.tabs / chrome.windows, what they ask of it (open,
 * activate, close tabs…), installed-list refreshes, toolbar badge polling and
 * the Chrome Web Store's Add button. Call once.
 */
export function startExtensionsBridge() {
  // Window ids for extensions are small integers, stable for the session.
  const windowNumbers = new Map<string, number>();
  const windowNumber = (id: string) => {
    let n = windowNumbers.get(id);
    if (n === undefined) windowNumbers.set(id, (n = windowNumbers.size + 1));
    return n;
  };
  /** Popups and side panels: browser id → app window. */
  const views = new Map<number, string>();
  registerView = (browserId, windowId) => {
    if (windowId) views.set(browserId, windowId);
    else views.delete(browserId);
    scheduleModel();
  };

  // MARK: Tab model
  let lastModel = "";
  let modelTimer: ReturnType<typeof setTimeout> | undefined;
  const pushModel = () => {
    modelTimer = undefined;
    const model = tabModel(useBrowser.getState(), windowNumber, views);
    const json = JSON.stringify(model);
    if (json === lastModel) return;
    lastModel = json;
    void setExtensionTabModel(model);
  };
  const scheduleModel = () => {
    modelTimer ??= setTimeout(pushModel, 40);
  };
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows || s.tabs !== prev.tabs || s.ui.focusedWindowId !== prev.ui.focusedWindowId) scheduleModel();
  });
  usePages.subscribe((p, prev) => {
    if (p.browsers !== prev.browsers) scheduleModel();
  });
  useExtensions.subscribe((e, prev) => {
    if (e.lists !== prev.lists) scheduleModel();
  });
  pushModel();

  // MARK: Requests from extension pages
  onExtensionTabsRequest(handleTabsRequest);
  onExtensionsChanged(({ profile }) => void refreshExtensions(profile));

  // Every open window's extensions (the toolbars and the menu need them).
  const loaded = new Set<string>();
  const loadProfiles = (s: BrowserState) => {
    for (const id of s.windowOrder) {
      const profile = extensionProfile(s, id);
      if (loaded.has(profile)) continue;
      loaded.add(profile);
      void refreshExtensions(profile);
    }
  };
  loadProfiles(useBrowser.getState());
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows) loadProfiles(s);
  });

  startBadgePolling();
  startWebStoreIntegration();
  // Dev tooling (lib/devHarness scripts): globalThis.nnExtensionsApp.
  if (__DEV__) Object.assign(globalThis, { nnExtensionsApp: { ...state, bridge: { openExtensionFromMenu } } });
}

/** Places extension pages that aren't tabs (action popups) in a window, for chrome.windows.getCurrent. */
export let registerView: (browserId: number, windowId: string | null) => void = () => {};

function tabModel(s: BrowserState, windowNumber: (id: string) => number, views: Map<number, string>): ExtensionTabModel {
  const browsers = browserIds();
  const windows = s.windowOrder
    .filter((id) => s.windows[id])
    .map((id) => {
      const w = s.windows[id]!;
      const active = activeTabId(s, id);
      const tabs = viewTabIds(s, id)
        .map((tabId) => ({ tabId, browserId: browsers.get(tabId) }))
        .filter((t): t is { tabId: string; browserId: number } => t.browserId !== undefined)
        .map(({ tabId, browserId }) => ({ id: browserId, active: tabId === active, pinned: !!s.tabs[tabId]?.pinned }));
      // Cocoa frames are bottom-left based; extensions only use these loosely.
      const [x, y, width, height] = w.frame ?? [0, 0, 1200, 800];
      return {
        id: windowNumber(id),
        key: id,
        profile: w.incognito ? incognitoProfileId(id) : engineProfile(w.profileId),
        incognito: w.incognito,
        focused: s.ui.focusedWindowId === id,
        left: x,
        top: y,
        width,
        height,
        tabs,
      };
    });
  const viewMap: Record<string, number> = {};
  for (const [browserId, windowId] of views) if (s.windows[windowId]) viewMap[String(browserId)] = windowNumber(windowId);
  const probes: Record<string, string> = {};
  for (const [profile, list] of Object.entries(useExtensions.getState().lists)) {
    const probe = list.find((x) => x.enabled);
    if (probe) probes[profile] = probe.id;
  }
  return { windows, views: viewMap, probes };
}

/** Tab id → engine browser id. */
function browserIds() {
  const map = new Map<string, number>();
  for (const [browserId, tabId] of Object.entries(usePages.getState().browsers)) map.set(tabId, Number(browserId));
  return map;
}

function handleTabsRequest(request: TabsRequest) {
  const s = useBrowser.getState();
  const windowFor = () => {
    if (request.window && s.windows[request.window]) return request.window;
    // Pages the engine opened on its own (uninstall surveys…) carry only a profile.
    const matching = s.ui.focusOrder.filter((id) => s.windows[id] && !s.windows[id]!.incognito && engineProfile(s.windows[id]!.profileId) === request.profile);
    return matching[0] ?? s.ui.focusOrder.find((id) => s.windows[id]);
  };
  const tabFor = (browserId: number) => {
    const tabId = tabForBrowser(browserId);
    return tabId && s.tabs[tabId] ? tabId : undefined;
  };

  switch (request.action) {
    case "open": {
      if (!request.url) return request.requestId ? void resolveOpenedTab(request.requestId, 0) : undefined;
      let windowId = windowFor();
      if (!windowId || request.newWindow) {
        const profileId = request.profile && !request.profile.startsWith("incognito") ? request.profile : undefined;
        windowId = openWindow({ incognito: !!request.incognito, profileId, url: request.url });
        return request.requestId ? void resolveOpenedTab(request.requestId, 0) : undefined;
      }
      const tabId = s.newTab(windowId, { url: request.url, background: request.active === false, pinned: request.pinned });
      if (request.requestId) resolveWhenReady(tabId, request.requestId);
      return;
    }
    case "activate": {
      const tabId = tabFor(request.tabId);
      if (tabId) {
        s.activate(tabId);
        const windowId = s.tabs[tabId]!.windowId;
        if (windowId !== s.ui.focusedWindowId) focus(windowId);
      }
      return;
    }
    case "close":
      for (const id of request.tabIds) {
        const tabId = tabFor(id);
        if (tabId) void closeTab(tabId);
      }
      return;
    case "pin": {
      const tabId = tabFor(request.tabId);
      if (tabId && !!s.tabs[tabId]!.pinned !== request.pinned) s.togglePin(tabId);
      return;
    }
    case "focusWindow": {
      const windowId = windowFor();
      if (windowId) focus(windowId);
      return;
    }
    case "popup": {
      const windowId = windowFor();
      const ext = windowId ? findExtension(extensionProfile(s, windowId), request.extensionId) : undefined;
      if (windowId && ext) void activateExtension(windowId, ext, toolbarAnchor(windowId, ext.id));
      return;
    }
    case "sidePanel": {
      // No side panel UI yet: the panel page opens as a tab.
      const windowId = windowFor();
      const ext = windowId ? findExtension(extensionProfile(s, windowId), request.extensionId) : undefined;
      if (windowId && ext?.sidePanel) s.newTab(windowId, { url: `chrome-extension://${ext.id}/${ext.sidePanel.replace(/^\//, "")}` });
      return;
    }
  }
}

/** Extensions menu › an extension: its popup, from its toolbar button (or the toolbar's end). */
export function openExtensionFromMenu(windowId: string, extensionId: string) {
  const ext = findExtension(extensionProfile(useBrowser.getState(), windowId), extensionId);
  if (ext) void activateExtension(windowId, ext, toolbarAnchor(windowId, ext.id));
}

/** Where a pinned extension's button is (see ToolbarExtensions), or the toolbar's right end. */
export const toolbarAnchors = new Map<string, import("./state").Anchor>();
function toolbarAnchor(windowId: string, extensionId: string) {
  return toolbarAnchors.get(`${windowId}|${extensionId}`) ?? toolbarAnchors.get(`${windowId}|*`) ?? { x: 100_000, y: 13, width: 28, height: 28 }; // right-aligned (the popover clamps to the window)
}

/** tabs.create resolves with the new tab once its browser exists. */
function resolveWhenReady(tabId: string, requestId: string) {
  const find = () => browserIds().get(tabId);
  const now = find();
  if (now) return void resolveOpenedTab(requestId, now);
  const timer = setTimeout(() => {
    unsubscribe();
    void resolveOpenedTab(requestId, 0);
  }, 4000);
  const unsubscribe = usePages.subscribe(() => {
    const id = find();
    if (!id) return;
    clearTimeout(timer);
    unsubscribe();
    void resolveOpenedTab(requestId, id);
  });
}

// MARK: Badges

/**
 * Chrome has no event for badge/title changes, so the toolbar reads the state
 * of pinned extensions for each window's active tab: on tab switches and every
 * 1.5 s while the app is active.
 */
function startBadgePolling() {
  let running = false;
  // The timer only runs while the app is active; tab switches and list changes always refresh.
  const poll = async (timer = false) => {
    if (running || (timer && AppState.currentState !== "active")) return;
    running = true;
    try {
      const s = useBrowser.getState();
      const browsers = browserIds();
      const lists = useExtensions.getState().lists;
      const popup = useExtensions.getState().popup;
      const jobs = s.windowOrder.map(async (windowId) => {
        const profile = extensionProfile(s, windowId);
        const ids = (lists[profile] ?? [])
          .filter((x) => x.enabled && x.hasAction !== false && (x.pinned || popup?.extensionId === x.id))
          .map((x) => x.id);
        const tabId = activeTabId(s, windowId);
        const browserId = tabId ? browsers.get(tabId) : undefined;
        if (!ids.length || !browserId) return;
        const states = await extensionActionStates(profile, ids, browserId);
        const previous = useExtensions.getState().actions[browserId];
        if (previous && JSON.stringify(previous) === JSON.stringify(states)) return;
        useExtensions.setState((e) => ({ actions: { ...e.actions, [browserId]: states } }));
      });
      await Promise.all(jobs);
    } catch {
      // A closed tab or reloading extension: next round.
    } finally {
      running = false;
    }
  };
  setInterval(() => void poll(true), 1500);
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows || s.tabs !== prev.tabs || s.ui.focusedWindowId !== prev.ui.focusedWindowId) void poll();
  });
  useExtensions.subscribe((e, prev) => {
    if (e.lists !== prev.lists || e.popup !== prev.popup) void poll();
  });
}

// MARK: Chrome Web Store

/**
 * The store's "Add to Chrome" button calls chrome.webstorePrivate, which would
 * install through Chrome's own UI. On store pages the button reads "Add to
 * Netnyahoo" and opens our install dialog instead.
 */
const STORE_SCRIPT = `
const g = window;
if (!g.__netnyahooStore) {
  const store = (g.__netnyahooStore = { waiting: null, queued: [] });
  const request = (id) => {
    if (!id) return;
    if (store.waiting) { const w = store.waiting; store.waiting = null; w(id); } else store.queued.push(id);
  };
  const answer = (result, callback) => {
    if (typeof callback === "function") { setTimeout(() => callback(result)); return; }
    return Promise.resolve(result);
  };
  const wp = g.chrome && g.chrome.webstorePrivate;
  if (wp) {
    for (const name of ["beginInstallWithManifest3", "install"]) {
      if (typeof wp[name] !== "function") continue;
      Object.defineProperty(wp, name, { configurable: true, writable: true, value: (details, callback) => {
        request(details && (details.id || details.extensionId));
        return answer("user_cancelled", callback);
      } });
    }
  }
  // "Remove from Chrome" would bring up Chrome's own dialog.
  const mg = g.chrome && g.chrome.management;
  if (mg && typeof mg.uninstall === "function") {
    Object.defineProperty(mg, "uninstall", { configurable: true, writable: true, value: (id, options, callback) => {
      request("remove:" + id);
      return answer(undefined, typeof options === "function" ? options : callback);
    } });
  }
  const relabel = () => {
    for (const el of document.querySelectorAll("button, button *")) {
      if (el.childElementCount) continue;
      const t = el.textContent;
      if (t === "Add to Chrome") el.textContent = "Add to Netnyahoo";
      else if (t === "Remove from Chrome") el.textContent = "Remove from Netnyahoo";
    }
  };
  relabel();
  new MutationObserver(relabel).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
}
const store = g.__netnyahooStore;
if (store.queued.length) post("result", JSON.stringify(store.queued.shift()));
else store.waiting = (id) => post("result", JSON.stringify(id));
`;

const isStorePage = (url: string | undefined) => !!url && /^https:\/\/chromewebstore\.google\.com\//.test(url);

function startWebStoreIntegration() {
  // Tab → the page URL we're listening on (one pending evaluate per page).
  const listening = new Map<string, string>();
  const listen = (tabId: string, url: string) => {
    listening.set(tabId, url);
    const web = webviews.get(tabId);
    if (!web) return void listening.delete(tabId);
    void web.evaluate<string>(STORE_SCRIPT).then((id) => {
      const s = useBrowser.getState();
      const tab = s.tabs[tabId];
      // The page navigated away: its pending listener never answers; a new one starts below.
      if (!tab || listening.get(tabId) !== url) return;
      if (id?.startsWith("remove:")) {
        const profile = extensionProfile(s, tab.windowId);
        const ext = findExtension(profile, id.slice(7));
        if (ext) void state.removeExtension(profile, ext, tab.windowId);
      } else if (id && webStoreExtensionId(id)) void addFromWebStore(tab.windowId, id);
      if (tab.url === url) listen(tabId, url);
    });
  };
  const sync = (s: BrowserState) => {
    for (const [tabId, url] of listening) if (s.tabs[tabId]?.url !== url || s.live[tabId]?.isLoading) listening.delete(tabId);
    for (const tab of Object.values(s.tabs)) {
      if (!isStorePage(tab.url) || s.live[tab.id]?.isLoading || listening.get(tab.id) === tab.url) continue;
      listen(tab.id, tab.url);
    }
  };
  useBrowser.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs || s.live !== prev.live) sync(s);
  });
  sync(useBrowser.getState());
}
