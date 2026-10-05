import { requireNativeModule, requireNativeViewManager, type EventSubscription } from "expo-modules-core";
import type { ViewProps } from "react-native";

export * from "./system";
export * from "./app";
export * from "./live";

export type BrowserCommand =
  | "newTab"
  | "newWindow"
  | "newIncognitoWindow"
  | "newSmallYahu"
  | "toggleOpenLinksInSmallYahu"
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
  | "toggleDevTools"
  | "javaScriptConsole"
  | "inspectElements"
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
  | "newTabInGroup"
  | "newGroupWithTabs"
  | "cleanUpTabs"
  | "searchTabs"
  | "renameTab"
  | "changeTabIcon"
  | "returnToPinnedUrl"
  | "tabSwitcher"
  | "share"
  | "sendFeedback"
  | "keyboardShortcuts"
  | "copyDiagnostics"
  | "recordPerformanceIssue"
  | "toolTour"
  | "videoTour"
  | "releaseNotes"
  | "showOnboarding"
  | "taskManager"
  | "openExtension"
  | "addExtension"
  | "manageExtensions"
  | "pinExtensions"
  | "autofill"
  | "openFile"
  | "savePage"
  | "emailPageLocation"
  | "printWithSystemDialog"
  | "stop"
  | "caretBrowsing"
  | "moveTabDown"
  | "moveTabUp"
  | "closeTabGroup"
  | "openProfileMenu";

export type CommandEvent = {
  command: BrowserCommand;
  arg: string | null;
  windowId: string | null;
};

export type WindowEvent =
  | { type: "focus"; id: string }
  | { type: "close"; id: string }
  | { type: "frame"; id: string; frame: [number, number, number, number] }
  | { type: "closeRequest"; id: string };

export type AppEvent =
  | { type: "reopen" }
  | { type: "willQuit" }
  | { type: "quitCancelled" }
  | { type: "appearance"; dark: boolean }
  | { type: "quitWarningSuppressed" }
  | { type: "resignActive" }
  | { type: "screenLocked" }
  | { type: "controlReleased" }
  | { type: "switcherKey"; key: "escape" | "next" | "previous" }
  | { type: "switcherMouseUp" };

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
      symbol?: string;
      swatch?: string;
      key?: string;
      modifiers?: ("command" | "shift" | "option" | "control")[];
      enabled?: boolean;
      checked?: boolean;
      children?: MenuItem[];
      // A submenu of the system's sharing services; picking one answers "<id>:via:<service>" (sharePageVia).
      share?: boolean;
    };

export type OpenWindowOptions = {
  frame?: [number, number, number, number] | null;
  incognito?: boolean;
  title?: string;
  focus?: boolean;
  kind?: "browser" | "small" | "settings" | "import" | "taskManager";
  profile?: string;
  // Small Yahu: its remembered size; the window opens centred on the active screen.
  size?: [number, number];
};

export type MenuEntry = { id: string; title: string; current?: boolean };
export type MenuBookmark = { id: string; title: string; url?: string; children?: MenuBookmark[] };

export type MenuState = {
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
  recentlyClosedGroups?: MenuEntry[];
  warnBeforeQuitting: boolean;
  warnBeforeClosingWindow?: boolean;
  downloadsInProgress?: number;
  extensions?: { id: string; title: string; icon?: string | null; enabled: boolean }[];
  shortcuts?: Record<string, string[]>;
};

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmTitle?: string;
  cancelTitle?: string;
  destructive?: boolean;
  suppression?: string;
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
  setSwitcherCapture(active: boolean): Promise<void>;
  startDictation(): void;
  pickFiles(): Promise<string[]>;
  readDocument(name: string): string | null;
  writeDocument(name: string, contents: string): void;
  saveDocument(name: string, contents: string): Promise<void>;
  removeDocument(name: string): void;
  openWindow(id: string, options: OpenWindowOptions): Promise<void>;
  closeWindow(id: string): Promise<void>;
  focusWindow(id: string): Promise<void>;
  setTrafficLightsCenter(id: string, center: [number, number] | null): Promise<void>;
  dragPreviewBegin?(windowId: string, chip: Rect4, grab: [number, number]): Promise<void>;
  dragPreviewPage?(base64: string, frame: Rect4): Promise<void>;
  dragPreviewUpdate?(shape: DragPreviewShape, point: [number, number]): Promise<void>;
  dragPreviewCancel?(): Promise<void>;
  raiseView?(tag: number, levels: number, raised: boolean): Promise<void>;
  dragPreviewPlaceholder?(title: string, favicon: string | null): Promise<void>;
  windowFrame?(id: string): Promise<Rect4 | null>;
  dragPreviewEnd?(windowId: string | null, frame: Rect4 | null): Promise<void>;
  setWindowTitle(id: string, title: string): Promise<void>;
  windowIds(): Promise<string[]>;
  setAppearance(mode: "auto" | "light" | "dark"): Promise<void>;
  isDarkAppearance(): Promise<boolean>;
  setMenuState(state: Omit<MenuState, MenuBookmarkKey>): Promise<void>;
  setMenuBookmarks(bookmarks: Pick<MenuState, MenuBookmarkKey>): Promise<void>;
  replyToTerminate(ok: boolean): Promise<void>;
  confirm(options: ConfirmOptions): Promise<{ confirmed: boolean; suppressed: boolean }>;
  prompt(options: PromptOptions): Promise<string | null>;
}>("NetnyahooShell");

