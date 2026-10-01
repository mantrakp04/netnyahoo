import { requireNativeModule, type EventSubscription } from "expo-modules-core";

export type DeviceChooser = {
  id: number;
  browserId: number;
  open: boolean;
  title: string;
  okLabel: string;
  cancelLabel: string;
  noOptionsText: string;
  scanningText: string;
  refreshing: boolean;
  canRefresh: boolean;
  adapterOff: boolean;
  unauthorized: boolean;
  bothButtonsEnabled: boolean;
  showSignal: boolean;
  options: { name: string; connected: boolean; paired: boolean; signal: number }[];
};

export const CastMode = { presentation: 1, tab: 2, screen: 4, remotePlayback: 8 } as const;

export type CastSink = {
  id: string;
  name: string;
  status: string;
  state: "available" | "connecting" | "connected" | "disconnecting" | "unavailable";
  icon: number;
  modes: number;
  routeId: string;
  issue: string;
};

export type CastDialog = {
  id: number;
  browserId: number;
  open: boolean;
  header: string;
  permissionRejected: boolean;
  castingStarted: boolean;
  sinks: CastSink[];
};

export type CastRoute = { id: string; sink: string; description: string; source: string };

export type SidePanelRequest = { browserId: number; extensionId: string; open: boolean };

type NativeChromeUI = {
  addListener(name: "onDeviceChooser", listener: (e: DeviceChooser) => void): EventSubscription;
  addListener(name: "onCastDialog", listener: (e: CastDialog) => void): EventSubscription;
  addListener(name: "onCastRoutes", listener: (e: { profile: string; routes: CastRoute[] }) => void): EventSubscription;
  addListener(name: "onSidePanel", listener: (e: SidePanelRequest) => void): EventSubscription;
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
  stopCapture(capturer: number): Promise<boolean>;
  showAutofillSuggestions(browserId: number, passwords: boolean): Promise<boolean>;
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

export const ChromeUI = requireNativeModule<NativeChromeUI>("NetnyahooChromeUI");

if (__DEV__) (globalThis as { nnChromeUI?: unknown }).nnChromeUI = ChromeUI;

// MARK: Device choosers

export const onDeviceChooser = (listener: (e: DeviceChooser) => void) => ChromeUI.addListener("onDeviceChooser", listener);
export const selectDevice = (id: number, index: number) => ChromeUI.selectDevice(id, index);
export const cancelDeviceChooser = (id: number) => ChromeUI.cancelDeviceChooser(id);
export const refreshDeviceChooser = (id: number) => ChromeUI.refreshDeviceChooser(id);
export const openBluetoothSettings = (id: number) => ChromeUI.openBluetoothSettings(id);

// MARK: Cast

export const onCastDialog = (listener: (e: CastDialog) => void) => ChromeUI.addListener("onCastDialog", listener);
export const onCastRoutes = (listener: (e: { profile: string; routes: CastRoute[] }) => void) => ChromeUI.addListener("onCastRoutes", listener);
export const showCastDialog = (browserId: number) => ChromeUI.showCastDialog(browserId);
export const startCasting = (dialogId: number, sinkId: string, mode: number) => ChromeUI.startCasting(dialogId, sinkId, mode);
export const stopCasting = (dialogId: number, routeId: string) => ChromeUI.stopCasting(dialogId, routeId);
export const closeCastDialog = (dialogId: number) => ChromeUI.closeCastDialog(dialogId);
export const watchCastRoutes = (profile: string) => ChromeUI.watchCastRoutes(profile);
export const terminateCastRoute = (routeId: string) => ChromeUI.terminateCastRoute(routeId);
export function preferredCastMode(modes: number): number {
  for (const mode of [CastMode.presentation, CastMode.tab, CastMode.screen, CastMode.remotePlayback]) if (modes & mode) return mode;
  return 0;
}

// MARK: Extension side panels

export const onExtensionSidePanel = (listener: (e: SidePanelRequest) => void) => ChromeUI.addListener("onSidePanel", listener);
export const extensionSidePanelUrl = (browserId: number, extensionId: string) => ChromeUI.sidePanelURL(browserId, extensionId);

// MARK: Tab capture

export const changeCaptureSource = (capturer: number, target: number) => ChromeUI.changeCaptureSource(capturer, target);
export const stopCapture = (capturer: number) => ChromeUI.stopCapture(capturer);

// MARK: Autofill

export const showAutofillSuggestions = (browserId: number, kind: "passwords" | "field") =>
  ChromeUI.showAutofillSuggestions(browserId, kind === "passwords");
