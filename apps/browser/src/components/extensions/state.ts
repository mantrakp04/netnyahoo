import {
  chooseExtensionFolder,
  configureExtension,
  ExtensionError,
  extensionActionStates,
  extensionSidePanelUrl,
  inspectUnpackedExtension,
  installExtension,
  listExtensions,
  resolveExtensionInstallPrompt,
  setExtensionEnabled,
  uninstallExtension,
  webStoreExtensionId,
  type ActionState,
  type ExtensionInstallPrompt,
  type ExtensionPackage,
  type InstalledExtension,
} from "@netnyahoo/cef";
import { confirm, showMenu } from "@netnyahoo/shell";
import { useMemo } from "react";
import { create } from "zustand";
import { openWindow } from "../../lib/actions";
import { webviews } from "../../lib/webviews";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTabId, engineProfile } from "../../store/model";
import { usePages } from "../layout/pageState";
import { openSettings } from "../settings/windows";

export type Anchor = { x: number; y: number; width: number; height: number };

export type InstallRequest = {
  windowId: string;
  profile: string;
  source: "webStore" | "unpacked";
  status: "ready" | "installing" | "error";
  pkg?: ExtensionPackage;
  error?: string;
  prompt?: ExtensionInstallPrompt;
};

type ExtensionsStore = {
  lists: Record<string, InstalledExtension[]>;
  actions: Record<number, Record<string, ActionState>>;
  /** `pageProfile`: the engine profile its page runs in. */
  popup: { windowId: string; pageProfile: string; extensionId: string; url: string; anchor: Anchor } | null;
  install: InstallRequest | null;
  pinDialog: { windowId: string } | null;
  sidePanels: Record<string, SidePanel>;
};

export type SidePanel = {
  extensionId: string;
  /** The profile whose extension list it's from. */
  profile: string;
  /** The engine profile its page runs in: a private window's own. */
  pageProfile: string;
  url: string;
};

export const useExtensions = create<ExtensionsStore>()(() => ({ lists: {}, actions: {}, popup: null, install: null, pinDialog: null, sidePanels: {} }));

const EMPTY: InstalledExtension[] = [];

/** The profile whose extensions a window lists. Private windows are the default profile's, off the record. */
export function extensionProfile(s: BrowserState, windowId: string | null | undefined): string {
  const w = windowId ? s.windows[windowId] : undefined;
  return !w || w.incognito ? "" : engineProfile(w.profileId);
}

const isPrivate = (s: BrowserState, windowId: string) => !!s.windows[windowId]?.incognito;

/** The engine profile an extension's popup or side panel runs in: a private window's own. */
const pageProfile = (s: BrowserState, windowId: string) =>
  isPrivate(s, windowId) ? engineProfile(s.windows[windowId]!.profileId) : extensionProfile(s, windowId);

/**
 * Whether a window shows an extension. A private window shows only extensions allowed in incognito whose pages
 * Chrome runs in the private profile (split mode); a spanning one's popup and side panel would use the regular
 * profile's storage and sign-ins.
 */
const showsExtension = (priv: boolean, ext: InstalledExtension) => ext.enabled && (!priv || (ext.incognito && !!ext.incognitoSplit));

export function useWindowExtensions(windowId: string): InstalledExtension[] {
  const profile = useBrowser((s) => extensionProfile(s, windowId));
  const priv = useBrowser((s) => isPrivate(s, windowId));
  const list = useExtensionList(profile);
  return useMemo(() => list.filter((x) => showsExtension(priv, x)), [list, priv]);
}

export function windowExtensions(s: BrowserState, windowId: string | undefined): InstalledExtension[] {
  if (!windowId) return EMPTY;
  const priv = isPrivate(s, windowId);
  return (useExtensions.getState().lists[extensionProfile(s, windowId)] ?? EMPTY).filter((x) => showsExtension(priv, x));
}

const shownIn = (windowId: string, extensionId: string) => windowExtensions(useBrowser.getState(), windowId).find((x) => x.id === extensionId);

export function useExtensionList(profile: string): InstalledExtension[] {
  return useExtensions((e) => e.lists[profile] ?? EMPTY);
}

