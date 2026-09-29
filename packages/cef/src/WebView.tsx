import { requireNativeViewManager } from "expo-modules-core";
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";
import type { FaviconImage } from "./favicons";

export type NavigationState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  themeColor: string | null;
  themeColorSource: "meta" | "header" | "background" | null;
};

export type MediaState = { playing: boolean; muted: boolean };

export type NowPlaying = {
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  playbackState: "playing" | "paused" | "none";
  position: number;
  duration: number | null;
  playbackRate: number;
  timestamp: number;
  hasVideo: boolean;
  actions: string[];
};
export type MediaCommand = "play" | "pause" | "toggle" | "next" | "previous" | "seekBy" | "seekTo" | "stop";
export type MediaAccess = { camera: boolean; microphone: boolean; screen: boolean };

export type OpenDisposition = "foreground" | "background" | "window" | "popup" | "incognito" | "current" | "split";

export type OpenWindowRequest = {
  url: string;
  disposition: OpenDisposition;
  adoptId?: string;
  userGesture?: boolean;
};

export type BlockedPopup = { id: string; url: string; origin: string };

export type FindResult = { count: number; active: number; final: boolean };
export type PageCommand = { command: "search" | "ask" | "copyLinkToHighlight"; text: string };
export type LoadError = { url: string; code: number; text: string };
export type NavigationEntry = { url: string; title: string; current: boolean };
export type CrashInfo = { status: number; reason: "abnormal" | "killed" | "crashed" | "oom" | "launchFailed" | "integrity" | "unknown"; code: number };

export type CertificatePrincipal = { commonName: string; displayName: string; organizations: string[]; country: string };
export type Certificate = {
  subject: CertificatePrincipal;
  issuer: CertificatePrincipal;
  validFrom: number;
  validUntil: number;
  serialNumber?: string;
  sha256?: string;
  chainLength: number;
};
export type SecurityInfo = {
  level: "secure" | "mixed" | "insecure" | "certificateError" | "local" | "none";
  url: string;
  origin: string | null;
  protocol?: string;
  certificate?: Certificate;
  certificateErrors?: string[];
  mixedContent?: "ran" | "displayed" | null;
  isEV?: boolean;
};

export type DownloadNavigation = { url: string; committedUrl: string; skipped: boolean };

export type WebNotification = {
  id: string;
  title: string;
  body: string;
  icon: string | null;
  tag: string;
  silent: boolean;
  requireInteraction: boolean;
  origin: string;
  browserId: number;
  isMainFrame: boolean;
};

export type PictureInPictureState = { kind: "video" | "document"; active: boolean };
export type ActivateRequest = { reason: "pictureInPicture" };
export type DisplayMediaSource = {
  id: string;
  kind: "screen" | "window";
  name: string;
  app?: string;
  pid?: number;
  width: number;
  height: number;
};
export type DisplayMediaRequest = { id: string; origin: string; audio: boolean; sources: DisplayMediaSource[] };

export type ZoomState = { zoom: number; host: string; isDefault: boolean; pinchScale: number };
export type ContentBlockedState = { count: number; url: string };

export type PasswordPrompt = {
  state: "save" | "update" | "saved";
  origin: string;
  username: string;
  passwordLength: number;
  federation: string;
  usernames: string[];
};
export type TabStripPlace = { index: number; active: boolean; pinned: boolean };
export type PasswordPromptAnswer = "save" | "update" | "never" | "nope" | "dismiss";
export type ExtensionActionResult = "none" | "popup" | "sidePanel";

