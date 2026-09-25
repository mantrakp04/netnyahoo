import { requireNativeModule, requireNativeViewManager, requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";

export * from "./system";
export * from "./app";
export * from "./live";

/**
 * Menu-bar / keyboard-shortcut / Dock commands. Some carry an argument (a profile,
 * window, bookmark or closed-item id, a tab number, an appearance).
 */
export type BrowserCommand =
  | "newTab"
  | "newWindow"
  | "newIncognitoWindow"
  | "reopenClosedTab"
  | "reopenClosedWindow"
  | "restoreClosed"
  | "focusCommandBar"
  | "closeTab"
  | "closeAllTabs"
  | "print"
  | "copyUrl"
  | "copyUrlAsMarkdown"
  | "findInPage"
  | "findNext"
  | "findPrevious"
  | "setAppearance"
  | "reload"
  | "forceReload"
  | "toggleTabLayout"
  | "toggleSidebar"
  // Split view
  | "openSplitPane"
  | "useSelectionForFind"
  | "findAndReplace"
  | "jumpToSelection"
  | "focusNextPane"
  | "focusPreviousPane"
  | "toggleFullUrl"
  | "toggleAddressBar"
  | "cast"
  | "zoomReset"
  | "zoomIn"
  | "zoomOut"
  | "devTools"
  | "javaScriptConsole"
  | "viewSource"
  | "back"
  | "forward"
  | "nextTab"
  | "previousTab"
  | "selectTab"
  | "selectLastTab"
  | "togglePin"
  | "duplicateTab"
  | "moveTabToProfile"
  | "moveTabToWindow"
  | "bookmarkPage"
  | "addBookmarkToFolder"
  | "openBookmark"
  | "toggleMute"
  | "downloads"
  | "mergeAllWindows"
  | "switchProfile"
  | "nextProfile"
  | "previousProfile"
  | "newProfile"
  | "openSettings"
  | "importBrowserData"
  | "showHistory"
  | "clearBrowsingData"
  | "manageBookmarks"
  | "bookmarkAllTabs"
  | "setBookmarksBar"
  | "toggleBookmarksBar"
  // Sidebar & tabs
  | "newTabInGroup"
  | "newGroupWithTabs"
  | "cleanUpTabs"
  | "searchTabs"
  | "renameTab"
  | "changeTabIcon"
  | "returnToPinnedUrl"
  /** ⌃Tab / ⌃⇧Tab; arg "forward" | "backward". */
  | "tabSwitcher"
  // App integration (File › Share…, Help menu)
  | "share"
  | "sendFeedback"
  | "keyboardShortcuts"
  | "copyDiagnostics"
  | "recordPerformanceIssue"
  /** Help › Tool Tour (coach marks over the window) and Video Tour (hidden without a URL). */
  | "toolTour"
  | "videoTour"
  /** Help › Release Notes: this version's entry on the website. */
  | "releaseNotes"
  /** DEV builds: Help › Show Onboarding. */
  | "showOnboarding"
  | "taskManager"
  // Extensions menu; openExtension's arg is the extension id.
  | "openExtension"
  | "addExtension"
  | "manageExtensions"
  | "pinExtensions"
  /** Edit › AutoFill; arg "contact" | "passwords" | "creditCard". */
  | "autofill";

export type CommandEvent = {
  command: BrowserCommand;
  arg: string | null;
  /** The key browser window, or null (Dock menu, no windows open). */
  windowId: string | null;
};

export type WindowEvent =
  | { type: "focus"; id: string }
  | { type: "close"; id: string }
  /** Cocoa screen coordinates: [x, y (bottom-left), width, height]. */
  | { type: "frame"; id: string; frame: [number, number, number, number] }
  /** The window became hidden (minimised, covered, another Space) or visible again. */
  | { type: "occlusion"; id: string; visible: boolean }
  /** ⇧⌘W / the close button, with MenuState.warnBeforeClosingWindow on: JS closes it (or not). */
  | { type: "closeRequest"; id: string };

export type AppEvent =
  | { type: "reopen" }
  | { type: "willQuit" }
  | { type: "appearance"; dark: boolean }
  | { type: "quitWarningSuppressed" }
  /** The app stopped being frontmost / the screen locked (abandoned New Tab pages close). */
  | { type: "resignActive" }
  | { type: "screenLocked" }
  /** ⌃ went up (the ⌃Tab switcher commits). */
  | { type: "controlReleased" };

type ShellEvents = {
  onCommand: (e: CommandEvent) => void;
  onOpenURLs: (e: { urls: string[] }) => void;
  onWindowEvent: (e: WindowEvent) => void;
  onAppEvent: (e: AppEvent) => void;
};

export type MenuItem =
  | { separator: true }
  | {
      id: string;
      title: string;
      /** SF Symbol shown before the title. */
      symbol?: string;
      /** Hex colour for a round swatch instead of a symbol. */
      swatch?: string;
      /** Shortcut hint, e.g. key "w" + modifiers ["command"]. */
      key?: string;
      modifiers?: ("command" | "shift" | "option" | "control")[];
      enabled?: boolean;
      checked?: boolean;
      children?: MenuItem[];
    };

export type OpenWindowOptions = {
  /** Cocoa frame to restore; omitted → cascade from the key window. */
  frame?: [number, number, number, number] | null;
  incognito?: boolean;
  title?: string;
  /** Make it the key window (default true). */
  focus?: boolean;
  /** "settings" / "import" / "taskManager": a utility window (own React root, no tabs, frame autosaved). */
  kind?: "browser" | "settings" | "import" | "taskManager";
  /** The engine profile the window shows first (Chrome-hosted windows are that profile's Chrome window). */
  profile?: string;
};

export type MenuEntry = { id: string; title: string; current?: boolean };
export type MenuBookmark = { id: string; title: string; url?: string; children?: MenuBookmark[] };

/** Everything the menu bar shows that depends on app state (see Menus.swift). */
export type MenuState = {
  /** Item keys: "command" or "command:arg". */
  checked: string[];
  disabled: string[];
  titles: Record<string, string>;
  profiles: MenuEntry[];
  windows: MenuEntry[];
  bookmarkFolders: MenuEntry[];
  recentBookmarks: MenuBookmark[];
  bookmarksBar: MenuBookmark[];
  otherBookmarks: MenuBookmark[];
  recentlyClosed: MenuEntry[];
  /** History › Recently Closed Groups. */
  recentlyClosedGroups?: MenuEntry[];
  warnBeforeQuitting: boolean;
  /** ⇧⌘W / the close button send `closeRequest` instead of closing. */
  warnBeforeClosingWindow?: boolean;
  /** Running downloads; quitting asks first. */
  downloadsInProgress?: number;
  /** The Extensions menu's list (icon: data URL). */
  extensions?: { id: string; title: string; icon?: string | null; enabled: boolean }[];
  /** Remapped shortcuts: item key → [key, ...modifiers]; key "" removes the shortcut. */
  shortcuts?: Record<string, string[]>;
};

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmTitle?: string;
  cancelTitle?: string;
  destructive?: boolean;
  /** Title of a "don't ask again" checkbox. */
  suppression?: string;
  /** Show as a sheet on this window. */
  windowId?: string;
};