const loading = new Map<string, Promise<InstalledExtension[]>>();

export function refreshExtensions(profile: string): Promise<InstalledExtension[]> {
  const running = loading.get(profile);
  if (running) return running;
  const job = listExtensions(profile)
    .then((list) => {
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      useExtensions.setState((e) => ({ lists: { ...e.lists, [profile]: list } }));
      return list;
    })
    .catch((error) => {
      console.warn("[extensions] list failed", error);
      return useExtensions.getState().lists[profile] ?? EMPTY;
    })
    .finally(() => loading.delete(profile));
  loading.set(profile, job);
  return job;
}

export const findExtension = (profile: string, id: string) => useExtensions.getState().lists[profile]?.find((x) => x.id === id);

// MARK: Installing

export function addFromWebStore(windowId: string, urlOrId: string, profile = extensionProfile(useBrowser.getState(), windowId)) {
  const id = webStoreExtensionId(urlOrId);
  if (!id) {
    const pkg = { name: "Extension", version: "", description: "", manifestVersion: 3, icon: null, permissions: [], optionalPermissions: [], hostPermissions: [], hasAction: false, popup: null, optionsPage: null, sidePanel: null, path: "" };
    useExtensions.setState({ install: { windowId, profile, source: "webStore", status: "error", pkg, error: "That isn't a link to an extension in the Chrome Web Store." } });
    return;
  }
  const url = `https://chromewebstore.google.com/detail/${id}`;
  const s = useBrowser.getState();
  const target = s.windows[windowId] ? windowId : s.ui.focusOrder.find((w) => s.windows[w] && extensionProfile(s, w) === profile && !s.windows[w]!.incognito);
  if (target) s.newTab(target, { url });
  else openWindow({ profileId: s.profileOrder.find((p) => engineProfile(p) === profile), url });
}

export async function loadUnpacked(windowId: string, profile = extensionProfile(useBrowser.getState(), windowId)) {
  const path = await chooseExtensionFolder();
  if (!path) return;
  try {
    const pkg = await inspectUnpackedExtension(path);
    useExtensions.setState({ install: { windowId, profile, source: "unpacked", status: "ready", pkg } });
  } catch (error) {
    useExtensions.setState({ install: { windowId, profile, source: "unpacked", status: "error", error: message(error) } });
  }
}

export function showInstallPrompt(windowId: string, prompt: ExtensionInstallPrompt) {
  const current = useExtensions.getState().install;
  if (current?.prompt) void resolveExtensionInstallPrompt(current.prompt.requestId, false);
  else cancelInstall();
  const pkg: ExtensionPackage = {
    id: prompt.id,
    name: prompt.name,
    version: prompt.version,
    description: "",
    manifestVersion: 3,
    icon: prompt.icon || null,
    permissions: [],
    optionalPermissions: [],
    hostPermissions: [],
    hasAction: false,
    popup: null,
    optionsPage: null,
    sidePanel: null,
    path: "",
  };
  useExtensions.setState({ install: { windowId, profile: prompt.profile, source: "webStore", status: "ready", pkg, prompt } });
}

export async function confirmInstall() {
  const request = useExtensions.getState().install;
  if (!request?.pkg || request.status !== "ready") return;
  if (request.prompt) {
    useExtensions.setState({ install: null });
    await resolveExtensionInstallPrompt(request.prompt.requestId, true);
    for (const ms of [1500, 5000]) setTimeout(() => void refreshExtensions(request.profile), ms);
    return;
  }
  useExtensions.setState({ install: { ...request, status: "installing" } });
  try {
    await installExtension(request.pkg, request.profile);
    useExtensions.setState({ install: null });
    await refreshExtensions(request.profile);
  } catch (error) {
    useExtensions.setState({ install: { ...request, status: "error", error: message(error) } });
  }
}

export function cancelInstall() {
  const request = useExtensions.getState().install;
  if (!request) return;
  if (request.prompt) void resolveExtensionInstallPrompt(request.prompt.requestId, false);
  useExtensions.setState({ install: null });
}

// MARK: Managing

