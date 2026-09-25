import {
  chooseExtensionFolder,
  configureExtension,
  discardExtensionPackage,
  ExtensionError,
  inspectUnpackedExtension,
  installExtension,
  listExtensions,
  prepareWebStoreExtension,
  resolveExtensionInstallPrompt,
  setExtensionEnabled,
  supportsExtensionInstallPrompt,
  uninstallExtension,
  webStoreExtensionId,
  type ActionState,
  type ExtensionInstallPrompt,
  type ExtensionPackage,
  type InstalledExtension,
} from "@netnyahoo/cef";
import { confirm, showMenu } from "@netnyahoo/shell";
import { create } from "zustand";
import { webviews } from "../../lib/webviews";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTabId, engineProfile } from "../../store/model";
import { openSettings } from "../settings/windows";

/** Window coordinates of the control a popover hangs from. */
export type Anchor = { x: number; y: number; width: number; height: number };

export type InstallRequest = {
  windowId: string;
  profile: string;
  source: "webStore" | "unpacked";
  status: "downloading" | "ready" | "installing" | "error";
  pkg?: ExtensionPackage;
  error?: string;
  /** Chrome's own install flow is asking (the store's button, a re-enable…): it installs on accept. */
  prompt?: ExtensionInstallPrompt;
};

type ExtensionsStore = {
  /** Installed extensions per extension profile ("" = default; see `extensionProfile`). */
  lists: Record<string, InstalledExtension[]>;
  /** Toolbar action state by tab (browser id), then extension id. */
  actions: Record<number, Record<string, ActionState>>;
  /** The action popup that's open (one at a time, like Chrome). */
  popup: { windowId: string; profile: string; extensionId: string; url: string; anchor: Anchor } | null;
  install: InstallRequest | null;
  /** Extensions › Pin Extensions… */
  pinDialog: { windowId: string } | null;
};

export const useExtensions = create<ExtensionsStore>()(() => ({ lists: {}, actions: {}, popup: null, install: null, pinDialog: null }));

const EMPTY: InstalledExtension[] = [];

/**
 * The profile whose extensions a window uses. Incognito windows run the default
 * profile's extensions (the ones allowed in incognito), like Chrome.
 */
export function extensionProfile(s: BrowserState, windowId: string | null | undefined): string {
  const w = windowId ? s.windows[windowId] : undefined;
  return !w || w.incognito ? "" : engineProfile(w.profileId);
}

export function useExtensionList(profile: string): InstalledExtension[] {
  return useExtensions((e) => e.lists[profile] ?? EMPTY);
}

const loading = new Map<string, Promise<InstalledExtension[]>>();

/** Reloads a profile's list from the engine (coalesced). */
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

/**
 * Web Store link or id → the install dialog. With Chrome's install flow (it asks through our
 * dialog, and its store installs auto-update) that's the store's own page and Add button;
 * otherwise we download and verify the package first and load it ourselves.
 */
export async function addFromWebStore(windowId: string, urlOrId: string, profile = extensionProfile(useBrowser.getState(), windowId)) {
  const id = webStoreExtensionId(urlOrId);
  if (id && (await supportsExtensionInstallPrompt())) {
    useBrowser.getState().newTab(windowId, { url: `https://chromewebstore.google.com/detail/${id}` });
    return;
  }
  cancelInstall();
  useExtensions.setState({ install: { windowId, profile, source: "webStore", status: "downloading" } });
  try {
    const pkg = await prepareWebStoreExtension(urlOrId, profile);
    if (useExtensions.getState().install?.windowId !== windowId) return void discardExtensionPackage(pkg);
    useExtensions.setState({ install: { windowId, profile, source: "webStore", status: "ready", pkg } });
  } catch (error) {
    useExtensions.setState({ install: { windowId, profile, source: "webStore", status: "error", error: message(error) } });
  }
}

/** Developer install: pick an unpacked extension folder. */
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

