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
  /**
   * Tab bar tint as #RRGGBB: the page's `<meta name="theme-color">`, else the
   * colour at the top of the page (a fixed/sticky header, also while
   * scrolling, or the page background). Null before the page has painted.
   */
  themeColor: string | null;
  /** Where `themeColor` came from. */
  themeColorSource: "meta" | "header" | "background" | null;
};

export type MediaState = { playing: boolean; muted: boolean };

/** Media Session metadata + playback state of the tab's main media. */
export type NowPlaying = {
  title: string;
  artist: string;
  album: string;
  /** Largest Media Session artwork (absolute URL). */
  artwork: string | null;
  playbackState: "playing" | "paused" | "none";
  /** Seconds at `timestamp` (ms since epoch); advance by `playbackRate` while playing. */
  position: number;
  duration: number | null;
  playbackRate: number;
  timestamp: number;
  hasVideo: boolean;
  /** Media Session actions the page handles ("nexttrack", "previoustrack", "seekto"…). */
  actions: string[];
};
export type MediaCommand = "play" | "pause" | "toggle" | "next" | "previous" | "seekBy" | "seekTo" | "stop";
/** Capture in use (for the recording indicator). */
export type MediaAccess = { camera: boolean; microphone: boolean; screen: boolean };

/**
 * foreground/background: new tab · window: new browser window ·
 * popup: sized window.open (keeps window.opener) · incognito: private window ·
 * split: ⇧⌥-click, open in a split pane next to this tab.
 */
export type OpenDisposition = "foreground" | "background" | "window" | "popup" | "incognito" | "current" | "split";

export type OpenWindowRequest = {
  url: string;
  disposition: OpenDisposition;
  /** Present when Chromium already created the browser: pass it as `adoptId` to the new view. */
  adoptId?: string;
  userGesture?: boolean;
};

/** window.open() without a click; `openBlockedPopup(id)` opens it (with opener) after all. */
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
  /** ms since epoch */
  validFrom: number;
  validUntil: number;
  serialNumber?: string;
  sha256?: string;
  chainLength: number;
};
/** Connection security of the visible page (site-controls popover / lock icon). */
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

/**
 * A main-frame navigation turned into a file download. Like Chrome, the tab
 * keeps its page: `committedUrl` is what it shows ("" if it never had one, e.g.
 * a new tab opened for the file — Chrome closes such a tab). `skipped`: the URL
 * was a download before and this load had no user gesture (tab restore,
 * discarded/remounted view), so it was cancelled instead of downloading again.
 * Don't persist `url` as the tab's URL.
 */
export type DownloadNavigation = { url: string; committedUrl: string; skipped: boolean };

/**
 * A page (or one of its frames) showed a notification with `new Notification()`
 * or `registration.showNotification()` from the page. Chromium's permission
 * (site setting "notifications") has already been checked. Show it (e.g. shell's
 * `postNotification`) and report clicks/dismissals with `notificationAction`.
 * A notification with the same `tag` replaces the previous one.
 */
export type WebNotification = {
  id: string;
  title: string;
  body: string;
  icon: string | null;
  tag: string;
  silent: boolean;
  requireInteraction: boolean;
  /** Origin of the frame that showed it. */
  origin: string;
  browserId: number;
  isMainFrame: boolean;
};

/** A Picture-in-Picture window opened or closed for this tab. */
export type PictureInPictureState = { kind: "video" | "document"; active: boolean };
/**
 * Something outside the tab asked for it to be shown: the "back to tab" button
 * of a PiP window. Activate the tab and focus its window.
 */
export type ActivateRequest = { reason: "pictureInPicture" };
/** A screen or window a page can share (ids are Chromium desktop-capture ids). */
export type DisplayMediaSource = {
  id: string;
  kind: "screen" | "window";
  /** Display name, or the window's title (its app's name without Screen Recording permission). */
  name: string;
  app?: string;
  pid?: number;
  width: number;
  height: number;
};
/** The page called getDisplayMedia(): show a picker and answer with `resolveDisplayMedia(id, sourceId | null)`. */
export type DisplayMediaRequest = { id: string; origin: string; audio: boolean; sources: DisplayMediaSource[] };

/** Page zoom of this tab's host (1 = 100%) and pinch-zoom scale of the visual viewport. */
export type ZoomState = { zoom: number; host: string; isDefault: boolean; pinchScale: number };
/** Requests the content blocker (uBlock Origin Lite) blocked on the current page. */
export type ContentBlockedState = { count: number; url: string };

/**
 * Chrome is ready to save a login the page just submitted (the app draws the prompt:
 * Chrome's own bubble would hang off its hidden toolbar). Answer with
 * `resolvePasswordPrompt`.
 */
