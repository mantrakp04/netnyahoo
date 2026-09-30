import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

export type UpdaterState =
  | { available: false }
  | {
      available: true;
      configured: boolean;
      automaticChecks: boolean;
      automaticDownloads: boolean;
      canCheck: boolean;
      sessionInProgress: boolean;
      feedURL: string | null;
      lastCheck: number | null;
      version: string;
    };

export type AppIcon = { id: string; name: string; preview: string | null };

export type NotificationPermission = "granted" | "denied" | "notDetermined" | "provisional";

export type NotificationOptions = {
  id?: string;
  title: string;
  body?: string;
  subtitle?: string;
  silent?: boolean;
  icon?: string;
  tabId?: string;
  windowId?: string;
  origin?: string;
  dismissible?: boolean;
  data?: Record<string, unknown>;
};

export type NotificationResponse = {
  id: string;
  action: "click" | "close";
  tabId: string | null;
  windowId: string | null;
  data: unknown;
};

export type SystemInfo = {
  appName: string;
  appVersion: string;
  appBuild: string;
  bundleId: string;
  configuration: "Debug" | "Release";
  osVersion: string;
  osBuild: string;
  arch: string;
  model: string;
  memoryGB: number;
  locale: string;
  updates: boolean;
  feedbackURL?: string | null;
  feedbackEmail?: string | null;
  videoTourURL?: string | null;
  releaseNotesURL?: string | null;
  isolatedInstance?: boolean;
  forceReleaseNotes?: boolean;
  processStart?: number | null;
};

export type CrashReport = {
  incidentId?: string;
  time: number;
  appVersion?: string;
  build?: string;
  exceptionType?: string;
  signal?: string;
  frames: NativeFrame[];
  /** An uncaught NSException's name (validated natively) and where it was thrown. */
  exceptionName?: string;
  exceptionFrames?: NativeFrame[];
};

type NativeFrame = { image: string; symbol?: string; offset?: number };

export type ScriptState = {
  windows: {
    id: string;
    title: string;
    profileId: string;
    incognito: boolean;
    activeTabId: string | null;
    tabs: { id: string; title: string; url: string; loading: boolean; pinned: boolean }[];
  }[];
  profiles: { id: string; name: string }[];
};

export type ScriptCommand = { id: string } & (
  | { command: "newWindow"; url?: string; incognito: boolean; profileId?: string }
  | { command: "newTab"; windowId?: string; url?: string; index?: number }
  | { command: "setURL"; tabId: string; url: string }
  | { command: "closeTab" | "reload" | "back" | "forward" | "focusTab"; tabId: string }
  | { command: "closeWindow"; windowId: string }
  | { command: "setActiveTabIndex"; windowId: string; index: number }
  | { command: "execute"; tabId: string; code: string }
  | { command: "focusProfile"; profileId: string }
);

type AppModule = {
  addListener(name: "onNotificationResponse", listener: (e: NotificationResponse) => void): EventSubscription;
  addListener(name: "onScriptCommand", listener: (e: ScriptCommand) => void): EventSubscription;
  updaterState(): Promise<UpdaterState>;
  checkForUpdates(): Promise<void>;
  setAutomaticUpdateChecks(on: boolean): Promise<void>;
  setAutomaticUpdateDownloads(on: boolean): Promise<void>;
  setWindowActivity(windowId: string, url: string | null, title: string | null): Promise<void>;
  share(url: string, title: string | null, windowId: string | null): Promise<void>;
  isInDock(): Promise<boolean>;
  addToDock(): Promise<boolean>;
  appIcons(size: number): Promise<AppIcon[]>;
  appIcon(): Promise<string>;
  setAppIcon(id: string): Promise<void>;
  notificationPermission(): Promise<NotificationPermission>;
  requestNotificationPermission(): Promise<boolean>;
  postNotification(options: NotificationOptions): Promise<string | null>;
  removeNotifications(ids: string[]): Promise<void>;
  openNotificationSettings(): Promise<void>;
  setScriptState(state: ScriptState): Promise<void>;
  replyToScript(id: string, result: Record<string, unknown> | null, error: string | null): Promise<void>;
  systemInfo(): SystemInfo;
  openExternalURL?(url: string): Promise<boolean>;
  launchEnvironment(name: string): string | null;
  playIntroMusic?(cues: IntroMusicCues, muted: boolean): Promise<void>;
  setIntroMusicMuted?(muted: boolean): Promise<void>;
  stopIntroMusic?(fade: number): Promise<void>;
  devRenderIntroMusic?(cues: IntroMusicCues, path: string): Promise<number | null>;
  devRunAppleScript(source: string): Promise<{ ok: boolean; result?: unknown; error?: string; number?: number }>;
  devSnapshotWindow(windowId: string, path: string, transparent?: boolean): Promise<boolean>;
  devMenuCommand(command: string, arg: string | null): Promise<void>;
  devTypeKeys?(windowId: string, text: string, interval: number): Promise<KeyTiming[]>;
  devKeyEquivalent?(windowId: string, press: KeyPress): Promise<KeyPressResult>;
  crashReports?(since: number): Promise<CrashReport[]>;
  devCrash?(kind?: "exception"): Promise<void>;
};

