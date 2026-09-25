import { Cef } from "./native";

export type DownloadState = "downloading" | "finished" | "failed" | "cancelled";

export type Download = {
  id: string;
  url: string;
  filename: string;
  path: string;
  state: DownloadState;
  paused: boolean;
  received: number;
  /** -1 when the server didn't send a length. */
  total: number;
  /** Bytes per second. */
  speed: number;
  mimeType: string;
  /**
   * Engine profile of the tab that started it ("" = default, "incognito:<window>").
   * Missing on downloads saved before profiles were recorded.
   */
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
  cefVersion: string;
  chromiumVersion: string;
  /** Browsers alive right now (tabs, parked popups, little windows). */
  liveBrowsers: number;
  /** Open little popup windows. */
  popupWindows: number;
  /** Hidden Chrome windows behind app windows (one per window and profile shown in it). */
  ghostWindows?: number;
  /** Tabs are Chrome's own tabs of those windows' Browsers (patched engine), not Alloy browsers. */
  chromeTabs?: boolean;
  /** The engine can share a single tab (WebView `mediaCaptureSourceId`); our own CEF build only. */
  tabCapture?: boolean;
};

export type EngineComponent = {
  id: string;
  name: string;
  version: string;
  state:
    | "new" | "checking" | "canUpdate" | "downloading" | "decompressing" | "patching" | "updating" | "updated"
    | "upToDate" | "updateError" | "run" | "unknown";
};

/** One row of Chromium's task manager (a process, or a tab/worker inside one). */
export type EngineTask = {
  id: number;
  type:
    | "browser" | "gpu" | "zygote" | "utility" | "renderer" | "extension" | "guest" | "plugin" | "sandboxHelper"
    | "dedicatedWorker" | "sharedWorker" | "serviceWorker" | "unknown";
  /** Chromium's label, e.g. "Tab: Example Domain", "GPU Process", "Utility: Network Service". */
  title: string;
  /** Whether `killTask` can end it (not the browser process itself). */
  killable: boolean;
  /** Percent of one core since the last refresh; -1 before the first sample. */
  cpu: number;
  processors: number;
  /** Private memory footprint in bytes (-1 if unknown). */
  memory: number;
  gpuMemory: number;
  /** Browsers (tabs) hosted by this task: match `onReady`'s browserId. Several tabs can share a renderer. */
  browserIds: number[];
};

/** Chromium component id of the Widevine CDM. */
export const WIDEVINE_COMPONENT_ID = "oimompecagnajdejgnnjijobebaeigek";

/** Engine versions and live-object counts (for About pages and leak checks). */
export const engineInfo = () => Cef.engineInfo();

/** DEV: a ghost window's alignment with its app window and focus state. */
export type GhostWindow = {
  profile: string;
  parentWindow: number;
  window: number;
  frame: string;
  parentFrame: string;
  aligned: boolean;
  alpha: number;
  key: boolean;
  canBecomeKey: boolean;
  visible: boolean;
  ignoresMouse: boolean;
  childOfParent: boolean;
  belowParent: boolean;
  anchorBrowserId: number;
  /** A tab of the ghost's Browser (0 when it has none). */
  anyTabBrowserId?: number;
  ready?: boolean;
  active: boolean;
  /** Where Chrome's tab dialogs go: the shown page's insets in the window (top, left, bottom, right). */
  pageInsets?: [number, number, number, number];
};
/** DEV: every ghost window's state (see packages/cef/ios/NNWindowHost.h). */
export const ghostWindows = () => Cef.ghostWindows();
/**
 * DEV: acts on an app window by number (`GhostWindow.parentWindow`): "frame:x,y,w,h", "miniaturize",
 * "deminiaturize", "active:1|0" (key state as Chrome sees it), "key:<modifier flags>:<character>".
 */
export const devWindowAction = (windowNumber: number, action: string) => Cef.devWindow(windowNumber, action);
/**
 * The tab with this `transferKey` is moving to another window: for a few seconds its
 * views hand the page over instead of closing it. Call right when the app decides the
 * move, before the views re-render.
 */
export const prepareTabTransfer = (transferKey: string) => Cef.prepareTransfer?.(transferKey);
/** Chromium's component-updater components (Widevine CDM, CRLSet…). */
export const listComponents = () => Cef.components();
/** Installs/updates a component now; `error` is null on success. */
export const updateComponent = (id: string) => Cef.updateComponent(id);