export type PasswordPrompt = {
  /**
   * "save": a new login · "update": a new password for a saved one ·
   * "saved": Chrome saved or updated it (a confirmation; nothing to answer).
   */
  state: "save" | "update" | "saved";
  origin: string;
  username: string;
  /** For a masked preview; the password itself stays in the engine. */
  passwordLength: number;
  /** Identity provider of a federated login ("" for a password). */
  federation: string;
  /** Logins already saved for the site: an update can go to another one of them. */
  usernames: string[];
};
/** Where Chrome's tab strip has the tab after a change (extensions activating, pinning or moving tabs). */
export type TabStripPlace = { index: number; active: boolean; pinned: boolean };
export type PasswordPromptAnswer = "save" | "update" | "never" | "nope" | "dismiss";
/** What a toolbar click did: the extension handled it, or the app shows its popup / side panel. */
export type ExtensionActionResult = "none" | "popup" | "sidePanel";

export type WebViewProps = ViewProps & {
  /** Initial URL only; later navigations go through `loadUrl`. */
  url?: string;
  /** "" = default profile, a profile id, or "incognito:<window id>". Fixed at creation. */
  profile?: string;
  /**
   * Adopts a browser the engine made (an `OpenWindowRequest.adoptId`). Or "clone:<transferKey>":
   * a copy of that open tab, with its back/forward list and session storage (Duplicate); or
   * "restore:<transferKey>": that closed tab with its back/forward list (Reopen Closed Tab,
   * this session). Without one to take, the view loads `url`.
   */
  adoptId?: string;
  /**
   * The app's id for the tab. After `prepareTabTransfer(key)` the tab's view in another
   * window takes over this view's page (history, state, the Chrome tab) instead of reloading.
   */
  transferKey?: string;
  /**
   * Not a tab (extension popups, side panels): a browser of its own, outside the window's
   * Chrome tab strip, so extensions' tabs APIs don't list it. Fixed at creation.
   */
  standalone?: boolean;
  visible?: boolean;
  pageBackgroundColor?: string;
  /**
   * Picture-in-picture while the tab is hidden (Dia's auto-PiP): a page that
   * handles the Media Session "enterpictureinpicture" action (Meet) gets its
   * Document PiP window, otherwise a playing video goes PiP. Undone when shown.
   */
  autoPictureInPicture?: boolean;
  onNavigationChange?: (state: NavigationState) => void;
  onProgress?: (progress: number) => void;
  onFavicon?: (url: string, candidates: string[]) => void;
  onMedia?: (state: MediaState) => void;
  /** null when nothing is playing any more. */
  onNowPlaying?: (state: NowPlaying | null) => void;
  onMediaAccess?: (access: MediaAccess) => void;
  onOpenWindow?: (request: OpenWindowRequest) => void;
  onPopupBlocked?: (popup: BlockedPopup) => void;
  onFindResult?: (result: FindResult) => void;
  onFullscreen?: (fullscreen: boolean) => void;
  onStatus?: (text: string) => void;
  onCrashed?: (info: CrashInfo) => void;
  /** The renderer stopped responding (~15 s); answer with `resolveUnresponsive`. */
  onUnresponsive?: () => void;
  onResponsive?: () => void;
  onLoadError?: (error: LoadError) => void;
  /** After each navigation/load. */
  onSecurity?: (info: SecurityInfo) => void;
  onZoom?: (zoom: ZoomState) => void;
  /** Reset to 0 on each new page; coalesced (a few per second). */
  onContentBlocked?: (state: ContentBlockedState) => void;
  onDownloadNavigation?: (navigation: DownloadNavigation) => void;
  onNotification?: (notification: WebNotification) => void;
  /** The page called notification.close(): remove it from Notification Center. */
  onNotificationClose?: (id: string) => void;
  onPictureInPicture?: (state: PictureInPictureState) => void;
  onActivateRequest?: (request: ActivateRequest) => void;
  /** Only with `setDisplayMediaPicker(true)`. */
  onDisplayMediaRequest?: (request: DisplayMediaRequest) => void;
  /** The page called window.close(). */
  onWindowClose?: () => void;
  onCommand?: (command: PageCommand) => void;
  onPageFocus?: () => void;
  onPageMessage?: (kind: string, data: unknown) => void;
  /**
   * The browser was created, or its discarded page is loading again. `chromeTabId`: Chrome's id
   * for the tab (chrome.tabs), 0 without Chrome tabs.
   */
  onReady?: (browserId: number, chromeTabId: number) => void;
  /**
   * The tab went to sleep: `discard()`, or Chrome discarded it (memory pressure, an extension's
   * chrome.tabs.discard). It loads `url` again when visible (`onReady`).
   */
  onDiscarded?: (url: string) => void;
  onPasswordPrompt?: (prompt: PasswordPrompt) => void;
  /** Chrome tabs: the tab's place in Chrome's tab strip changed. */
  onTabStrip?: (place: TabStripPlace) => void;
};