export const readDocument = (name: string) => Shell.readDocument(name);
export const writeDocument = (name: string, contents: string) => Shell.writeDocument(name, contents);
/** Resolves once the document is on disk (writeDocument returns before), rejects if it can't be written. */
export const saveDocument = (name: string, contents: string) => Shell.saveDocument(name, contents);
export const removeDocument = (name: string) => Shell.removeDocument(name);

export const startDictation = () => Shell.startDictation();
export const setSwitcherCapture = (active: boolean) => void Shell.setSwitcherCapture(active);
export const pickFiles = () => Shell.pickFiles();

export function copyText(text: string) {
  Shell.copyText(text);
}

export function showMenu(items: MenuItem[]): Promise<string | null> {
  return Shell.showMenu(items);
}

export const openWindow = (id: string, options: OpenWindowOptions = {}) => Shell.openWindow(id, options);

export type WindowProfileProps = ViewProps & {
  profile: string;
  neighbours: string[];
};
export const WindowProfile = requireNativeViewManager<WindowProfileProps>("NetnyahooWindowProfile");

export const closeWindow = (id: string) => Shell.closeWindow(id);
export const focusWindow = (id: string) => Shell.focusWindow(id);
export const setWindowTitle = (id: string, title: string) => Shell.setWindowTitle(id, title);
export const setTrafficLightsCenter = (id: string, center: [number, number] | null) =>
  Shell.setTrafficLightsCenter(id, center);
type Rect4 = [number, number, number, number];
export type DragPreviewShape = "hidden" | "pill" | "card";
// The dragged tab's picture under the pointer, a native panel that floats over everything (Windows.swift ›
// DragPreview). Rects and points are in the source window from its top-left; `end`'s frame (the new window's, as
// asked for) is on screen, in AppKit's coordinates. Optional: builds from before it have no picture, nothing else
// changes.
export const dragPreview = {
  begin: (windowId: string, chip: Rect4, grab: [number, number]) => void Shell.dragPreviewBegin?.(windowId, chip, grab),
  page: (base64: string, frame: Rect4) => void Shell.dragPreviewPage?.(base64, frame),
  update: (shape: DragPreviewShape, point: [number, number]) => void Shell.dragPreviewUpdate?.(shape, point),
  /** `windowId`: the new window the tab went to; the picture grows into it. */
  end: (windowId: string | null = null, frame: Rect4 | null = null) => void Shell.dragPreviewEnd?.(windowId, frame),
  cancel: () => void Shell.dragPreviewCancel?.(),
  /** A tab with no picture: its icon (a data: or file: URL) and title where its page would be. */
  placeholder: (title: string, favicon: string | null) => void Shell.dragPreviewPlaceholder?.(title, favicon),
};
/** Draws the view with React tag `tag` (and `levels` of its ancestors) over its siblings, or back in React's order:
 * React Native macOS's zIndex doesn't reorder them. A no-op on builds without it. */
export const raiseView = (tag: number | null, levels: number, raised: boolean) => {
  if (tag != null) void Shell.raiseView?.(tag, levels, raised);
};
/** The window's frame now, on screen (AppKit's coordinates); null on builds without it. */
export const windowFrame = (id: string): Promise<Rect4 | null> => Shell.windowFrame?.(id) ?? Promise.resolve(null);
export const windowIds = () => Shell.windowIds();

export const setAppearance = (mode: "auto" | "light" | "dark") => Shell.setAppearance(mode);
export const isDarkAppearance = () => Shell.isDarkAppearance();

type MenuBookmarkKey = "bookmarkFolders" | "recentBookmarks" | "bookmarksBar" | "otherBookmarks";
/**
 * Sends the menu state with the bookmark lists only when `bookmarksChanged`, so the native menus rebuild (and the
 * bridge carries) thousands of bookmarks only when they change.
 */
export function setMenuStateParts(state: MenuState, bookmarksChanged: boolean) {
  const { bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks, ...rest } = state;
  if (bookmarksChanged) void Shell.setMenuBookmarks({ bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks });
  return Shell.setMenuState(rest);
}
export const replyToTerminate = (ok: boolean) => Shell.replyToTerminate(ok);

export const confirm = (options: ConfirmOptions) => Shell.confirm(options);
export const prompt = (options: PromptOptions) => Shell.prompt(options);