/**
 * Starts recording a performance trace of every engine process (chrome://tracing
 * format). Resolves false if a trace is already running.
 */
export const beginTracing = () => Cef.beginTracing();
/** Stops the trace. `keep`: writes it to Downloads and resolves with the file's path; otherwise discards it (null). */
export const endTracing = (keep: boolean) => Cef.endTracing(keep);
export const isTracing = () => Cef.isTracing();
/**
 * Chromium's task manager rows (poll every second or two for live CPU/memory).
 * Process ids and per-task network usage aren't exposed by this CEF version.
 */
export const listTasks = () => Cef.listTasks();
/** Ends a task's process (a hung tab's renderer; its tabs then report `onCrashed`). */
export const killTask = (id: number) => Cef.killTask(id);

/** What tab lifecycle policy decides by: power source, Low Power Mode, memory pressure, RAM. */
export type SystemState = {
  /** Running on the Mac's battery (not a power adapter). */
  onBattery: boolean;
  /** Internal battery charge, 0–1; null without one. */
  batteryLevel: number | null;
  lowPowerMode: boolean;
  /** macOS memory pressure (dispatch memory-pressure source). */
  memoryPressure: "normal" | "warning" | "critical";
  /** Installed RAM in bytes. */
  physicalMemory: number;
};
export const systemState = () => Cef.systemState();
/** Fires whenever any SystemState field changes (plugged in, Low Power Mode, memory pressure). */
export const onSystemState = (listener: (state: SystemState) => void) => Cef.addListener("onSystemState", listener);

/**
 * Routes pages' getDisplayMedia() through the app's source picker: tabs get
 * `onDisplayMediaRequest` and answer with `resolveDisplayMedia`. Off by
 * default: without it Chromium (Alloy) shares the whole main screen with no
 * choice. A tab can be shared too when `engineInfo().tabCapture`: answer with
 * that tab's WebView `mediaCaptureSourceId()`.
 */
export const setDisplayMediaPicker = (enabled: boolean) => Cef.setDisplayMediaPicker(enabled);
/** The default search engine's name, for the page context menu's "Search <name> for “…”". */
export const setSearchEngineName = (name: string) => Cef.setSearchEngineName?.(name) ?? Promise.resolve();
/** Screens and windows that can be shared right now (window titles need Screen Recording permission). */
export const getDisplayMediaSources = () => Cef.displayMediaSources();

export const onDownload = (listener: (d: Download) => void) => Cef.addListener("onDownload", listener);
export const cancelDownload = (id: string) => Cef.cancelDownload(id);
export const pauseDownload = (id: string) => Cef.pauseDownload(id);
export const resumeDownload = (id: string) => Cef.resumeDownload(id);
export const openDownload = (id: string) => Cef.openDownload(id);
export const revealDownload = (id: string) => Cef.revealDownload(id);

export const onPermission = (listener: (p: PermissionRequest) => void) => Cef.addListener("onPermission", listener);
export const onPermissionDismissed = (listener: (p: { id: string }) => void) =>
  Cef.addListener("onPermissionDismissed", listener);
/**
 * Answers a permission prompt. With `remember` ("Always allow" / "Never allow")
 * the decision is stored for the origin and the site isn't asked again;
 * otherwise it lasts until the tab leaves the origin (Chrome's "Allow this time").
 * Camera/microphone and other decisions show up in `getSiteSettings`.
 */
export const resolvePermission = (id: string, result: PermissionResult, remember = false) =>
  Cef.resolvePermission(id, result, remember);

/** Deletes cookies + cache now and site storage before the profile next loads. */
export const clearProfileData = (profile: string) => Cef.clearProfileData(profile);
/** Deletes the cookies created since `since` (ms since 1970); resolves with how many. */
export const deleteCookiesSince = (profile: string, since: number) => Cef.deleteCookiesSince(profile, since);
/** Empties the profile's HTTP cache (the engine can't clear a time range of it). */
export const clearHttpCache = (profile: string) => Cef.clearHttpCache(profile);
/** Drops an incognito profile's in-memory context (call when its window closes). */
export const releaseProfile = (profile: string) => Cef.releaseProfile(profile);
/** Removes a deleted profile's data directory. */
export const deleteProfileData = (profile: string) => Cef.deleteProfileData(profile);