/** Chrome's install flow asks (see `ExtensionInstallPrompt`): our dialog answers. */
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
    // Chrome downloads and installs it (a store install: it auto-updates); the list catches up.
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
  if (request.pkg && request.source === "webStore" && request.status !== "installing") void discardExtensionPackage(request.pkg);
  useExtensions.setState({ install: null });
}

// MARK: Managing

/** Asks first (Dia's "Remove …?" dialog), then uninstalls. */
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

/** Opens the extension's options page in a tab. */
export function openOptions(windowId: string, ext: InstalledExtension) {
  if (ext.optionsUrl) useBrowser.getState().newTab(windowId, { url: ext.optionsUrl });
}

export const openManageExtensions = () => openSettings("extensions");
export const openPinDialog = (windowId: string) => useExtensions.setState({ pinDialog: { windowId } });
/** Extensions › Add Extension…: the Chrome Web Store, where the Add button installs here. */
export const openWebStore = (windowId: string) =>
  useBrowser.getState().newTab(windowId, { url: "https://chromewebstore.google.com/category/extensions" });

// MARK: Action popups

/**
 * Clicking an extension's toolbar button, as in Chrome: the engine runs the action on
 * the window's page (granting activeTab; action.onClicked for extensions without a
 * popup), then its popup or side panel shows. Without Chrome tabs the engine can't
 * run actions: the popup shows, or the extension's menu when it has none.
 */
export async function activateExtension(windowId: string, ext: InstalledExtension, anchor: Anchor, state?: ActionState | null) {
  const current = useExtensions.getState().popup;
  if (current?.windowId === windowId && current.extensionId === ext.id) return closeExtensionPopup();
  if (!ext.enabled) return void showExtensionMenu(windowId, ext);
  const s = useBrowser.getState();
  const tabId = activeTabId(s, windowId);
  const web = tabId ? webviews.get(tabId) : undefined;
  const result = web ? await web.executeExtensionAction(ext.id) : null;
  const url = state ? state.popup : ext.popup ? `chrome-extension://${ext.id}/${ext.popup.replace(/^\//, "")}` : "";
  if (result === "none") return;
  if (result === "sidePanel") return openSidePanel(windowId, ext);
  // The click can't reach the extension here; offer its menu instead.
  if (!url) return void (result === null && showExtensionMenu(windowId, ext));
  const profile = extensionProfile(useBrowser.getState(), windowId);
  useExtensions.setState({ popup: { windowId, profile, extensionId: ext.id, url, anchor } });
}

/** An extension's side panel (Chrome's side panel isn't drawn here yet): its page in a tab. */
function openSidePanel(windowId: string, ext: InstalledExtension) {
  if (ext.sidePanel) useBrowser.getState().newTab(windowId, { url: `chrome-extension://${ext.id}/${ext.sidePanel.replace(/^\//, "")}` });
}

export const closeExtensionPopup = () => useExtensions.setState({ popup: null });

/** Right-click on a toolbar button (Chrome's context menu). */
export async function showExtensionMenu(windowId: string, ext: InstalledExtension) {
  const profile = extensionProfile(useBrowser.getState(), windowId);
  const choice = await showMenu([
    { id: "name", title: ext.name, enabled: false },
    { separator: true },
    { id: "options", title: "Options", enabled: !!ext.optionsUrl && ext.enabled },
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
  if (choice === "manage") openManageExtensions();
}

function message(error: unknown): string {
  if (error instanceof ExtensionError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Extensions menu: the key window's extensions (see Menus.swift). */
export function extensionMenu(s: BrowserState, windowId: string | undefined) {
  const list = useExtensions.getState().lists[extensionProfile(s, windowId)] ?? EMPTY;
  return list.filter((x) => x.enabled).map((x) => ({ id: x.id, title: x.name, icon: x.actionIcon || x.icon, enabled: true }));
}

/** DEV: the extensions UI state and install flow, for lib/devHarness scripts (`globalThis.nnExtensionsUi`). */
if (__DEV__) (globalThis as { nnExtensionsUi?: unknown }).nnExtensionsUi = { useExtensions, confirmInstall, cancelInstall, activateExtension };
