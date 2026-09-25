import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";
import { ChromeUI } from "./chromeUI";

/**
 * Chrome Web Store (MV3) extensions, per profile: Chrome's own extension system.
 * Each window's tabs belong to a real Chrome Browser (packages/cef/ios/NNWindowHost.h),
 * so extensions' tabs/windows APIs see real tabs and windows, and the store's own
 * button installs through Chrome (its dialog asks the app: `onExtensionInstallPrompt`).
 * Their popups / options / side panels are extension pages you render in a `WebView`
 * with the same `profile`. `profile` is the WebView profile string ("" = default);
 * incognito profiles use the default profile's extensions.
 */

/** "allSites" | "specificSites" | "onClick" (Chrome's site access). */
export type SiteAccess = "ON_ALL_SITES" | "ON_SPECIFIC_SITES" | "ON_CLICK";

export type InstalledExtension = {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  state: "ENABLED" | "DISABLED" | "TERMINATED" | "BLOCKLISTED";
  /** Data URL. */
  icon: string;
  /** Chrome's permission warnings ("Read and change all your data on all websites"). */
  permissions: string[];
  siteAccess: SiteAccess | null;
  sites: string[];
  optionsUrl: string | null;
  /** Pinned to the toolbar (Chrome's own per-profile pin state). */
  pinned: boolean;
  incognito: boolean;
  fileAccess: boolean;
  mayModify: boolean;
  errors: string[];
  location: string;
  /** Where Chrome keeps it (the developer's folder for unpacked ones). */
  path: string | null;
  fromWebStore: boolean;
  webStoreUrl: string | null;
  homepageUrl: string | null;
  // From the manifest:
  hasAction?: boolean;
  /** Default popup page, relative to the extension root. */
  popup?: string | null;
  actionTitle?: string | null;
  /** Toolbar icon (data URL). */
  actionIcon?: string | null;
  sidePanel?: string | null;
};

/** An unpacked extension folder (Load Unpacked) waiting for the install confirmation. */
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
  /** Host permissions and content-script matches. */
  hostPermissions: string[];
  hasAction: boolean;
  popup: string | null;
  optionsPage: string | null;
  sidePanel: string | null;
  /** Folder to pass to `installExtension`. */
  path: string;
};

export type ActionState = {
  badgeText: string;
  /** #rrggbb, or null for Chrome's default. */
  badgeColor: string | null;
  badgeTextColor: string | null;
  title: string;
  /** Full popup URL ("" = none: the extension handles clicks itself). */
  popup: string;
  enabled: boolean;
  /** action.setIcon's image for this tab (PNG data URL at 2x), "" for the manifest icon. */
  icon: string;
};

export type ExtensionsChange = {
  profile: string;
  id: string;
  event: "installed" | "uninstalled" | "enabled" | "disabled" | "configured" | "reloaded";
};

/**
 * A page Chrome opened outside our windows (a new Chrome window from an extension,
 * an uninstall survey): open it as a tab.
 */
export type TabsRequest = {
  action: "open";
  profile: string;
  extensionId: string;
  /** App window id, or null. */
  window: string | null;
  url: string;
  active?: boolean;
};

/**
 * Chrome's own install flow (the Web Store's "Add" button, re-enabling an extension whose
 * permissions grew, extensions installed from outside) asks the app instead of showing
 * its dialog. Answer with `resolveExtensionInstallPrompt`.
 */
export type ExtensionInstallPrompt = {
  requestId: string;
  profile: string;
  id: string;
  name: string;
  version: string;
  type: "install" | "re-enable" | "permissions" | "external" | "remote" | "repair" | "other";
  /** PNG data: URL, or "". */
  icon: string;
  /** The warnings Chrome would list, in order. */
  permissions: string[];
  /** The tab that asked (the store page), 0 if none. */
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
  /** Missing in app builds from before it existed. */
  searchEngineList?(profile: string): Promise<Result<{ list: unknown }>>;
  /** DEV: runs in the profile's hidden chrome://extensions/ (evaluateInPage: any hidden page). */
  evaluateInHost(expression: string, profile: string): Promise<unknown>;
  evaluateInPage(expression: string, profile: string, page: string): Promise<unknown>;
  chooseFolder(): Promise<string | null>;
};

