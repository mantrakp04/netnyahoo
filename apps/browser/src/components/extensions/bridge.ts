import {
  onExtensionInstallPrompt,
  onExtensionActionPopup,
  onExtensionSidePanel,
  onExtensionsChanged,
  onExtensionTabsRequest,
  resolveExtensionInstallPrompt,
  webStoreExtensionId,
  type TabsRequest,
} from "@netnyahoo/nncore";
import { AppState } from "react-native";
import { openWindow } from "../../lib/actions";
import { webviews } from "../../lib/webviews";
import { useBrowser, type BrowserState } from "../../store/browser";
import { changedIds } from "../../store/changes";
import { activeTabId, engineProfile } from "../../store/model";
import { tabForBrowser, usePages } from "../layout/pageState";
import { refreshActionStates } from "./actions";
import { startExtensionSearchEngines } from "./searchEngines";
import * as state from "./state";
import {
  activateExtension,
  closeExtensionPopup,
  closeSidePanel,
  extensionProfile,
  findExtension,
  openSidePanel,
  refreshExtensions,
  showInstallPrompt,
  wantedSidePanels,
  syncSidePanel,
  useExtensions,
  windowExtensions,
} from "./state";

export function startExtensionsBridge() {
  onExtensionTabsRequest(openRequestedTab);
  startExtensionSearchEngines();
  onExtensionsChanged(({ profile }) => void refreshExtensions(profile));

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

  startActionStates();
  startSidePanels();
  startActionPopups();
  startWebStoreIntegration();
  if (__DEV__) Object.assign(globalThis, { nnExtensionsApp: { ...state, bridge: { openExtensionFromMenu } } });
}

function openRequestedTab(request: TabsRequest) {
  if (!request.url) return;
  const s = useBrowser.getState();
  const ofProfile = (id: string) => !!s.windows[id] && !s.windows[id]!.incognito && engineProfile(s.windows[id]!.profileId) === request.profile;
  const windowId =
    (request.window && s.windows[request.window] ? request.window : undefined) ??
    s.ui.focusOrder.find(ofProfile) ??
    s.ui.focusOrder.find((id) => s.windows[id]);
  const background = request.active === false;
  // A live tab Chrome made keeps its profile's cookies and storage: adopted only under an app profile on that profile,
  // in a window showing it, else in a new window of it. Without one, the URL opens afresh (and Chrome's tab goes).
  const profileId = request.adoptId
    ? windowId && ofProfile(windowId) ? s.windows[windowId]!.profileId : s.profileOrder.find((p) => engineProfile(p) === request.profile)
    : undefined;
  if (request.adoptId && profileId) {
    if (windowId && ofProfile(windowId)) s.newTab(windowId, { url: request.url, adoptId: request.adoptId, profileId, background });
    else openWindow({ url: request.url, adoptId: request.adoptId, profileId });
    return;
  }
  if (windowId) s.newTab(windowId, { url: request.url, background });
  else openWindow({ url: request.url });
}

export function openExtensionFromMenu(windowId: string, extensionId: string) {
  const ext = findExtension(extensionProfile(useBrowser.getState(), windowId), extensionId);
  if (ext) void activateExtension(windowId, ext, toolbarAnchor(windowId, ext.id));
}

export const toolbarAnchors = new Map<string, import("./state").Anchor>();
function toolbarAnchor(windowId: string, extensionId: string) {
  return toolbarAnchors.get(`${windowId}|${extensionId}`) ?? toolbarAnchors.get(`${windowId}|*`) ?? { x: 100_000, y: 13, width: 28, height: 28 };
}

// MARK: Toolbar actions

