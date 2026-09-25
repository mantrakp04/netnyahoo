import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

/**
 * Chrome Web Store (MV3) extensions, per profile: Chrome's own extension system.
 * Each window's tabs belong to a real Chrome Browser (packages/cef/ios/NNWindowHost.h),
 * so extensions' tabs/windows APIs see real tabs and windows. Their popups /
 * options / side panels are extension pages you render in a `WebView` with the
 * same `profile`. `profile` is the WebView profile string ("" = default);
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
  /** Unpacked folder (ours for store installs, the developer's otherwise). */
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

/** A downloaded/inspected extension waiting for the install confirmation. */
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
  /** #rrggbb */
  badgeColor: string;
  badgeTextColor: string | null;
  title: string;
  /** Full popup URL ("" = none: the extension handles clicks itself). */
  popup: string;
  enabled: boolean;
};

export type ExtensionsChange = {
  profile: string;
  id: string;
  event: "installed" | "uninstalled" | "enabled" | "disabled" | "configured" | "reloaded";
};

type TabsRequestBase = {
  profile: string;
  extensionId: string;
  /** App window id the request is about (the page's own window unless it named another), or null. */
  window: string | null;
};
/**
 * A page Chrome opened outside our windows ("open": a new Chrome window from an
 * extension): open it as a tab. The other actions came from the old tabs/windows
 * emulation and no longer occur — extensions act on Chrome's real tabs.
 */
export type TabsRequest =
  | (TabsRequestBase & {
      action: "open";
      url: string;
      active?: boolean;
      pinned?: boolean;
      index?: number;
      newWindow?: boolean;
      incognito?: boolean;
      openerTabId?: number;
      /** Answer with `resolveOpenedTab(requestId, browserId)` once the tab's browser exists. */
      requestId?: string;
    })
  | (TabsRequestBase & { action: "activate"; tabId: number })
  | (TabsRequestBase & { action: "close"; tabIds: number[] })
  | (TabsRequestBase & { action: "pin"; tabId: number; pinned: boolean })
  | (TabsRequestBase & { action: "popup" })
  | (TabsRequestBase & { action: "sidePanel"; tabId?: number })
  | (TabsRequestBase & { action: "focusWindow" });

/**
 * The app's windows and tabs. Only `probes` is still used (per-tab action state
 * maps browser ids to Chrome's tab ids through them); Chrome itself knows the
 * windows and tabs now.
 */
export type ExtensionTabModel = {
  windows: {
    id: number;
    /** App window id. */
    key: string;
    profile: string;
    incognito: boolean;
    focused: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
    /** Browser ids, in tab order. */
    tabs: { id: number; active: boolean; pinned: boolean }[];
  }[];
  /** Extension pages that aren't tabs (popups, side panels): browser id → window id. */
  views: Record<string, number>;
  /**
   * An enabled extension per profile. Extension APIs name tabs by Chrome's own ids, which
   * the engine looks up from that extension's context (they aren't browser ids).
   */
  probes: Record<string, string>;
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
  /** Missing in app builds from before they existed. */
  supportsInstallPrompt?(): Promise<boolean>;
  resolveInstallPrompt?(requestId: string, accepted: boolean): Promise<void>;
  list(profile: string): Promise<Result<{ extensions: InstalledExtension[] }>>;
  prepareWebStore(id: string, profile: string): Promise<Result<ExtensionPackage>>;
  inspectUnpacked(path: string): Promise<Result<ExtensionPackage>>;
  install(path: string, profile: string): Promise<Result<{ id: string }>>;
  discardPrepared(path: string): Promise<void>;
  setEnabled(id: string, profile: string, enabled: boolean): Promise<Result<{ ok: true }>>;
  uninstall(id: string, profile: string): Promise<Result<{ ok: true }>>;
  reload(id: string, profile: string): Promise<Result<{ ok: true }>>;
  configure(id: string, profile: string, options: Record<string, unknown>): Promise<Result<{ ok: true }>>;
  actionState(profile: string, ids: string[], tabId: number): Promise<{ states: Record<string, ActionState> }>;
  setTabModel(model: ExtensionTabModel): Promise<void>;
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
  const fallbacks: Record<string, unknown> = { list: { extensions: [] }, actionState: { states: {} }, chooseFolder: null, supportsInstallPrompt: false };
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

export async function listExtensions(profile: string): Promise<InstalledExtension[]> {
  return unwrap(await Native.list(profile)).extensions;
}

/** Downloads the store's package and verifies it; show the result in the install dialog. */
export async function prepareWebStoreExtension(urlOrId: string, profile: string): Promise<ExtensionPackage> {
  const id = webStoreExtensionId(urlOrId);
  if (!id) throw new ExtensionError("That isn't a Chrome Web Store extension");
  return unwrap(await Native.prepareWebStore(id, profile));
}

/** Reads a developer's unpacked extension folder (Load Unpacked). */
export async function inspectUnpackedExtension(path: string): Promise<ExtensionPackage> {
  return unwrap(await Native.inspectUnpacked(path));
}

/** Installs a prepared package (or loads a developer folder) into the profile. */
export async function installExtension(pkg: Pick<ExtensionPackage, "path">, profile: string): Promise<string> {
  return unwrap(await Native.install(pkg.path, profile)).id;
}

/** The user declined the install dialog: drop the download. */
export const discardExtensionPackage = (pkg: Pick<ExtensionPackage, "path">) => Native.discardPrepared(pkg.path);

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

export const setExtensionPinned = (id: string, profile: string, pinned: boolean) => configureExtension(id, profile, { pinned });

/** Badge / title / popup of each extension's toolbar action for a tab (its browser id; 0 = defaults). */
export async function extensionActionStates(profile: string, ids: string[], tabId: number) {
  if (!ids.length) return {};
  return (await Native.actionState(profile, ids, tabId)).states;
}

/** chrome-extension://<id>/<path> */
export const extensionUrl = (id: string, path: string) => `chrome-extension://${id}/${path.replace(/^\//, "")}`;

/** The page to show in the action popover, or null when the extension takes clicks itself. */
export function extensionPopupUrl(ext: InstalledExtension, state?: ActionState | null): string | null {
  if (state) return state.popup || null;
  return ext.popup ? extensionUrl(ext.id, ext.popup) : null;
}

export const setExtensionTabModel = (model: ExtensionTabModel) => Native.setTabModel({ windows: [], views: {}, probes: model.probes });
/** No request waits for an answer any more (Chrome creates extensions' tabs itself). */
export const resolveOpenedTab = async (_requestId: string, _browserId: number) => {};

export const onExtensionsChanged = (listener: (e: ExtensionsChange) => void) => Native.addListener("onChanged", listener);
export const onExtensionInstallPrompt = (listener: (e: ExtensionInstallPrompt) => void) => Native.addListener("onInstallPrompt", listener);
/** Whether Chrome's install flow asks the app (else the Web Store button goes through `prepareWebStoreExtension`). */
export const supportsExtensionInstallPrompt = async () => (await Native.supportsInstallPrompt?.()) ?? false;
export const resolveExtensionInstallPrompt = async (requestId: string, accepted: boolean) => {
  await Native.resolveInstallPrompt?.(requestId, accepted);
};
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
