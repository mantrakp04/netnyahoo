import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

export type UpdaterState =
  | { available: false }
  | {
      available: true;
      /**
       * Whether the build has an update feed (Info.plist `SUFeedURL`). Without one, Sparkle
       * never starts and checkForUpdates() says updates aren't set up.
       */
      configured: boolean;
      automaticChecks: boolean;
      automaticDownloads: boolean;
      canCheck: boolean;
      sessionInProgress: boolean;
      feedURL: string | null;
      /** ms since the epoch. */
      lastCheck: number | null;
      version: string;
    };

export type AppIcon = { id: string; name: string; /** PNG data URL. */ preview: string | null };

export type NotificationPermission = "granted" | "denied" | "notDetermined" | "provisional";

export type NotificationOptions = {
  /** Reusing an id replaces that notification. */
  id?: string;
  title: string;
  body?: string;
  subtitle?: string;
  silent?: boolean;
  /** Image shown with it: http(s), data: or file: URL. */
  icon?: string;
  /** Clicking it switches to this tab. */
  tabId?: string;
  windowId?: string;
  /** Groups a site's notifications together. */
  origin?: string;
  /** Report the user closing it too (`action: "close"`), e.g. for a page's onclose handler. */
  dismissible?: boolean;
  data?: Record<string, unknown>;
};

/** The user clicked a notification (the app comes forward) or closed a `dismissible` one. */
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
  /** Whether this build can update itself (Sparkle linked). */
  updates: boolean;
  /** Help › Send Feedback… destinations from Info.plist (NNFeedbackURL, NNFeedbackEmail); null = not set up. */
  feedbackURL?: string | null;
  feedbackEmail?: string | null;
  /** Help › Video Tour's page (Info.plist NNVideoTourURL); null = hidden. */
  videoTourURL?: string | null;
};

/** What AppleScript reads (see Netnyahoo.sdef). Windows in any order; tabs in sidebar order. */
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

/** A change AppleScript asks for; answer with `replyToScript(id, …)`. */
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
};

/** App builds from before this module existed get inert stand-ins (JS is served to every build). */
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
/** False in app builds that predate the NetnyahooApp native module. */
export const hasAppModule = App !== missing;

// Updates (Sparkle). The app menu has Check for Updates…; these are for Settings › General.
export const updaterState = () => App.updaterState();
/** Shows Sparkle's own progress / result UI. */
export const checkForUpdates = () => App.checkForUpdates();
export const setAutomaticUpdateChecks = (on: boolean) => App.setAutomaticUpdateChecks(on);
export const setAutomaticUpdateDownloads = (on: boolean) => App.setAutomaticUpdateDownloads(on);

/** Handoff: advertise a window's page (null stops). Only http(s) pages are advertised. */
export const setWindowActivity = (windowId: string, url: string | null, title: string | null) =>
  App.setWindowActivity(windowId, url, title);

/** The system share picker for a page, shown at the top of its window. */
export const sharePage = (url: string, title?: string | null, windowId?: string | null) =>
  App.share(url, title ?? null, windowId ?? null);

export const isInDock = () => App.isInDock();
/** Pins the app in the Dock (the Dock restarts to show it). */
export const addToDock = () => App.addToDock();

/** Alternate app icons for Settings › Appearance; `size` is the preview size in points. */
export const appIcons = (size = 64) => App.appIcons(size);
export const currentAppIcon = () => App.appIcon();
/** Applies to the Dock tile right away and on every launch. */
export const setAppIcon = (id: string) => App.setAppIcon(id);

export const notificationPermission = () => App.notificationPermission();
/** macOS asks the user once; resolves with whether notifications are allowed. */
export const requestNotificationPermission = () => App.requestNotificationPermission();
/** Resolves with the notification's id, or null if macOS didn't accept it. */
export const postNotification = (options: NotificationOptions) => App.postNotification(options);
export const removeNotifications = (ids: string[]) => App.removeNotifications(ids);
/** System Settings › Notifications for this app. */
export const openNotificationSettings = () => App.openNotificationSettings();
export const onNotificationResponse = (listener: (e: NotificationResponse) => void) => App.addListener("onNotificationResponse", listener);

export const setScriptState = (state: ScriptState) => App.setScriptState(state);
export const replyToScript = (id: string, result: Record<string, unknown> | null, error: string | null = null) =>
  App.replyToScript(id, result, error);
export const onScriptCommand = (listener: (e: ScriptCommand) => void) => App.addListener("onScriptCommand", listener);

export const systemInfo = () => App.systemInfo();
/** Opens a URL with its default app (e.g. a mailto: draft); false if nothing did (or an older build). */
export const openExternalURL = async (url: string) => (typeof App.openExternalURL === "function" ? await App.openExternalURL(url) : false);
/** When the onboarding intro's beats land, in seconds from its start (the music follows them). */
export type IntroMusicCues = {
  icon: number;
  letters: number;
  letterStep: number;
  letterCount: number;
  tagline: number;
  exit: number;
  end: number;
};
/**
 * The onboarding intro's music, synthesized natively (IntroMusic.swift). Starting it muted still
 * runs it silently, so unmuting joins in time. No-ops in builds without it.
 */
export const playIntroMusic = (cues: IntroMusicCues, muted: boolean) => void App.playIntroMusic?.(cues, muted);
export const setIntroMusicMuted = (muted: boolean) => void App.setIntroMusicMuted?.(muted);
/** Fades out over `fade` seconds, then releases the audio device. */
export const stopIntroMusic = (fade = 0.4) => void App.stopIntroMusic?.(fade);
/** DEV builds only: renders the music to an audio file (nothing plays); resolves with its duration. */
export const devRenderIntroMusic = async (cues: IntroMusicCues, path: string) => (await App.devRenderIntroMusic?.(cues, path)) ?? null;
/** DEV builds only (null otherwise). */
export const launchEnvironment = (name: string) => App.launchEnvironment(name);
/** DEV builds only: runs AppleScript inside the app (scripts aimed at its own bundle id need no Automation consent). */
export const devRunAppleScript = (source: string) => App.devRunAppleScript(source);
/** DEV builds only: renders a window's layers to a PNG (works while the screen is locked). */
/**
 * DEV: the window's layers as a 2x PNG (Metal views render blank). `transparent` leaves out the window
 * background, to composite over the shader views' own snapshots (shaders `debugSnapshot`).
 */
export const devSnapshotWindow = (windowId: string, path: string, transparent = false) =>
  // Two arguments unless asked: builds from before `transparent` reject a third.
  transparent ? App.devSnapshotWindow(windowId, path, true) : App.devSnapshotWindow(windowId, path);
/** DEV builds only: fires a menu-bar command through the native menu path. */
export const devMenuCommand = (command: string, arg: string | null = null) => App.devMenuCommand(command, arg);
