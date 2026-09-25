import { requireNativeViewManager, requireOptionalNativeModule } from "expo-modules-core";
import { View, type ViewProps } from "react-native";

export type MenuShortcut = {
  /** "command" or "command:arg" for app actions; "std:<menu path>" for AppKit's own items. */
  id: string;
  title: string;
  /** Menu titles above the item, e.g. ["View", "Show Bookmarks Bar"]. */
  path: string[];
  /** Key equivalent as AppKit stores it ("" = none). */
  key: string;
  modifiers: ShortcutModifier[];
  defaultKey: string;
  defaultModifiers: ShortcutModifier[];
  remappable: boolean;
};

export type ShortcutModifier = "control" | "option" | "shift" | "command" | "function";

type LaunchAtLoginStatus = "enabled" | "requiresApproval" | "notRegistered" | "notFound";

// Optional: app builds from before this module still load the JS (Metro serves every build).
const System = requireOptionalNativeModule<{
  isDefaultBrowser(): Promise<boolean>;
  setAsDefaultBrowser(): Promise<boolean>;
  launchAtLoginStatus(): Promise<LaunchAtLoginStatus>;
  setLaunchAtLogin(enabled: boolean): Promise<void>;
  fileExists(path: string): boolean;
  openFile(path: string): Promise<boolean>;
  revealFile(path: string): Promise<boolean>;
  moveToTrash(path: string): Promise<boolean>;
  fileIcon(path: string, size: number): Promise<string | null>;
  appIcon?(pid: number, size: number): Promise<string | null>;
  hapticTick(): void;
  menuShortcuts(): Promise<MenuShortcut[]>;
  recordShortcut(): Promise<{ key: string; modifiers: ShortcutModifier[] } | null>;
  cancelRecording(): Promise<void>;
}>("NetnyahooSystem");

/** False on app builds that predate the system module (everything below then no-ops). */
export const hasSystemModule = !!System;

/** Whether this app is the default web browser. */
export const isDefaultBrowser = async () => (await System?.isDefaultBrowser()) ?? false;
/** macOS asks the user to confirm; resolves with whether it's the default afterwards. */
export const setAsDefaultBrowser = async () => (await System?.setAsDefaultBrowser()) ?? false;
/** The app's login item (SMAppService). "requiresApproval" = waiting in System Settings › Login Items. */
export const launchAtLoginStatus = async (): Promise<LaunchAtLoginStatus> => (await System?.launchAtLoginStatus()) ?? "notFound";
export const setLaunchAtLogin = async (enabled: boolean) => System?.setLaunchAtLogin(enabled);

export const fileExists = (path: string) => System?.fileExists(path) ?? true;
export const openFile = async (path: string) => (await System?.openFile(path)) ?? false;
export const revealFile = async (path: string) => (await System?.revealFile(path)) ?? false;
/** Moves a file to the Trash; false if it's gone or can't be moved. */
export const moveToTrash = async (path: string) => (await System?.moveToTrash(path)) ?? false;
/** Finder icon as a PNG data URL (`size` in points; rendered at 2×). */
export const fileIcon = async (path: string, size = 32) => (await System?.fileIcon(path, size)) ?? null;
/** A running app's Dock icon by process id, as a PNG data URL (null on builds without it). */
export const runningAppIcon = async (pid: number, size = 32) => (typeof System?.appIcon === "function" ? await System.appIcon(pid, size) : null) ?? null;
export const hapticTick = () => System?.hapticTick();
/** Every menu-bar action with its shortcut, for the Keyboard Shortcuts settings pane. */
export const menuShortcuts = async () => (await System?.menuShortcuts()) ?? [];
/** Resolves with the next key combination pressed (menus don't fire), or null (Escape, click, cancel). */
export const recordShortcut = async () => (await System?.recordShortcut()) ?? null;
export const cancelShortcutRecording = async () => System?.cancelRecording();

export type MiddleClickEvent = { shiftKey: boolean; altKey: boolean; metaKey: boolean };

export type MouseAreaProps = ViewProps & {
  /** Local file dragged out to Finder / other apps; no drag when missing. */
  path?: string | null;
  /** Middle mouse button released inside (React Native only reports left/right clicks). */
  onMiddleClick?: (e: MiddleClickEvent) => void;
};

type NativeMouseAreaProps = Omit<MouseAreaProps, "onMiddleClick"> & { onMiddleClick?: (e: { nativeEvent: MiddleClickEvent }) => void };

const NativeMouseArea = System ? requireNativeViewManager<NativeMouseAreaProps>("NetnyahooFileDrag") : null;

/** Wraps content that can be dragged out of the app as a file and/or middle-clicked. */
export function MouseArea({ path, onMiddleClick, ...props }: MouseAreaProps) {
  if (!NativeMouseArea) return <View {...props} />;
  return <NativeMouseArea path={path} onMiddleClick={onMiddleClick && ((e) => onMiddleClick(e.nativeEvent))} {...props} />;
}