export const onCommand = (listener: (e: CommandEvent) => void) => Shell.addListener("onCommand", listener);
export const onWindowEvent = (listener: (e: WindowEvent) => void) => Shell.addListener("onWindowEvent", listener);
export const onAppEvent = (listener: (e: AppEvent) => void) => Shell.addListener("onAppEvent", listener);
export const onOpenURLs = (listener: (urls: string[]) => void) =>
  Shell.addListener("onOpenURLs", ({ urls }) => listener(urls));

export const WindowDragRegion = requireNativeViewManager<ViewProps>("NetnyahooShell");

export type SymbolProps = ViewProps & {
  name: string;
  size?: number;
  weight?: "light" | "regular" | "medium" | "semibold" | "bold";
  color?: string;
};

export const Symbol = requireNativeViewManager<SymbolProps>("NetnyahooSymbol");

export type FadeLabelProps = ViewProps & {
  text: string;
  fontSize?: number;
  weight?: "light" | "regular" | "medium" | "semibold" | "bold";
  color?: string;
  fadeWidth?: number;
};

export const FadeLabel = requireNativeViewManager<FadeLabelProps>("NetnyahooFadeLabel");

export const ActivitySpinner = requireNativeViewManager<ViewProps>("NetnyahooActivitySpinner");

export type ContextMenuAreaProps = ViewProps & {
  onContextMenu?: () => void;
  captureDescendants?: boolean;
};

const NativeContextMenuArea = requireNativeViewManager<Omit<ContextMenuAreaProps, "onContextMenu"> & { onContextMenu?: () => void }>(
  "NetnyahooContextMenuArea",
);

export function ContextMenuArea(props: ContextMenuAreaProps) {
  return <NativeContextMenuArea {...props} />;
}

export type SurfaceProps = ViewProps & {
  fill?: string;
  cornerRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  borderColors?: string[];
  shadowColor?: string;
  shadowOpacity?: number;
  shadowRadius?: number;
  shadowOffset?: [number, number];
};

type NativeSurfaceProps = Omit<SurfaceProps, "shadowColor" | "shadowOpacity" | "shadowRadius" | "shadowOffset"> & {
  surfaceShadowColor?: string;
  surfaceShadowOpacity?: number;
  surfaceShadowRadius?: number;
  surfaceShadowOffset?: [number, number];
};

const NativeSurface = requireNativeViewManager<NativeSurfaceProps>("NetnyahooSurface");

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
  material?: string;
  blendingMode?: "withinWindow" | "behindWindow";
  cornerRadius?: number;
};

export const VisualEffect = requireNativeViewManager<VisualEffectProps>("NetnyahooVisualEffect");

export type GlassEffectProps = ViewProps & {
  cornerRadius?: number;
  tint?: string;
  glassStyle?: "regular" | "clear";
  dark?: boolean;
};

const GlassEffectModule = requireNativeModule<{ isLiquidGlass(): boolean }>("NetnyahooGlassEffect");

export const isLiquidGlass = (): boolean => GlassEffectModule.isLiquidGlass();

export const GlassEffect = requireNativeViewManager<GlassEffectProps>("NetnyahooGlassEffect");

export type IconTheme = { kind: "blur" } | { kind: "template"; fill: string; stroke?: string };

const DockSelectionModule = requireNativeModule<{
  iconTheme(uri: string | null, emoji: string | null): Promise<IconTheme | null>;
}>("NetnyahooDockSelection");

export const iconTheme = (source: { uri: string } | { emoji: string }): Promise<IconTheme | null> =>
  DockSelectionModule.iconTheme("uri" in source ? source.uri : null, "emoji" in source ? source.emoji : null);

export type DockSelectionProps = ViewProps & {
  image?: string;
  emoji?: string;
  theme?: IconTheme["kind"];
  fill?: string;
  stroke?: string;
  cornerRadius?: number;
  strokeWidth?: number;
  iconSize?: number;
  dark: boolean;
  glass?: boolean;
};

export const DockSelection = requireNativeViewManager<DockSelectionProps>("NetnyahooDockSelection");

const InlineCompletionModule = requireNativeModule<{
  complete(tag: number, typed: string, completion: string): Promise<InlineWrite>;
}>("NetnyahooInlineCompletion");

export type InlineWrite = 0 | 1 | 2;

export const completeInline = (tag: number, typed: string, completion: string) =>
  InlineCompletionModule.complete(tag, typed, completion);

type TranslationModule = {
  readonly available: boolean;
  userLanguages(): string[];
  languageName(identifier: string): string;
  detect(text: string): Promise<string | null>;
  status(source: string, target: string): Promise<"installed" | "supported" | "unsupported">;
  supportedLanguages(): Promise<string[]>;
  prepare(source: string, target: string): Promise<void>;
  translate(source: string, target: string, texts: string[]): Promise<string[]>;
  translateBlocks(source: string, target: string, blocks: string[][]): Promise<(string[] | null)[]>;
};
const TranslationNative = requireNativeModule<TranslationModule>("NetnyahooTranslate");

// Null before macOS 26, which has no translation API for apps.
export const translation: Omit<TranslationModule, "available"> | null = TranslationNative.available ? TranslationNative : null;