export type PromptOptions = {
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  confirmTitle?: string;
  windowId?: string;
};

type Frame = [number, number, number, number];

const Shell = requireNativeModule<{
  addListener<K extends keyof ShellEvents>(name: K, listener: ShellEvents[K]): EventSubscription;
  showMenu(items: MenuItem[]): Promise<string | null>;
  copyText(text: string): void;
  startDictation(): void;
  pickFiles(): Promise<string[]>;
  readDocument(name: string): string | null;
  writeDocument(name: string, contents: string): void;
  hasWindowHost?(): boolean;
  openWindow(id: string, options: OpenWindowOptions): Promise<void>;
  closeWindow(id: string): Promise<void>;
  focusWindow(id: string): Promise<void>;
  setWindowTitle(id: string, title: string): Promise<void>;
  windowIds(): Promise<string[]>;
  keyWindowId(): Promise<string | null>;
  setAppearance(mode: "auto" | "light" | "dark"): Promise<void>;
  isDarkAppearance(): Promise<boolean>;
  setMenuState(state: MenuState): Promise<void>;
  replyToTerminate(ok: boolean): Promise<void>;
  confirm(options: ConfirmOptions): Promise<{ confirmed: boolean; suppressed: boolean }>;
  prompt(options: PromptOptions): Promise<string | null>;
}>("NetnyahooShell");

/** Read/write a small document in Application Support (e.g. the saved session). */
export const readDocument = (name: string) => Shell.readDocument(name);
export const writeDocument = (name: string, contents: string) => Shell.writeDocument(name, contents);

export const startDictation = () => Shell.startDictation();
export const pickFiles = () => Shell.pickFiles();