function startActionStates() {
  // Extensions change their action and side panel without telling the app (NNCore has no event for it): look again
  // every 1.5 s while the app is active. Everything the app itself changes asks at once, below.
  setInterval(() => {
    if (AppState.currentState !== "active") return;
    void refreshActionStates();
    for (const [windowId] of wantedSidePanels()) void syncSidePanel(windowId);
  }, 1500);
  // Actions are the shown tabs' own: a change to a tab in the background doesn't ask again.
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows || s.ui.focusedWindowId !== prev.ui.focusedWindowId) return void refreshActionStates();
    if (s.tabs === prev.tabs) return;
    if (s.windowOrder.some((id) => { const active = activeTabId(s, id); return !!active && s.tabs[active] !== prev.tabs[active]; })) void refreshActionStates();
  });
  useExtensions.subscribe((e, prev) => {
    if (e.lists !== prev.lists || e.popup !== prev.popup) void refreshActionStates();
  });
  usePages.subscribe((p, prev) => {
    if (p.browsers === prev.browsers) return;
    // A tab's page arriving (or replaced) is a new browser to ask about.
    void refreshActionStates();
    const actions = useExtensions.getState().actions;
    const gone = Object.keys(actions).filter((id) => !p.browsers[Number(id)]);
    if (!gone.length) return;
    const next = { ...actions };
    for (const id of gone) delete next[Number(id)];
    useExtensions.setState({ actions: next });
  });
}

// MARK: Side panels

// MARK: chrome.action.openPopup

function startActionPopups() {
  onExtensionActionPopup(({ browserId, extensionId }) => {
    const tabId = tabForBrowser(browserId);
    const windowId = tabId ? useBrowser.getState().tabs[tabId]?.windowId : undefined;
    const ext = windowId ? findExtension(extensionProfile(useBrowser.getState(), windowId), extensionId) : undefined;
    if (windowId && ext) void state.openActionPopup(windowId, ext, toolbarAnchor(windowId, ext.id), browserId);
  });
}

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
    for (const [windowId] of wantedSidePanels()) {
      if (!s.windows[windowId]) closeSidePanel(windowId);
      else void syncSidePanel(windowId);
    }
  });
  useExtensions.subscribe((e, prev) => {
    if (e.lists === prev.lists) return;
    const s = useBrowser.getState();
    for (const [windowId, extensionId] of wantedSidePanels()) {
      if (!windowExtensions(s, windowId).some((x) => x.id === extensionId)) closeSidePanel(windowId);
    }
    if (e.popup && !windowExtensions(s, e.popup.windowId).some((x) => x.id === e.popup!.extensionId)) closeExtensionPopup();
  });
}

// MARK: Chrome Web Store

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
  onExtensionInstallPrompt((prompt) => {
    const s = useBrowser.getState();
    const tabId = prompt.browserId ? tabForBrowser(prompt.browserId) : undefined;
    const windowId = (tabId && s.tabs[tabId]?.windowId) || s.ui.focusedWindowId || s.windowOrder[0];
    if (windowId) showInstallPrompt(windowId, prompt);
    else void resolveExtensionInstallPrompt(prompt.requestId, false);
  });
  const listening = new Map<string, string>();
  const listen = (tabId: string, url: string) => {
    listening.set(tabId, url);
    const web = webviews.get(tabId);
    if (!web) return void listening.delete(tabId);
    void web.evaluate<string>(STORE_SCRIPT).then((id) => {
      const s = useBrowser.getState();
      const tab = s.tabs[tabId];
      if (!tab || listening.get(tabId) !== url) return;
      const profile = extensionProfile(s, tab.windowId);
      const ext = id && webStoreExtensionId(id) ? findExtension(profile, id) : undefined;
      if (ext) void state.removeExtension(profile, ext, tab.windowId);
      if (tab.url === url) listen(tabId, url);
    });
  };
  // After the first pass, only the tabs whose page or loading state changed since `prev` are looked at.
  const sync = (s: BrowserState, prev?: BrowserState) => {
    for (const [tabId, url] of listening) if (s.tabs[tabId]?.url !== url || s.live[tabId]?.isLoading) listening.delete(tabId);
    const ids = prev ? new Set([...changedIds(s.tabs, prev.tabs), ...changedIds(s.live, prev.live)]) : Object.keys(s.tabs);
    for (const id of ids) {
      const tab = s.tabs[id];
      if (!tab || !isStorePage(tab.url) || s.live[id]?.isLoading || listening.get(id) === tab.url) continue;
      listen(id, tab.url);
    }
  };
  useBrowser.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs || s.live !== prev.live) sync(s, prev);
  });
  sync(useBrowser.getState());
}