export type WebViewProps = ViewProps & {
  url?: string;
  profile?: string;
  adoptId?: string;
  transferKey?: string;
  standalone?: boolean;
  visible?: boolean;
  warm?: boolean;
  pageBackgroundColor?: string;
  autoPictureInPicture?: boolean;
  onNavigationChange?: (state: NavigationState) => void;
  onProgress?: (progress: number) => void;
  onFavicon?: (url: string, candidates: string[]) => void;
  onMedia?: (state: MediaState) => void;
  onNowPlaying?: (state: NowPlaying | null) => void;
  onMediaAccess?: (access: MediaAccess) => void;
  onOpenWindow?: (request: OpenWindowRequest) => void;
  onPopupBlocked?: (popup: BlockedPopup) => void;
  onFindResult?: (result: FindResult) => void;
  onFullscreen?: (fullscreen: boolean) => void;
  onStatus?: (text: string) => void;
  onCrashed?: (info: CrashInfo) => void;
  onUnresponsive?: () => void;
  onResponsive?: () => void;
  onLoadError?: (error: LoadError) => void;
  onSecurity?: (info: SecurityInfo) => void;
  onZoom?: (zoom: ZoomState) => void;
  onContentBlocked?: (state: ContentBlockedState) => void;
  onDownloadNavigation?: (navigation: DownloadNavigation) => void;
  onNotification?: (notification: WebNotification) => void;
  onNotificationClose?: (id: string) => void;
  onPictureInPicture?: (state: PictureInPictureState) => void;
  onActivateRequest?: (request: ActivateRequest) => void;
  onDisplayMediaRequest?: (request: DisplayMediaRequest) => void;
  onWindowClose?: () => void;
  onCommand?: (command: PageCommand) => void;
  onPageFocus?: () => void;
  onPageMessage?: (kind: string, data: unknown) => void;
  onReady?: (browserId: number, chromeTabId: number) => void;
  onDiscarded?: (url: string) => void;
  onPasswordPrompt?: (prompt: PasswordPrompt) => void;
  onTabStrip?: (place: TabStripPlace) => void;
};

