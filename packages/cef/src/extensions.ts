import { requireNativeModule, type EventSubscription } from "expo-modules-core";
import { ChromeUI } from "./chromeUI";

export type SiteAccess = "ON_ALL_SITES" | "ON_SPECIFIC_SITES" | "ON_CLICK";

export type InstalledExtension = {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  state: "ENABLED" | "DISABLED" | "TERMINATED" | "BLOCKLISTED";
  icon: string;
  permissions: string[];
  siteAccess: SiteAccess | null;
  sites: string[];
  optionsUrl: string | null;
  pinned: boolean;
  incognito: boolean;
  /** "incognito": "split": its pages can run in a private window's own profile. */
  incognitoSplit?: boolean;
  fileAccess: boolean;
  mayModify: boolean;
  errors: string[];
  location: string;
  path: string | null;
  fromWebStore: boolean;
  webStoreUrl: string | null;
  homepageUrl: string | null;
  hasAction?: boolean;
  popup?: string | null;
  actionTitle?: string | null;
  actionIcon?: string | null;
  sidePanel?: string | null;
};

export type ExtensionPackage = {
  id?: string;
  name: string;
  shortName?: string | null;
  version: string;
  description: string;
  manifestVersion: number;
  icon: string | null;
  permissions: string[];
  optionalPermissions: string[];
  hostPermissions: string[];
  hasAction: boolean;
  popup: string | null;
  optionsPage: string | null;
  sidePanel: string | null;
  path: string;
};

export type ActionState = {
  badgeText: string;
  badgeColor: string | null;
  badgeTextColor: string | null;
  title: string;
  popup: string;
  enabled: boolean;
  icon: string;
};

export type ExtensionsChange = {
  profile: string;
  id: string;
  event: "installed" | "uninstalled" | "enabled" | "disabled" | "configured" | "reloaded";
};

export type TabsRequest = {
  action: "open";
  profile: string;
  extensionId: string;
  window: string | null;
  url: string;
  active?: boolean;
};

export type ExtensionInstallPrompt = {
  requestId: string;
  profile: string;
  id: string;
  name: string;
  version: string;
  type: "install" | "re-enable" | "permissions" | "external" | "remote" | "repair" | "other";
  icon: string;
  permissions: string[];
  browserId: number;
};

type Result<T> = T | { error: string };

type NativeExtensions = {
  addListener(name: "onChanged", listener: (e: ExtensionsChange) => void): EventSubscription;
  addListener(name: "onTabs", listener: (e: TabsRequest) => void): EventSubscription;
  addListener(name: "onInstallPrompt", listener: (e: ExtensionInstallPrompt) => void): EventSubscription;
  resolveInstallPrompt(requestId: string, accepted: boolean): Promise<void>;
  list(profile: string): Promise<Result<{ extensions: InstalledExtension[] }>>;
  inspectUnpacked(path: string): Promise<Result<ExtensionPackage>>;
  install(path: string, profile: string): Promise<Result<{ id: string }>>;
  setEnabled(id: string, profile: string, enabled: boolean): Promise<Result<{ ok: true }>>;
  uninstall(id: string, profile: string): Promise<Result<{ ok: true }>>;
  reload(id: string, profile: string): Promise<Result<{ ok: true }>>;
  configure(id: string, profile: string, options: Record<string, unknown>): Promise<Result<{ ok: true }>>;
  searchEngineList(profile: string): Promise<Result<{ list: unknown }>>;
  chooseFolder(): Promise<string | null>;
};

const Native = requireNativeModule<NativeExtensions>("NetnyahooExtensions");

if (__DEV__) (globalThis as { nnExtensions?: unknown }).nnExtensions = Native;

export class ExtensionError extends Error {}

function unwrap<T>(result: Result<T>): T {
  if (result && typeof result === "object" && "error" in result) throw new ExtensionError(result.error);
  return result as T;
}

export const isExtensionId = (s: string) => /^[a-p]{32}$/.test(s);

