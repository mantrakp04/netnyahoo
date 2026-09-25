import {
  extensionActionStates,
  onExtensionInstallPrompt,
  onExtensionSidePanel,
  onExtensionsChanged,
  onExtensionTabsRequest,
  resolveExtensionInstallPrompt,
  webStoreExtensionId,
  type TabsRequest,
} from "@netnyahoo/cef";
import { AppState } from "react-native";
import { openWindow } from "../../lib/actions";
import { webviews } from "../../lib/webviews";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTabId, engineProfile } from "../../store/model";
import { tabForBrowser, usePages } from "../layout/pageState";
import * as state from "./state";
import {
  activateExtension,
  browserIdOf,
  closeSidePanel,
  extensionProfile,
  findExtension,
  openSidePanel,
  refreshExtensions,
  showInstallPrompt,
  syncSidePanel,
  useExtensions,
} from "./state";

/**
 * Connects the engine's extension system to the app: pages Chrome opens outside our
 * windows, installed-list refreshes, toolbar action polling, extension side panels and
 * the Chrome Web Store's buttons. Call once.
 */
export function startExtensionsBridge() {
  onExtensionTabsRequest(openRequestedTab);
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

  startActionPolling();
  startSidePanels();
  startWebStoreIntegration();
  // Dev tooling (lib/devHarness scripts): globalThis.nnExtensionsApp.
  if (__DEV__) Object.assign(globalThis, { nnExtensionsApp: { ...state, bridge: { openExtensionFromMenu } } });
}

/** A page Chrome opened outside our windows (an extension's new window, an uninstall survey): a tab. */
function openRequestedTab(request: TabsRequest) {
  if (!request.url) return;
  const s = useBrowser.getState();
  const windowId =
    (request.window && s.windows[request.window] ? request.window : undefined) ??
    // Pages the engine opened on its own carry only a profile.
    s.ui.focusOrder.find((id) => s.windows[id] && !s.windows[id]!.incognito && engineProfile(s.windows[id]!.profileId) === request.profile) ??
    s.ui.focusOrder.find((id) => s.windows[id]);
  if (windowId) s.newTab(windowId, { url: request.url, background: request.active === false });
  else openWindow({ url: request.url });
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

// MARK: Toolbar actions

/**
 * Chrome tells no one when an extension changes its badge, title or icon, so the
 * toolbar reads the action state (straight from Chrome's ExtensionAction) of the
 * extensions it shows, for each window's active tab: on tab switches and every
 * 1.5 s while the app is active.
 */
function startActionPolling() {
  let running = false;
  // The timer only runs while the app is active; tab switches and list changes always refresh.
  const poll = async (timer = false) => {
    if (running || (timer && AppState.currentState !== "active")) return;
    running = true;
    try {
      const s = useBrowser.getState();
      const { lists, popup } = useExtensions.getState();
      for (const windowId of s.windowOrder) {
        const ids = (lists[extensionProfile(s, windowId)] ?? [])
          .filter((x) => x.enabled && x.hasAction !== false && (x.pinned || popup?.extensionId === x.id))
          .map((x) => x.id);
        const browserId = browserIdOf(activeTabId(s, windowId));
        if (!ids.length || !browserId) continue;
        const states = await extensionActionStates(browserId, ids);
        const previous = useExtensions.getState().actions[browserId];
        if (previous && JSON.stringify(previous) === JSON.stringify(states)) continue;
        useExtensions.setState((e) => ({ actions: { ...e.actions, [browserId]: states } }));
      }
      // An extension can change its side panel's page for the tab (sidePanel.setOptions).
      await Promise.all(Object.keys(useExtensions.getState().sidePanels).map((windowId) => syncSidePanel(windowId)));
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
  // Closed tabs take their states with them.
  usePages.subscribe((p, prev) => {
    if (p.browsers === prev.browsers) return;
    const actions = useExtensions.getState().actions;
    const gone = Object.keys(actions).filter((id) => !p.browsers[Number(id)]);
    if (!gone.length) return;
    const next = { ...actions };
    for (const id of gone) delete next[Number(id)];
    useExtensions.setState({ actions: next });
  });
}

// MARK: Side panels

/**
 * Chrome's side panel for extensions, drawn next to the page (SidePanel.tsx): the toolbar
 * button of an extension that opens its panel on click, the extension's own
 * chrome.sidePanel.open() / close(), and the panel following the active tab.
 */
function startSidePanels() {
  onExtensionSidePanel(({ browserId, extensionId, open }) => {
    const tabId = tabForBrowser(browserId);
    const windowId = tabId ? useBrowser.getState().tabs[tabId]?.windowId : undefined;
    if (!windowId) return;
    if (open) void openSidePanel(windowId, extensionId);
    else closeSidePanel(windowId, extensionId);
  });
  const active = (s: BrowserState) => s.windowOrder.map((id) => `${id}:${activeTabId(s, id) ?? ""}`).join(",");
  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows && s.tabs === prev.tabs) return;
    if (active(s) === active(prev)) return;
    for (const windowId of Object.keys(useExtensions.getState().sidePanels)) {
      if (!s.windows[windowId]) closeSidePanel(windowId);
      else void syncSidePanel(windowId);
    }
  });
  // An extension that goes away (turned off, removed) takes its panel with it.
  useExtensions.subscribe((e, prev) => {
    if (e.lists === prev.lists) return;
    for (const [windowId, panel] of Object.entries(e.sidePanels))
      if (!(e.lists[panel.profile] ?? []).some((x) => x.id === panel.extensionId && x.enabled)) closeSidePanel(windowId);
  });
}

// MARK: Chrome Web Store

/**
 * The store's own "Add to Chrome" button installs through Chrome (webstorePrivate), whose
 * confirmation asks through our dialog (onExtensionInstallPrompt), so every store install
 * is a real one that auto-updates. On store pages the buttons read "Add to / Remove from
 * Netnyahoo", and "Remove" asks with our sheet instead of Chrome's dialog.
 */
const STORE_SCRIPT = `
const g = window;
if (!g.__netnyahooStore) {
  const store = (g.__netnyahooStore = { waiting: null, queued: [] });
  const request = (id) => {
    if (!id) return;
    if (store.waiting) { const w = store.waiting; store.waiting = null; w(id); } else store.queued.push(id);
  };
  // "Remove from Chrome" would bring up Chrome's own dialog.
  const mg = g.chrome && g.chrome.management;
  if (mg && typeof mg.uninstall === "function") {
    Object.defineProperty(mg, "uninstall", { configurable: true, writable: true, value: (id, options, callback) => {
      request(id);
      const done = typeof options === "function" ? options : callback;
      if (typeof done === "function") { setTimeout(done); return; }
      return Promise.resolve();
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
  // Chrome's install flow (the store's own button, re-enabling…) asks through our dialog.
  onExtensionInstallPrompt((prompt) => {
    const s = useBrowser.getState();
    const tabId = prompt.browserId ? tabForBrowser(prompt.browserId) : undefined;
    const windowId = (tabId && s.tabs[tabId]?.windowId) || s.ui.focusedWindowId || s.windowOrder[0];
    if (windowId) showInstallPrompt(windowId, prompt);
    else void resolveExtensionInstallPrompt(prompt.requestId, false);
  });
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
      const profile = extensionProfile(s, tab.windowId);
      const ext = id && webStoreExtensionId(id) ? findExtension(profile, id) : undefined;
      if (ext) void state.removeExtension(profile, ext, tab.windowId);
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