export type WebViewHandle = {
  /**
   * `userInitiated`: the user typed/picked this URL, so it loads even if it
   * turned into a download before (restores and remounts should omit it).
   */
  loadUrl(url: string, options?: { userInitiated?: boolean }): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  goToOffset(offset: number): Promise<void>;
  reload(): Promise<void>;
  forceReload(): Promise<void>;
  stopLoading(): Promise<void>;
  focus(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  /** ⌘+ (1) / ⌘- (-1) along Chrome's zoom steps, or back to 100% (0). */
  zoomStep(direction: 1 | -1 | 0): Promise<void>;
  /** Results arrive through `onFindResult`. Empty text clears. */
  find(text: string, forward: boolean, findNext: boolean): Promise<void>;
  stopFinding(clearSelection: boolean): Promise<void>;
  print(): Promise<void>;
  /**
   * Chrome's Developer menu commands: no panel = Developer Tools, "console" = JavaScript Console,
   * "inspect" = Inspect Elements (the element picker). As in Chrome, the first two close docked
   * DevTools again.
   */
  showDevTools(panel?: string): Promise<void>;
  executeJavaScript(code: string): Promise<void>;
  /**
   * Runs `code` in the page's main frame with a private `post(kind, json)` in
   * scope; resolves with the JSON passed to `post("result", …)` (parsed). Code
   * that throws synchronously resolves `{ error }`; null when there's no page or
   * it goes away (navigation, close, crash) before posting.
   * Example: `evaluate<string>('post("result", JSON.stringify(getSelection().toString()))')`.
   */
  evaluate<T = unknown>(code: string): Promise<T | null>;
  navigationEntries(): Promise<NavigationEntry[]>;
  /**
   * Downloads an icon (a `onFavicon` URL) through this tab's own request context,
   * without cookies; stored under `name` for persistent profiles (see FaviconImage).
   */
  downloadFavicon(url: string, name?: string): Promise<FaviconImage | null>;
  /**
   * Downloads any image (Media Session artwork, a notification's icon) through this tab's
   * own request context, without cookies, as a PNG data: URI at most `maxPixels` on its
   * longer side. Never written to disk.
   */
  downloadImage(url: string, maxPixels: number): Promise<FaviconImage | null>;

  /** Media controls for the tab's now-playing media (Media Session handlers first). `seconds` for seekBy/seekTo. */
  mediaCommand(action: MediaCommand, seconds?: number): Promise<void>;
  /** PiP for the tab's main video; false if there's none. */
  requestPictureInPicture(): Promise<boolean>;
  exitPictureInPicture(): Promise<void>;

  getSecurityInfo(): Promise<SecurityInfo>;
  /** Opens an `onPopupBlocked` popup; `always` also allows pop-ups for the site. */
  openBlockedPopup(id: string, always?: boolean): Promise<void>;
  /** Clears cookies and storage for the current page's origin. */
  clearSiteData(): Promise<{ cookies: number | false; storage: boolean }>;

  /** Answers `onPasswordPrompt`, with the username / password as edited in the prompt. */
  resolvePasswordPrompt(answer: PasswordPromptAnswer, edits?: { username?: string; password?: string }): Promise<void>;
  /**
   * Chrome tabs: puts the tab at `index` among its window's tabs of this profile in Chrome's
   * tab strip (what chrome.tabs reports), pinned or not. No-op otherwise.
   */
  setTabStrip(index: number, pinned: boolean): Promise<void>;
  /** Clicks an extension's toolbar button for this tab (null: this engine can't run actions). */
  executeExtensionAction(extensionId: string): Promise<ExtensionActionResult | null>;

  /** Answers `onDisplayMediaRequest`: share `sourceId` (one of its `sources`), or null to deny. */
  resolveDisplayMedia(id: string, sourceId: string | null): Promise<void>;
  /**
   * A source id that shares this tab, for another tab's `resolveDisplayMedia` ("Share this tab").
   * Ask right before sharing (it changes when the page moves to a new renderer). null without a
   * live page, or when the engine can't capture tabs (`engineInfo().tabCapture`).
   */
  mediaCaptureSourceId(): Promise<string | null>;
  /** The user clicked (focus the tab too) or dismissed an `onNotification` notification: runs the page's handlers. */
  notificationAction(id: string, action: "click" | "close"): Promise<void>;

  /** After `onUnresponsive`: kill the page (it then reports `onCrashed`) or keep waiting. */
  resolveUnresponsive(terminate: boolean): Promise<void>;
  /**
   * Puts the tab to sleep (`onDiscarded`). A Chrome tab is discarded as Chrome does it: its page's
   * memory is freed, the tab (history, chrome.tabs) stays and reloads when shown. `unload`, or any
   * other browser: the browser closes and is recreated with the last URL when shown (history is
   * lost), so its profile can unload. Resolves true when the browser closed.
   */
  discard(options?: { unload?: boolean }): Promise<boolean>;
  /** Freezes a hidden page (no script, timers or loading) or thaws it; showing the view thaws it too. */
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

/**
 * The app names Chrome's WebUI pages netnyahoo://x (core appUrls.ts); the engine only knows
 * chrome://x. URLs going in and coming out of the view are mapped here, so the app never sees
 * chrome:// (and page-initiated netnyahoo:// navigations are handled in NNClient).
 */
const toEngine = (url: string) => url.replace(/^(view-source:)?netnyahoo:(?:\/\/)?(?=[^/?#])/i, "$1chrome://");
const fromEngine = (url: string) => url.replace(/^(view-source:)?chrome:\/\/(?=[^/?#])/i, "$1netnyahoo://");

/** How each native event's payload maps onto the public callback's arguments. */
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