export function webStoreExtensionId(urlOrId: string): string | null {
  const s = urlOrId.trim();
  if (isExtensionId(s)) return s;
  try {
    const url = new URL(s);
    const store =
      url.hostname === "chromewebstore.google.com" ||
      (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore/"));
    if (!store) return null;
    const id = url.pathname.split("/").find(isExtensionId);
    return id ?? null;
  } catch {
    return null;
  }
}

export async function searchEngineList(profile: string): Promise<unknown> {
  return unwrap(await Native.searchEngineList(profile)).list;
}

export async function listExtensions(profile: string): Promise<InstalledExtension[]> {
  return unwrap(await Native.list(profile)).extensions;
}

export async function inspectUnpackedExtension(path: string): Promise<ExtensionPackage> {
  return unwrap(await Native.inspectUnpacked(path));
}

export async function installExtension(pkg: Pick<ExtensionPackage, "path">, profile: string): Promise<string> {
  return unwrap(await Native.install(pkg.path, profile)).id;
}

export async function setExtensionEnabled(id: string, profile: string, enabled: boolean) {
  unwrap(await Native.setEnabled(id, profile, enabled));
}

export async function uninstallExtension(id: string, profile: string) {
  unwrap(await Native.uninstall(id, profile));
}

export async function reloadExtension(id: string, profile: string) {
  unwrap(await Native.reload(id, profile));
}

export async function configureExtension(
  id: string,
  profile: string,
  options: {
    pinned?: boolean;
    incognito?: boolean;
    fileAccess?: boolean;
    siteAccess?: "allSites" | "specificSites" | "onClick";
  },
) {
  unwrap(await Native.configure(id, profile, options));
}

export async function extensionActionStates(browserId: number, ids: string[]): Promise<Record<string, ActionState>> {
  if (!ids.length || !browserId) return {};
  return ChromeUI.actionStates(browserId, ids);
}

export const onExtensionsChanged = (listener: (e: ExtensionsChange) => void) => Native.addListener("onChanged", listener);
export const onExtensionInstallPrompt = (listener: (e: ExtensionInstallPrompt) => void) => Native.addListener("onInstallPrompt", listener);
export const resolveExtensionInstallPrompt = (requestId: string, accepted: boolean) => Native.resolveInstallPrompt(requestId, accepted);
export const onExtensionTabsRequest = (listener: (e: TabsRequest) => void) => Native.addListener("onTabs", listener);

export const chooseExtensionFolder = () => Native.chooseFolder();

export function permissionWarnings(pkg: Pick<ExtensionPackage, "permissions" | "hostPermissions">): string[] {
  const warnings: string[] = [];
  const perms = new Set(pkg.permissions);
  const hosts = pkg.hostPermissions.filter((h) => !/^(chrome|chrome-extension|about|data):/.test(h));
  const allHosts = hosts.some((h) => h === "<all_urls>" || /^(\*|https?|wss?):\/\/\*\//.test(h)) || perms.has("debugger");
  if (allHosts || perms.has("proxy") || perms.has("pageCapture") || perms.has("debugger")) {
    warnings.push("Read and change all your data on all websites");
  } else if (hosts.length) {
    const names = [...new Set(hosts.map(hostLabel).filter(Boolean))] as string[];
    if (names.length === 1) warnings.push(`Read and change your data on ${names[0]}`);
    else if (names.length === 2) warnings.push(`Read and change your data on ${names[0]} and ${names[1]}`);
    else if (names.length === 3) warnings.push(`Read and change your data on ${names[0]}, ${names[1]}, and ${names[2]}`);
    else if (names.length > 3) warnings.push(`Read and change your data on a number of websites`);
  }
  const clipboard = perms.has("clipboardRead") && perms.has("clipboardWrite");
  if (clipboard) warnings.push("Read and modify data you copy and paste");
  for (const [permission, message] of PERMISSION_WARNINGS) {
    if (clipboard && permission.startsWith("clipboard")) continue;
    if (perms.has(permission)) warnings.push(message);
  }
  if (perms.has("declarativeNetRequest") && !allHosts && !perms.has("declarativeNetRequestWithHostAccess"))
    warnings.push("Block content on any page");
  const browsing = perms.has("history") ? "Read and change your browsing history on all your signed-in devices" : null;
  if (!browsing && (perms.has("tabs") || perms.has("webNavigation")) && !allHosts) warnings.push("Read your browsing history");
  if (browsing) warnings.push(browsing);
  return [...new Set(warnings)];
}

function hostLabel(pattern: string): string | null {
  const m = /^[^:]+:\/\/(\*\.)?([^/]+)/.exec(pattern);
  if (!m) return null;
  return m[1] ? `all ${m[2]} sites` : m[2]!;
}

const PERMISSION_WARNINGS: [string, string][] = [
  ["bookmarks", "Read and change your bookmarks"],
  ["clipboardRead", "Read data you copy and paste"],
  ["clipboardWrite", "Modify data you copy and paste"],
  ["contentSettings", "Change your settings that control websites' access to features such as cookies, JavaScript, plugins, geolocation, microphone, camera etc."],
  ["desktopCapture", "Capture content of your screen"],
  ["downloads", "Manage your downloads"],
  ["downloads.open", "Open downloaded files"],
  ["geolocation", "Detect your physical location"],
  ["management", "Manage your apps, extensions, and themes"],
  ["nativeMessaging", "Communicate with cooperating native applications"],
  ["notifications", "Display notifications"],
  ["privacy", "Change your privacy-related settings"],
  ["readingList", "Read and change entries in the reading list"],
  ["sessions", "Read your browsing history on all your signed-in devices"],
  ["system.storage", "Identify and eject storage devices"],
  ["tabCapture", "Capture content of your screen"],
  ["tabGroups", "View and manage your tab groups"],
  ["topSites", "Read a list of your most frequently visited websites"],
  ["ttsEngine", "Read all text spoken using synthesized speech"],
  ["webAuthenticationProxy", "Read and change all your data on all websites"],
];
