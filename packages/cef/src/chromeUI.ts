import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

/**
 * Chrome UI surfaces the app draws instead of Chrome (packages/cef/ios/NNChromeSurfaces.h):
 * device choosers, the Cast dialog and cast state, extension side panels, and
 * switching a running tab capture to another tab. Tabs are named by their engine
 * browser id (`WebView` onReady).
 */

/** A site asked for a Bluetooth / USB / HID / serial device (Chrome's chooser). */
export type DeviceChooser = {
  id: number;
  browserId: number;
  /** False once answered or closed by the page: hide it. */
  open: boolean;
  /** "example.com wants to pair" (Chrome's wording, with the site). */
  title: string;
  okLabel: string;
  cancelLabel: string;
  noOptionsText: string;
  /** Shown while `refreshing` ("Scanning for devices…"). */
  scanningText: string;
  refreshing: boolean;
  canRefresh: boolean;
  /** Bluetooth is off. */
  adapterOff: boolean;
  /** macOS hasn't given the app Bluetooth access. */
  unauthorized: boolean;
  /** A scanning prompt (requestLEScan): OK / Cancel are Allow / Block, there's nothing to pick. */
  bothButtonsEnabled: boolean;
  showSignal: boolean;
  options: { name: string; connected: boolean; paired: boolean; /** 0–4, -1 none */ signal: number }[];
};

/** Chrome's Cast modes (media_router::MediaCastMode). */
export const CastMode = { presentation: 1, tab: 2, screen: 4, remotePlayback: 8 } as const;

export type CastSink = {
  id: string;
  name: string;
  /** Chrome's status line ("Casting YouTube", "Source not supported"…). */
  status: string;
  state: "available" | "connecting" | "connected" | "disconnecting" | "unavailable";
  /** media_router::SinkIconType: 0 Cast, 1 audio group, 2 speaker, 6 wired display, 7 generic. */
  icon: number;
  /** Bitmask of `CastMode`. */
  modes: number;
  /** The active route on this sink ("" if none). */
  routeId: string;
  /** An error title ("" if none). */
  issue: string;
};

/** Chrome's Cast dialog for a tab (the toolbar asked, or the page did). */
export type CastDialog = {
  id: number;
  browserId: number;
  open: boolean;
  header: string;
  /** macOS denied local network access. */
  permissionRejected: boolean;
  castingStarted: boolean;
  sinks: CastSink[];
};

/** A cast this browser started. `source` is a media source id ("urn:x-org.chromium.media:source:tab:12", "cast:…"). */
export type CastRoute = { id: string; sink: string; description: string; source: string };

export type SidePanelRequest = { browserId: number; extensionId: string; open: boolean };

type NativeChromeUI = {
  addListener(name: "onDeviceChooser", listener: (e: DeviceChooser) => void): EventSubscription;
  addListener(name: "onCastDialog", listener: (e: CastDialog) => void): EventSubscription;
  addListener(name: "onCastRoutes", listener: (e: { profile: string; routes: CastRoute[] }) => void): EventSubscription;
  addListener(name: "onSidePanel", listener: (e: SidePanelRequest) => void): EventSubscription;
  available(): Promise<boolean>;
  selectDevice(id: number, index: number): Promise<void>;
  cancelDeviceChooser(id: number): Promise<void>;
  refreshDeviceChooser(id: number): Promise<void>;
  openBluetoothSettings(id: number): Promise<void>;
  showCastDialog(browserId: number): Promise<boolean>;
  startCasting(id: number, sink: string, mode: number): Promise<void>;
  stopCasting(id: number, route: string): Promise<void>;
  closeCastDialog(id: number): Promise<void>;
  watchCastRoutes(profile: string): Promise<void>;
  terminateCastRoute(route: string): Promise<void>;
  actionStates(browserId: number, ids: string[]): Promise<Record<string, NativeActionState>>;
  sidePanelURL(browserId: number, extensionId: string): Promise<string | null>;
  changeCaptureSource(capturer: number, target: number): Promise<boolean>;
  captureTarget(capturer: number, candidates: number[]): Promise<number>;
  stopCapture(capturer: number): Promise<boolean>;
  /** Missing in app builds from before it existed. */
  showAutofillSuggestions?(browserId: number, passwords: boolean): Promise<boolean>;
};

