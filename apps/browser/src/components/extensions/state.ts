import {
  chooseExtensionFolder,
  configureExtension,
  ExtensionError,
  extensionActionStates,
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
} from "@netnyahoo/nncore";
import { confirm, showMenu } from "@netnyahoo/shell";
import { openWindow } from "../../lib/actions";
import { webviews } from "../../lib/webviews";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTabId, engineProfile } from "../../store/model";
import { openSettings } from "../settings/windows";
import { closeSidePanelsOf, toggleSidePanel } from "./sidePanels";
import { browserIdOf, extensionProfile, pageProfile, shownIn, useExtensions, windowExtensions, type Anchor } from "./store";

export * from "./sidePanels";
export * from "./store";

const EMPTY: InstalledExtension[] = [];

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

export const closeExtensionPopup = () => useExtensions.setState({ popup: null });

let popupRequests = 0;

/**
 * chrome.action.openPopup(): the popup the extension has for the tab `browserId` shows, as for a click on its button
 * but without running its action (no activeTab grant, no onClicked). Over its own popup it opens afresh, as Chrome's
 * reopens: 1Password asks once its Mac app unlocks, and the page shown while it waited is stale.
 */
export async function openActionPopup(windowId: string, ext: InstalledExtension, anchor: Anchor, browserId: number) {
  if (!ext.enabled || !shownIn(windowId, ext.id)) return;
  // The tab it asked over must still be the one shown once Chrome answers, and a later request wins.
  const request = ++popupRequests;
  const tabId = activeTabId(useBrowser.getState(), windowId);
  const state = browserId ? (await extensionActionStates(browserId, [ext.id]))[ext.id] : undefined;
  if (request !== popupRequests || activeTabId(useBrowser.getState(), windowId) !== tabId) return;
  const url = state ? state.popup : ext.popup ? `chrome-extension://${ext.id}/${ext.popup.replace(/^\//, "")}` : "";
  if (!url) return;
  useExtensions.setState({ popup: { windowId, pageProfile: pageProfile(useBrowser.getState(), windowId), extensionId: ext.id, url, anchor, opened: request } });
}

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