export async function removeExtension(profile: string, ext: InstalledExtension, windowId?: string) {
  const { confirmed } = await confirm({
    title: `Remove “${ext.name}”?`,
    message: ext.fromWebStore ? "Its data and settings will be removed too." : "The extension's folder stays on your Mac.",
    confirmTitle: "Remove",
    destructive: true,
    windowId,
  });
  if (!confirmed) return;
  if (useExtensions.getState().popup?.extensionId === ext.id) closeExtensionPopup();
  closeSidePanelsOf(ext.id);
  try {
    await uninstallExtension(ext.id, profile);
  } finally {
    await refreshExtensions(profile);
  }
}

export async function setEnabled(profile: string, id: string, enabled: boolean) {
  patchExtension(profile, id, { enabled, state: enabled ? "ENABLED" : "DISABLED" });
  try {
    await setExtensionEnabled(id, profile, enabled);
  } finally {
    await refreshExtensions(profile);
  }
}

export async function setPinned(profile: string, id: string, pinned: boolean) {
  patchExtension(profile, id, { pinned });
  try {
    await configureExtension(id, profile, { pinned });
  } catch {
    await refreshExtensions(profile);
  }
}

export async function configure(profile: string, id: string, options: Parameters<typeof configureExtension>[2]) {
  try {
    await configureExtension(id, profile, options);
  } finally {
    await refreshExtensions(profile);
  }
}

function patchExtension(profile: string, id: string, patch: Partial<InstalledExtension>) {
  useExtensions.setState((e) => ({
    lists: { ...e.lists, [profile]: (e.lists[profile] ?? EMPTY).map((x) => (x.id === id ? { ...x, ...patch } : x)) },
  }));
}

export function openOptions(windowId: string, ext: InstalledExtension) {
  if (ext.optionsUrl) useBrowser.getState().newTab(windowId, { url: ext.optionsUrl });
}

export const openManageExtensions = () => openSettings("extensions");
export const openPinDialog = (windowId: string) => useExtensions.setState({ pinDialog: { windowId } });
export const openWebStore = (windowId: string) =>
  useBrowser.getState().newTab(windowId, { url: "https://chromewebstore.google.com/category/extensions" });

// MARK: Action popups

export async function activateExtension(windowId: string, ext: InstalledExtension, anchor: Anchor, state?: ActionState | null) {
  const current = useExtensions.getState().popup;
  if (current?.windowId === windowId && current.extensionId === ext.id) return closeExtensionPopup();
  if (!ext.enabled) return void showExtensionMenu(windowId, ext);
  if (!shownIn(windowId, ext.id)) return;
  const s = useBrowser.getState();
  const tabId = activeTabId(s, windowId);
  const web = tabId ? webviews.get(tabId) : undefined;
  const result = web ? await web.executeExtensionAction(ext.id) : null;
  // The extensions menu and shortcuts pass no state; the tab's popup may not be the manifest's.
  const browserId = browserIdOf(tabId);
  if (!state && result === "popup" && browserId) state = (await extensionActionStates(browserId, [ext.id]))[ext.id];
  const url = state ? state.popup : ext.popup ? `chrome-extension://${ext.id}/${ext.popup.replace(/^\//, "")}` : "";
  if (result === "none") return;
  if (result === "sidePanel") return void toggleSidePanel(windowId, ext.id);
  if (!url) return void (result === null && showExtensionMenu(windowId, ext));
  useExtensions.setState({ popup: { windowId, pageProfile: pageProfile(useBrowser.getState(), windowId), extensionId: ext.id, url, anchor } });
}

// MARK: Side panels

export function browserIdOf(tabId: string | undefined): number {
  if (!tabId) return 0;
  for (const [browserId, tab] of Object.entries(usePages.getState().browsers)) if (tab === tabId) return Number(browserId);
  return 0;
}

const activeBrowserId = (windowId: string) => browserIdOf(activeTabId(useBrowser.getState(), windowId));