export type WebViewHandle = {
  loadUrl(url: string, options?: { userInitiated?: boolean }): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  goToOffset(offset: number): Promise<void>;
  reload(): Promise<void>;
  forceReload(): Promise<void>;
  stopLoading(): Promise<void>;
  focus(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  zoomStep(direction: 1 | -1 | 0): Promise<void>;
  find(text: string, forward: boolean, findNext: boolean): Promise<void>;
  stopFinding(clearSelection: boolean): Promise<void>;
  print(): Promise<void>;
  runPageCommand?(name: "savePage" | "systemPrint" | "caretBrowsing"): Promise<void>;
  showDevTools(panel?: string): Promise<void>;
  executeJavaScript(code: string): Promise<void>;
  evaluate<T = unknown>(code: string): Promise<T | null>;
  navigationEntries(): Promise<NavigationEntry[]>;
  downloadFavicon(url: string, name?: string): Promise<FaviconImage | null>;
  downloadImage(url: string, maxPixels: number): Promise<FaviconImage | null>;

  mediaCommand(action: MediaCommand, seconds?: number): Promise<void>;
  requestPictureInPicture(): Promise<boolean>;
  exitPictureInPicture(): Promise<void>;

  getSecurityInfo(): Promise<SecurityInfo>;
  openBlockedPopup(id: string, always?: boolean): Promise<void>;
  clearSiteData(): Promise<{ cookies: number | false; storage: boolean }>;

  resolvePasswordPrompt(answer: PasswordPromptAnswer, edits?: { username?: string; password?: string }): Promise<void>;
  setTabStrip(index: number, pinned: boolean): Promise<void>;
  executeExtensionAction(extensionId: string): Promise<ExtensionActionResult | null>;

  resolveDisplayMedia(id: string, sourceId: string | null): Promise<void>;
  mediaCaptureSourceId(): Promise<string | null>;
  notificationAction(id: string, action: "click" | "close"): Promise<void>;

  resolveUnresponsive(terminate: boolean): Promise<void>;
  discard(options?: { unload?: boolean }): Promise<boolean>;
  setFrozen(frozen: boolean): Promise<void>;
};

type Evt<T> = (e: NativeSyntheticEvent<T>) => void;
type NativeEvents = {
  onNavigationChange: NavigationState;
  onProgress: { progress: number };
  onFavicon: { url: string; urls: string[] };
  onMedia: MediaState;
  onNowPlaying: { state: NowPlaying | null };
  onMediaAccess: MediaAccess;
  onOpenWindow: OpenWindowRequest;
  onPopupBlocked: BlockedPopup;
  onFindResult: FindResult;
  onFullscreen: { fullscreen: boolean };
  onStatus: { text: string };
  onCrashed: CrashInfo;
  onUnresponsive: object;
  onResponsive: object;
  onLoadError: LoadError;
  onSecurity: SecurityInfo;
  onZoom: ZoomState;
  onContentBlocked: ContentBlockedState;
  onDownloadNavigation: DownloadNavigation;
  onNotification: WebNotification;
  onNotificationClose: { id: string };
  onPictureInPicture: PictureInPictureState;
  onActivateRequest: ActivateRequest;
  onDisplayMediaRequest: DisplayMediaRequest;
  onWindowClose: object;
  onCommand: PageCommand;
  onPageFocus: object;
  onPageMessage: { kind: string; data: unknown };
  onReady: { browserId: number; tabId?: number };
  onDiscarded: { url: string };
  onPasswordPrompt: PasswordPrompt;
  onTabStrip: TabStripPlace;
};
type Handlers = keyof NativeEvents;
type NativeProps = Omit<WebViewProps, Handlers> & { [K in Handlers]?: Evt<NativeEvents[K]> };

const toEngine = (url: string) => url.replace(/^(view-source:)?netnyahoo:(?:\/\/)?(?=[^/?#])/i, "$1chrome://");
const fromEngine = (url: string) => url.replace(/^(view-source:)?chrome:\/\/(?=[^/?#])/i, "$1netnyahoo://");

const unwrap: { [K in Handlers]: (e: NativeEvents[K]) => Parameters<NonNullable<WebViewProps[K]>> } = {
  onNavigationChange: (e) => [{ ...e, url: fromEngine(e.url) }],
  onProgress: (e) => [e.progress],
  onFavicon: (e) => [e.url, e.urls],
  onMedia: (e) => [e],
  onNowPlaying: (e) => [e.state],
  onMediaAccess: (e) => [e],
  onOpenWindow: (e) => [{ ...e, url: fromEngine(e.url) }],
  onPopupBlocked: (e) => [{ ...e, url: fromEngine(e.url) }],
  onFindResult: (e) => [e],
  onFullscreen: (e) => [e.fullscreen],
  onStatus: (e) => [e.text],
  onCrashed: (e) => [e],
  onUnresponsive: () => [],
  onResponsive: () => [],
  onLoadError: (e) => [{ ...e, url: fromEngine(e.url) }],
  onSecurity: (e) => [e],
  onZoom: (e) => [e],
  onContentBlocked: (e) => [e],
  onDownloadNavigation: (e) => [{ ...e, url: fromEngine(e.url), committedUrl: fromEngine(e.committedUrl) }],
  onNotification: (e) => [e],
  onNotificationClose: (e) => [e.id],
  onPictureInPicture: (e) => [e],
  onActivateRequest: (e) => [e],
  onDisplayMediaRequest: (e) => [e],
  onWindowClose: () => [],
  onCommand: (e) => [e],
  onPageFocus: () => [],
  onPageMessage: (e) => [e.kind, e.data],
  onReady: (e) => [e.browserId, e.tabId ?? 0],
  onDiscarded: (e) => [fromEngine(e.url)],
  onPasswordPrompt: (e) => [e],
  onTabStrip: (e) => [e],
};

type NativeHandle = Omit<
  WebViewHandle,
  "evaluate" | "loadUrl" | "downloadFavicon" | "resolvePasswordPrompt" | "discard"
> & {
  evaluate(code: string): Promise<string | null>;
  downloadFavicon(url: string, name: string | null): Promise<FaviconImage | null>;
  loadUrl(url: string, userInitiated?: boolean): Promise<void>;
  resolvePasswordPrompt(answer: string, username: string | null, password: string | null): Promise<void>;
  discard(unload: boolean): Promise<boolean>;
};

const NativeWebView = requireNativeViewManager<NativeProps>("NetnyahooCEF");

export const WebView = forwardRef<WebViewHandle, WebViewProps>(function WebView(props, ref) {
  const native = useRef<NativeHandle>(null);
  useImperativeHandle(ref, () => {
    const n = () => native.current!;
    return {
      loadUrl: (url, options) => n().loadUrl(toEngine(url), options?.userInitiated ?? false),
      goBack: () => n().goBack(),
      goForward: () => n().goForward(),
      goToOffset: (offset) => n().goToOffset(offset),
      reload: () => n().reload(),
      forceReload: () => n().forceReload(),
      stopLoading: () => n().stopLoading(),
      focus: () => n().focus(),
      setMuted: (muted) => n().setMuted(muted),
      zoomStep: (direction) => n().zoomStep(direction),
      find: (text, forward, findNext) => n().find(text, forward, findNext),
      stopFinding: (clear) => n().stopFinding(clear),
      print: () => n().print(),
      runPageCommand: async (name) => void (typeof n().runPageCommand === "function" && (await n().runPageCommand!(name))),
      showDevTools: (panel) => n().showDevTools(panel),
      executeJavaScript: (code) => n().executeJavaScript(code),
      evaluate: async <T,>(code: string) => {
        const json = await n().evaluate(code);
        if (json == null) return null;
        try {
          return JSON.parse(json) as T;
        } catch {
          return null;
        }
      },
      navigationEntries: async () => (await n().navigationEntries()).map((e) => ({ ...e, url: fromEngine(e.url) })),
      downloadImage: (url, maxPixels) => n().downloadImage(url, maxPixels),
      downloadFavicon: (url, name) => n().downloadFavicon(url, name ?? null),
      mediaCommand: (action, seconds) => n().mediaCommand(action, seconds),
      requestPictureInPicture: () => n().requestPictureInPicture(),
      exitPictureInPicture: () => n().exitPictureInPicture(),
      getSecurityInfo: () => n().getSecurityInfo(),
      openBlockedPopup: (id, always) => n().openBlockedPopup(id, always),
      clearSiteData: () => n().clearSiteData(),
      resolvePasswordPrompt: (answer, edits) => n().resolvePasswordPrompt(answer, edits?.username ?? null, edits?.password ?? null),
      executeExtensionAction: (extensionId) => n().executeExtensionAction(extensionId),
      setTabStrip: (index, pinned) => n().setTabStrip(index, pinned),
      resolveDisplayMedia: (id, sourceId) => n().resolveDisplayMedia(id, sourceId),
      mediaCaptureSourceId: () => n().mediaCaptureSourceId(),
      notificationAction: (id, action) => n().notificationAction(id, action),
      resolveUnresponsive: (terminate) => n().resolveUnresponsive(terminate),
      discard: (options) => n().discard(options?.unload ?? false),
      setFrozen: (frozen) => n().setFrozen(frozen),
    };
  });

  const nativeProps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "url") {
      nativeProps.url = typeof value === "string" ? toEngine(value) : value;
      continue;
    }
    const map = unwrap[key as Handlers] as ((e: unknown) => unknown[]) | undefined;
    nativeProps[key] =
      map && typeof value === "function"
        ? (e: NativeSyntheticEvent<unknown>) => (value as (...args: unknown[]) => void)(...map(e.nativeEvent))
        : value;
  }

  return (
    <NativeWebView
      // @ts-expect-error expo view managers accept a ref to their AsyncFunctions
      ref={native}
      {...(nativeProps as NativeProps)}
    />
  );
});
