import { Cef } from "./native";

export type DownloadState = "downloading" | "finished" | "failed" | "cancelled";

export type Download = {
  /** Unique across profiles for the app's lifetime (Chromium numbers downloads per profile). */
  id: string;
  url: string;
  filename: string;
  path: string;
  state: DownloadState;
  paused: boolean;
  received: number;
  total: number;
  speed: number;
  mimeType: string;
  profile?: string;
};

export type PermissionKind =
  | "camera" | "microphone" | "screen" | "location" | "notifications" | "clipboard" | "midi"
  | "multipleDownloads" | "localFonts" | "idleDetection" | "storageAccess" | "windowManagement" | "fileSystem"
  | "keyboardLock" | "pointerLock" | "protectedMedia" | "protocolHandler" | "sensors" | "localNetwork"
  | "vr" | "ar" | "handTracking" | "identityProvider" | "webAppInstallation" | "capturedSurfaceControl"
  | "diskQuota" | "cameraPanTiltZoom";

export type PermissionRequest = { id: string; browserId: number; origin: string; permissions: PermissionKind[] };
export type PermissionResult = "accept" | "deny" | "dismiss";

export type EngineInfo = {
  pid: number;
  dataDirectory: string;
  engine: string;
  chromiumVersion: string;
  liveBrowsers: number;
  popupWindows: number;
  chromeWindows: number;
};

export type EngineComponent = {
  id: string;
  name: string;
  version: string;
  state:
    | "new" | "checking" | "canUpdate" | "downloading" | "decompressing" | "patching" | "updating" | "updated"
    | "upToDate" | "updateError" | "run" | "unknown";
};

export type EngineTask = {
  id: number;
  type:
    | "browser" | "gpu" | "zygote" | "utility" | "renderer" | "extension" | "guest" | "plugin" | "sandboxHelper"
    | "dedicatedWorker" | "sharedWorker" | "serviceWorker" | "unknown";
  title: string;
  killable: boolean;
  cpu: number;
  processors: number;
  memory: number;
  gpuMemory: number;
  browserIds: number[];
};

export const WIDEVINE_COMPONENT_ID = "oimompecagnajdejgnnjijobebaeigek";

export const engineInfo = () => Cef.engineInfo();

export type ChromeWindowState = {
  profile: string;
  window: number;
  frame: string;
  alpha: number;
  key: boolean;
  canBecomeKey: boolean;
  visible: boolean;
  parentWindow: number;
  chromeWindows: number;
  anchorBrowserId: number;
  anyTabBrowserId: number;
  ready: boolean;
  active: boolean;
  pageInsets: [number, number, number, number];
  hosting: boolean;
  group: string;
  hasRoot: boolean;
  translucent: boolean;
};
export const chromeWindows = () => Cef.chromeWindows();
export const devWindowAction = (windowNumber: number, action: string) => Cef.devWindow(windowNumber, action);
export const prepareTabTransfer = (transferKey: string) => Cef.prepareTransfer(transferKey);
export const listComponents = () => Cef.components();

export const beginTracing = () => Cef.beginTracing();
export const endTracing = (keep: boolean) => Cef.endTracing(keep);
export const isTracing = () => Cef.isTracing();
export const listTasks = () => Cef.listTasks();
export const killTask = (id: number) => Cef.killTask(id);

export type SystemState = {
  onBattery: boolean;
  batteryLevel: number | null;
  lowPowerMode: boolean;
  memoryPressure: "normal" | "warning" | "critical";
  physicalMemory: number;
};
export const systemState = () => Cef.systemState();
export const onSystemState = (listener: (state: SystemState) => void) => Cef.addListener("onSystemState", listener);

export const setDisplayMediaPicker = (enabled: boolean) => Cef.setDisplayMediaPicker(enabled);
export const setSearchEngineName = (name: string) => Cef.setSearchEngineName(name);
export const getDisplayMediaSources = () => Cef.displayMediaSources();

export const onDownload = (listener: (d: Download) => void) => Cef.addListener("onDownload", listener);
export const cancelDownload = (id: string) => Cef.cancelDownload(id);
export const pauseDownload = (id: string) => Cef.pauseDownload(id);
export const resumeDownload = (id: string) => Cef.resumeDownload(id);

export const onPermission = (listener: (p: PermissionRequest) => void) => Cef.addListener("onPermission", listener);
export const onPermissionDismissed = (listener: (p: { id: string }) => void) =>
  Cef.addListener("onPermissionDismissed", listener);
export const resolvePermission = (id: string, result: PermissionResult, remember = false) =>
  Cef.resolvePermission(id, result, remember);

export type BrowsingDataType = "history" | "siteData" | "cache" | "downloads";
export const clearBrowsingData = (profile: string, types: BrowsingDataType[], since?: number) =>
  Cef.clearBrowsingData(profile, types, since ?? null);
export const releaseProfile = (profile: string) => Cef.releaseProfile(profile);
// Resolves with the kinds of data that couldn't be deleted (none when it all went).
export const deleteProfileData = async (profile: string): Promise<string[]> => (await Cef.deleteProfileData(profile))?.remaining ?? ["data"];