export async function openSidePanel(windowId: string, extensionId: string) {
  const ext = shownIn(windowId, extensionId);
  if (!ext) return;
  const s = useBrowser.getState();
  const browserId = activeBrowserId(windowId);
  // Chrome's answer for the tab is final; the manifest's path is only for a window without a tab.
  const url = browserId
    ? await extensionSidePanelUrl(browserId, extensionId)
    : !isPrivate(s, windowId) && ext.sidePanel
      ? `chrome-extension://${extensionId}/${ext.sidePanel.replace(/^\//, "")}`
      : null;
  if (!url || !shownIn(windowId, extensionId)) return;
  const panel = { extensionId, profile: extensionProfile(s, windowId), pageProfile: pageProfile(s, windowId), url };
  useExtensions.setState((e) => ({ sidePanels: { ...e.sidePanels, [windowId]: panel } }));
}

export function closeSidePanel(windowId: string, extensionId?: string) {
  const current = useExtensions.getState().sidePanels[windowId];
  if (!current || (extensionId && current.extensionId !== extensionId)) return;
  useExtensions.setState((e) => {
    const sidePanels = { ...e.sidePanels };
    delete sidePanels[windowId];
    return { sidePanels };
  });
}

export function toggleSidePanel(windowId: string, extensionId: string) {
  if (useExtensions.getState().sidePanels[windowId]?.extensionId === extensionId) closeSidePanel(windowId);
  else return openSidePanel(windowId, extensionId);
}

function closeSidePanelsOf(extensionId: string) {
  for (const [windowId, panel] of Object.entries(useExtensions.getState().sidePanels)) if (panel.extensionId === extensionId) closeSidePanel(windowId);
}

export async function syncSidePanel(windowId: string) {
  const panel = useExtensions.getState().sidePanels[windowId];
  const browserId = activeBrowserId(windowId);
  if (!panel || !browserId) return;
  const url = await extensionSidePanelUrl(browserId, panel.extensionId);
  const now = useExtensions.getState().sidePanels[windowId];
  if (now?.extensionId !== panel.extensionId) return;
  if (!url) closeSidePanel(windowId);
  else if (url !== now.url) useExtensions.setState((e) => ({ sidePanels: { ...e.sidePanels, [windowId]: { ...now, url } } }));
}

export const closeExtensionPopup = () => useExtensions.setState({ popup: null });

export async function showExtensionMenu(windowId: string, ext: InstalledExtension) {
  const profile = extensionProfile(useBrowser.getState(), windowId);
  const choice = await showMenu([
    { id: "name", title: ext.name, enabled: false },
    { separator: true },
    { id: "options", title: "Options", enabled: !!ext.optionsUrl && ext.enabled },
    ...(ext.sidePanel && ext.enabled
      ? [{ id: "sidePanel", title: useExtensions.getState().sidePanels[windowId]?.extensionId === ext.id ? "Close Side Panel" : "Open Side Panel" }]
      : []),
    { id: "pin", title: ext.pinned ? "Unpin" : "Pin", symbol: ext.pinned ? "pin.slash" : "pin" },
    { id: "enable", title: ext.enabled ? "Turn Off" : "Turn On" },
    { separator: true },
    { id: "remove", title: "Remove Extension…", enabled: ext.mayModify },
    { id: "manage", title: "Manage Extensions…" },
  ]);
  if (choice === "options") openOptions(windowId, ext);
  if (choice === "pin") void setPinned(profile, ext.id, !ext.pinned);
  if (choice === "enable") void setEnabled(profile, ext.id, !ext.enabled);
  if (choice === "remove") void removeExtension(profile, ext, windowId);
  if (choice === "sidePanel") void toggleSidePanel(windowId, ext.id);
  if (choice === "manage") openManageExtensions();
}

function message(error: unknown): string {
  if (error instanceof ExtensionError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export function extensionMenu(s: BrowserState, windowId: string | undefined) {
  return windowExtensions(s, windowId).map((x) => ({ id: x.id, title: x.name, icon: x.actionIcon || x.icon, enabled: true }));
}

if (__DEV__) (globalThis as { nnExtensionsUi?: unknown }).nnExtensionsUi = { useExtensions, confirmInstall, cancelInstall, activateExtension };