export function copyText(text: string) {
  Shell.copyText(text);
}

/** Show a native context menu at the pointer; resolves with the chosen id. */
export function showMenu(items: MenuItem[]): Promise<string | null> {
  return Shell.showMenu(items);
}

/**
 * Native windows. Each is a BrowserWindow with its own React root, rendered with
 * `initialProperties: { windowId }` on the shared bridge. False on app builds
 * that predate multi-window support: they host a single root with no windowId.
 */
export const hasWindowHost = typeof Shell.hasWindowHost === "function" && Shell.hasWindowHost();
export const openWindow = (id: string, options: OpenWindowOptions = {}) => Shell.openWindow(id, options);
export const closeWindow = (id: string) => Shell.closeWindow(id);
export const focusWindow = (id: string) => Shell.focusWindow(id);
export const setWindowTitle = (id: string, title: string) => Shell.setWindowTitle(id, title);
export const windowIds = () => Shell.windowIds();
export const keyWindowId = () => Shell.keyWindowId();

export const setAppearance = (mode: "auto" | "light" | "dark") => Shell.setAppearance(mode);
export const isDarkAppearance = () => Shell.isDarkAppearance();
export const setMenuState = (state: MenuState) => Shell.setMenuState(state);
export const replyToTerminate = (ok: boolean) => Shell.replyToTerminate(ok);

/** Two-button alert (a sheet when `windowId` is given). */
export const confirm = (options: ConfirmOptions) => Shell.confirm(options);
/** Alert with a text field; resolves with the trimmed text, or null if cancelled/empty. */
export const prompt = (options: PromptOptions) => Shell.prompt(options);

export const onCommand = (listener: (e: CommandEvent) => void) => Shell.addListener("onCommand", listener);
export const onWindowEvent = (listener: (e: WindowEvent) => void) => Shell.addListener("onWindowEvent", listener);
export const onAppEvent = (listener: (e: AppEvent) => void) => Shell.addListener("onAppEvent", listener);
/** URLs opened with the app (default browser links, `open -a Netnyahoo <url>`, file drops). */
export const onOpenURLs = (listener: (urls: string[]) => void) =>
  Shell.addListener("onOpenURLs", ({ urls }) => listener(urls));

export type { Frame as WindowFrame };

export const WindowDragRegion = requireNativeViewManager<ViewProps>("NetnyahooShell");

export type SymbolProps = ViewProps & {
  /** SF Symbol name, e.g. "chevron.left". */
  name: string;
  size?: number;
  weight?: "light" | "regular" | "medium" | "semibold" | "bold";
  /** Hex colour. */
  color?: string;
};

export const Symbol = requireNativeViewManager<SymbolProps>("NetnyahooSymbol");

export type FadeLabelProps = ViewProps & {
  text: string;
  fontSize?: number;
  weight?: "light" | "regular" | "medium" | "semibold" | "bold";
  /** Hex colour (#RRGGBB or #RRGGBBAA). */
  color?: string;
  /** Width of the trailing fade when the text overflows. */
  fadeWidth?: number;
};

/** Single-line text that fades out at the trailing edge instead of using an ellipsis. */
export const FadeLabel = requireNativeViewManager<FadeLabelProps>("NetnyahooFadeLabel");

/**
 * Dia's tab loading spinner (a track ring and a turning arc in secondaryLabelColor); size it
 * with `style`, 12×12 in tab rows. Renders nothing on app builds from before it existed.
 */
export const ActivitySpinner: ComponentType<ViewProps> = requireOptionalNativeModule("NetnyahooActivitySpinner")
  ? requireNativeViewManager<ViewProps>("NetnyahooActivitySpinner")
  : () => null;

export type ContextMenuAreaProps = ViewProps & {
  onContextMenu?: () => void;
  /** Also take right-clicks on descendants with their own menu (e.g. a TextInput's Cut/Copy/Paste). */
  captureDescendants?: boolean;
};

const NativeContextMenuArea = requireNativeViewManager<Omit<ContextMenuAreaProps, "onContextMenu"> & { onContextMenu?: () => void }>(
  "NetnyahooContextMenuArea",
);

/** Calls `onContextMenu` on right-click / ctrl-click anywhere inside. */
export function ContextMenuArea(props: ContextMenuAreaProps) {
  return <NativeContextMenuArea {...props} />;
}