const missing: AppModule = {
  addListener: () => ({ remove() {} }),
  updaterState: async () => ({ available: false }),
  checkForUpdates: async () => {},
  setAutomaticUpdateChecks: async () => {},
  setAutomaticUpdateDownloads: async () => {},
  setWindowActivity: async () => {},
  share: async () => {},
  isInDock: async () => true,
  addToDock: async () => false,
  appIcons: async () => [],
  appIcon: async () => "default",
  setAppIcon: async () => {},
  notificationPermission: async () => "denied",
  requestNotificationPermission: async () => false,
  postNotification: async () => null,
  removeNotifications: async () => {},
  openNotificationSettings: async () => {},
  setScriptState: async () => {},
  replyToScript: async () => {},
  systemInfo: () => ({
    appName: "Netnyahoo", appVersion: "", appBuild: "", bundleId: "", configuration: "Debug", osVersion: "", osBuild: "",
    arch: "", model: "", memoryGB: 0, locale: "", updates: false,
  }),
  launchEnvironment: () => null,
  devRunAppleScript: async () => ({ ok: false, error: "not available in this build" }),
  devSnapshotWindow: async () => false,
  devMenuCommand: async () => {},
};

const App = requireOptionalNativeModule<AppModule>("NetnyahooApp") ?? missing;
export const hasAppModule = App !== missing;

export const updaterState = () => App.updaterState();
export const checkForUpdates = () => App.checkForUpdates();
export const setAutomaticUpdateChecks = (on: boolean) => App.setAutomaticUpdateChecks(on);
export const setAutomaticUpdateDownloads = (on: boolean) => App.setAutomaticUpdateDownloads(on);

export const setWindowActivity = (windowId: string, url: string | null, title: string | null) =>
  App.setWindowActivity(windowId, url, title);

export const sharePage = (url: string, title?: string | null, windowId?: string | null) =>
  App.share(url, title ?? null, windowId ?? null);

export const isInDock = () => App.isInDock();
export const addToDock = () => App.addToDock();

export const appIcons = (size = 64) => App.appIcons(size);
export const currentAppIcon = () => App.appIcon();
export const setAppIcon = (id: string) => App.setAppIcon(id);

export const notificationPermission = () => App.notificationPermission();

export const crashReports = (since: number): Promise<CrashReport[]> => App.crashReports?.(since) ?? Promise.resolve([]);
export const devCrash = (kind?: "exception") => App.devCrash?.(kind) ?? Promise.resolve();
export const requestNotificationPermission = () => App.requestNotificationPermission();
export const postNotification = (options: NotificationOptions) => App.postNotification(options);
export const removeNotifications = (ids: string[]) => App.removeNotifications(ids);
export const openNotificationSettings = () => App.openNotificationSettings();
export const onNotificationResponse = (listener: (e: NotificationResponse) => void) => App.addListener("onNotificationResponse", listener);

export const setScriptState = (state: ScriptState) => App.setScriptState(state);
export const replyToScript = (id: string, result: Record<string, unknown> | null, error: string | null = null) =>
  App.replyToScript(id, result, error);
export const onScriptCommand = (listener: (e: ScriptCommand) => void) => App.addListener("onScriptCommand", listener);

export const systemInfo = () => App.systemInfo();
export const openExternalURL = async (url: string) => (typeof App.openExternalURL === "function" ? await App.openExternalURL(url) : false);
export type IntroMusicCues = {
  icon: number;
  letters: number;
  letterStep: number;
  letterCount: number;
  tagline: number;
  exit: number;
  end: number;
};
export const playIntroMusic = (cues: IntroMusicCues, muted: boolean) => void App.playIntroMusic?.(cues, muted);
export const setIntroMusicMuted = (muted: boolean) => void App.setIntroMusicMuted?.(muted);
export const stopIntroMusic = (fade = 0.4) => void App.stopIntroMusic?.(fade);
export const devRenderIntroMusic = async (cues: IntroMusicCues, path: string) => (await App.devRenderIntroMusic?.(cues, path)) ?? null;
export const launchEnvironment = (name: string) => App.launchEnvironment(name);
export const devRunAppleScript = (source: string) => App.devRunAppleScript(source);
export const devSnapshotWindow = (windowId: string, path: string, transparent = false) =>
  transparent ? App.devSnapshotWindow(windowId, path, true) : App.devSnapshotWindow(windowId, path);
export type KeyTiming = { due: number; handled: number; drawn: number };
export const devTypeKeys = async (windowId: string, text: string, interval: number) => (await App.devTypeKeys?.(windowId, text, interval)) ?? [];
export type KeyPress = {
  key: string;
  keyCode: number;
  modifiers?: ("command" | "shift" | "option" | "control" | "function")[];
  characters?: string;
  focus?: "window" | "page" | "devtools";
  asKey?: boolean;
  settle?: number;
  wait?: number;
  dry?: boolean;
};
export type KeyPressResult = {
  handledBy?: "page" | "window" | "menu" | "none";
  firstResponder?: string;
  fired?: { title: string; action: string; command?: string; arg?: string; dry?: boolean }[];
  matched?: { title: string; action: string; command?: string; arg?: string; enabled: boolean }[];
  error?: string;
};
export const devKeyEquivalent = async (windowId: string, press: KeyPress): Promise<KeyPressResult> =>
  (await App.devKeyEquivalent?.(windowId, press)) ?? { error: "not available in this build" };
export const devMenuCommand = (command: string, arg: string | null = null) => App.devMenuCommand(command, arg);