type NativeActionState = {
  title: string;
  badgeText: string;
  badgeColor: string | null;
  badgeTextColor: string | null;
  popup: string;
  enabled: boolean;
  icon: string;
};

/** App builds from before the module existed: nothing is taken over from Chrome. */
function unavailable(): NativeChromeUI {
  const fallbacks: Record<string, unknown> = { available: false, showCastDialog: false, actionStates: {}, sidePanelURL: null, changeCaptureSource: false, captureTarget: 0, stopCapture: false };
  return new Proxy({} as NativeChromeUI, {
    get: (_, name: string) => (name === "addListener" ? () => ({ remove() {} }) : async () => fallbacks[name]),
  });
}

export const ChromeUI = requireOptionalNativeModule<NativeChromeUI>("NetnyahooChromeUI") ?? unavailable();

if (__DEV__) (globalThis as { nnChromeUI?: unknown }).nnChromeUI = ChromeUI;

// MARK: Device choosers

export const onDeviceChooser = (listener: (e: DeviceChooser) => void) => ChromeUI.addListener("onDeviceChooser", listener);
/** Grants the option at `index` (a scanning prompt: any index allows). */
export const selectDevice = (id: number, index: number) => ChromeUI.selectDevice(id, index);
export const cancelDeviceChooser = (id: number) => ChromeUI.cancelDeviceChooser(id);
export const refreshDeviceChooser = (id: number) => ChromeUI.refreshDeviceChooser(id);
export const openBluetoothSettings = (id: number) => ChromeUI.openBluetoothSettings(id);

// MARK: Cast

export const onCastDialog = (listener: (e: CastDialog) => void) => ChromeUI.addListener("onCastDialog", listener);
export const onCastRoutes = (listener: (e: { profile: string; routes: CastRoute[] }) => void) => ChromeUI.addListener("onCastRoutes", listener);
/** Opens Chrome's Cast dialog model for a tab (answered by `onCastDialog`); false if casting is unavailable. */
export const showCastDialog = (browserId: number) => ChromeUI.showCastDialog(browserId);
export const startCasting = (dialogId: number, sinkId: string, mode: number) => ChromeUI.startCasting(dialogId, sinkId, mode);
export const stopCasting = (dialogId: number, routeId: string) => ChromeUI.stopCasting(dialogId, routeId);
export const closeCastDialog = (dialogId: number) => ChromeUI.closeCastDialog(dialogId);
/** Reports the profile's casts through `onCastRoutes`, now and on every change. */
export const watchCastRoutes = (profile: string) => ChromeUI.watchCastRoutes(profile);
export const terminateCastRoute = (routeId: string) => ChromeUI.terminateCastRoute(routeId);
/** The mode Chrome's dialog uses when a sink is clicked: the site's own cast, else the tab. */
export function preferredCastMode(modes: number): number {
  for (const mode of [CastMode.presentation, CastMode.tab, CastMode.screen, CastMode.remotePlayback]) if (modes & mode) return mode;
  return 0;
}

// MARK: Extension side panels

export const onExtensionSidePanel = (listener: (e: SidePanelRequest) => void) => ChromeUI.addListener("onSidePanel", listener);
/** The extension's side panel page for the tab (its per-tab path, else its default), or null. */
export const extensionSidePanelUrl = (browserId: number, extensionId: string) => ChromeUI.sidePanelURL(browserId, extensionId);

// MARK: Tab capture

/** "Share this tab instead": the capture `capturer` runs switches to the tab `target`. */
export const changeCaptureSource = (capturer: number, target: number) => ChromeUI.changeCaptureSource(capturer, target);
/** "Stop Sharing": ends the screen / window / tab sharing `capturer` runs (false if it can't). */
export const stopCapture = (capturer: number) => ChromeUI.stopCapture(capturer);
/** Which of `candidates` the tab capture of `capturer` shows (0 if it isn't capturing a tab). */
export const captureTarget = (capturer: number, candidates: number[]) => ChromeUI.captureTarget(capturer, candidates);

// MARK: Autofill

/**
 * Opens Chrome's autofill dropdown at the form field focused in the tab, like Chrome's field
 * menu: "passwords" lists the saved passwords (on any text field), "field" the field's own
 * suggestions (addresses, cards). False if no form field has focus there.
 */
export const showAutofillSuggestions = async (browserId: number, kind: "passwords" | "field") =>
  (await ChromeUI.showAutofillSuggestions?.(browserId, kind === "passwords")) ?? false;