export type SurfaceProps = ViewProps & {
  /** Fill color (hex). */
  fill?: string;
  cornerRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  /** [top, bottom] hex colors for a gradient border (overrides borderColor). */
  borderColors?: string[];
  shadowColor?: string;
  shadowOpacity?: number;
  shadowRadius?: number;
  /** [x, y]; positive y moves the shadow down. */
  shadowOffset?: [number, number];
};

type NativeSurfaceProps = Omit<SurfaceProps, "shadowColor" | "shadowOpacity" | "shadowRadius" | "shadowOffset"> & {
  surfaceShadowColor?: string;
  surfaceShadowOpacity?: number;
  surfaceShadowRadius?: number;
  surfaceShadowOffset?: [number, number];
};

const NativeSurface = requireNativeViewManager<NativeSurfaceProps>("NetnyahooSurface");

/**
 * Rounded surface with fill, border and shadow drawn natively. Use this for any
 * shadowed view: react-native-macos crashes when RN shadow props are re-applied.
 * (The shadow goes over as `surfaceShadow*` so RN's own view manager never sees it.)
 */
export function Surface({ shadowColor, shadowOpacity, shadowRadius, shadowOffset, ...props }: SurfaceProps) {
  return (
    <NativeSurface
      {...props}
      surfaceShadowColor={shadowColor}
      surfaceShadowOpacity={shadowOpacity}
      surfaceShadowRadius={shadowRadius}
      surfaceShadowOffset={shadowOffset}
    />
  );
}

export type VisualEffectProps = ViewProps & {
  /** NSVisualEffectView.Material name, e.g. "hudWindow" (default), "popover", "menu". */
  material?: string;
  /** "withinWindow" (default) blurs what's behind it in this window; "behindWindow" the desktop. */
  blendingMode?: "withinWindow" | "behindWindow";
  cornerRadius?: number;
};

/** Native blur material (NSVisualEffectView). Ignores mouse events. */
export const VisualEffect = requireNativeViewManager<VisualEffectProps>("NetnyahooVisualEffect");

/**
 * How Dia themes a selected pinned tile by its icon (TabUI `TabIconProcessor`): `blur` for a
 * colourful icon, `template` for a one-colour one (the tile filled with `fill`, the icon drawn
 * white, the ring `stroke` or white in soft-light).
 */
export type IconTheme = { kind: "blur" } | { kind: "template"; fill: string; stroke?: string };

const DockSelectionModule = requireOptionalNativeModule<{
  iconTheme(uri: string | null, emoji: string | null): Promise<IconTheme | null>;
}>("NetnyahooDockSelection");

/** Whether this build draws themed tiles (DockSelection); older builds keep the plain tile. */
export const hasDockSelection = !!DockSelectionModule;

/** The theme of a favicon (file: or data: URI) or an emoji; null when it has none. */
export const iconTheme = (source: { uri: string } | { emoji: string }): Promise<IconTheme | null> =>
  DockSelectionModule
    ? DockSelectionModule.iconTheme("uri" in source ? source.uri : null, "emoji" in source ? source.emoji : null)
    : Promise.resolve(null);

export type DockSelectionProps = ViewProps & {
  /** The icon the theme came from: a favicon URI, or `emoji`. */
  image?: string;
  emoji?: string;
  theme: IconTheme["kind"];
  /** template: the tile's fill and ring (hex); no stroke = white soft-light. */
  fill?: string;
  stroke?: string;
  cornerRadius?: number;
  strokeWidth?: number;
  /** template: the white icon it draws itself, centred (RN's Image can't tint a template). */
  iconSize?: number;
  dark: boolean;
};

/** A selected pinned tile drawn from its icon's theme (see IconTheme); children go on top. */
export const DockSelection: ComponentType<DockSelectionProps> = DockSelectionModule
  ? requireNativeViewManager<DockSelectionProps>("NetnyahooDockSelection")
  : () => null;

const InlineCompletionModule = requireOptionalNativeModule<{
  complete(tag: number, typed: string, completion: string): Promise<InlineWrite>;
}>("NetnyahooInlineCompletion");

/** How `completeInline` went: refused (nothing changed), selected (the text was already there), edited (an `onChange` follows). */
export type InlineWrite = 0 | 1 | 2;

/**
 * Shows `typed` + `completion` in the TextInput with react tag `tag`, the completion selected, if
 * the field still shows exactly `typed` (with the caret after it, or an earlier completion
 * selected), in one step on the main thread. Null on builds from before it.
 */
export const completeInline = InlineCompletionModule
  ? (tag: number, typed: string, completion: string) => InlineCompletionModule.complete(tag, typed, completion)
  : null;