/**
 * App builds from before the module existed still run this JS (Metro serves the
 * working tree): they get an engine without extensions instead of a crash.
 */
function unavailable(): NativeExtensions {
  const error = { error: "Extensions aren't available in this build" };
  const fallbacks: Record<string, unknown> = { list: { extensions: [] }, chooseFolder: null };
  return new Proxy({} as NativeExtensions, {
    get: (_, name: string) =>
      name === "addListener" ? () => ({ remove() {} }) : async () => (name in fallbacks ? fallbacks[name] : name.startsWith("set") || name.startsWith("resolve") ? undefined : error),
  });
}

const Native = requireOptionalNativeModule<NativeExtensions>("NetnyahooExtensions") ?? unavailable();

if (__DEV__) (globalThis as { nnExtensions?: unknown }).nnExtensions = Native;

export class ExtensionError extends Error {}

function unwrap<T>(result: Result<T>): T {
  if (result && typeof result === "object" && "error" in result) throw new ExtensionError(result.error);
  return result as T;
}

/** 32 letters a–p. */
export const isExtensionId = (s: string) => /^[a-p]{32}$/.test(s);

/**
 * The extension id in a Chrome Web Store link
 * (chromewebstore.google.com/detail/<slug>/<id>, the old chrome.google.com/webstore/detail/…),
 * or a bare id.
 */
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

/**
 * Chrome's search engine list for the profile, as its settings page gets it
 * (`getSearchEnginesList`: `{defaults, actives, others, extensions}`). Engines that
 * extensions add (`chrome_settings_overrides.search_provider`) carry `extension: {id, name}`;
 * core's `extensionEnginesFromChrome` picks them out. Null if the engine can't tell.
 */
export async function searchEngineList(profile: string): Promise<unknown> {
  if (!Native.searchEngineList) return null;
  return unwrap(await Native.searchEngineList(profile)).list;
}

export async function listExtensions(profile: string): Promise<InstalledExtension[]> {
  return unwrap(await Native.list(profile)).extensions;
}

/** Reads a developer's unpacked extension folder (Load Unpacked). */
export async function inspectUnpackedExtension(path: string): Promise<ExtensionPackage> {
  return unwrap(await Native.inspectUnpacked(path));
}

/** Loads a developer's unpacked folder into the profile. */
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

/** Badge / title / popup / icon of each extension's toolbar action for a tab (its browser id), from Chrome. */
export async function extensionActionStates(browserId: number, ids: string[]): Promise<Record<string, ActionState>> {
  if (!ids.length || !browserId) return {};
  return ChromeUI.actionStates(browserId, ids);
}

/** chrome-extension://<id>/<path> */
export const extensionUrl = (id: string, path: string) => `chrome-extension://${id}/${path.replace(/^\//, "")}`;

export const onExtensionsChanged = (listener: (e: ExtensionsChange) => void) => Native.addListener("onChanged", listener);
export const onExtensionInstallPrompt = (listener: (e: ExtensionInstallPrompt) => void) => Native.addListener("onInstallPrompt", listener);
export const resolveExtensionInstallPrompt = (requestId: string, accepted: boolean) => Native.resolveInstallPrompt(requestId, accepted);
export const onExtensionTabsRequest = (listener: (e: TabsRequest) => void) => Native.addListener("onTabs", listener);

/** Folder picker for Load Unpacked. */
export const chooseExtensionFolder = () => Native.chooseFolder();

/**
 * Chrome's install-prompt warnings for a manifest (before it's installed; installed
 * extensions carry Chrome's own list in `permissions`). Empty = "no special permissions".
 */
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
  // "tabs", "webNavigation" and "history" read the same data: Chrome shows one line.
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
