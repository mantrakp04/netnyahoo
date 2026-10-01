import { requireNativeViewManager, requireOptionalNativeModule } from "expo-modules-core";
import { View, type ViewProps } from "react-native";

export type MenuShortcut = {
  id: string;
  title: string;
  path: string[];
  key: string;
  modifiers: ShortcutModifier[];
  defaultKey: string;
  defaultModifiers: ShortcutModifier[];
  remappable: boolean;
};

export type ShortcutModifier = "control" | "option" | "shift" | "command" | "function";

type LaunchAtLoginStatus = "enabled" | "requiresApproval" | "notRegistered" | "notFound";

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

export const isDefaultBrowser = async () => (await System?.isDefaultBrowser()) ?? false;
export const setAsDefaultBrowser = async () => (await System?.setAsDefaultBrowser()) ?? false;
export const launchAtLoginStatus = async (): Promise<LaunchAtLoginStatus> => (await System?.launchAtLoginStatus()) ?? "notFound";
export const setLaunchAtLogin = async (enabled: boolean) => System?.setLaunchAtLogin(enabled);

export const fileExists = (path: string) => System?.fileExists(path) ?? true;
export const openFile = async (path: string) => (await System?.openFile(path)) ?? false;
export const revealFile = async (path: string) => (await System?.revealFile(path)) ?? false;
export const moveToTrash = async (path: string) => (await System?.moveToTrash(path)) ?? false;
export const fileIcon = async (path: string, size = 32) => (await System?.fileIcon(path, size)) ?? null;
export const runningAppIcon = async (pid: number, size = 32) => (typeof System?.appIcon === "function" ? await System.appIcon(pid, size) : null) ?? null;
export const hapticTick = () => System?.hapticTick();
export const menuShortcuts = async () => (await System?.menuShortcuts()) ?? [];
export const recordShortcut = async () => (await System?.recordShortcut()) ?? null;
export const cancelShortcutRecording = async () => System?.cancelRecording();

export type MiddleClickEvent = { shiftKey: boolean; altKey: boolean; metaKey: boolean };

export type MouseAreaProps = ViewProps & {
  path?: string | null;
  onMiddleClick?: (e: MiddleClickEvent) => void;
};

type NativeMouseAreaProps = Omit<MouseAreaProps, "onMiddleClick"> & { onMiddleClick?: (e: { nativeEvent: MiddleClickEvent }) => void };

const NativeMouseArea = System ? requireNativeViewManager<NativeMouseAreaProps>("NetnyahooFileDrag") : null;

export function MouseArea({ path, onMiddleClick, ...props }: MouseAreaProps) {
  if (!NativeMouseArea) return <View {...props} />;
  return <NativeMouseArea path={path} onMiddleClick={onMiddleClick && ((e) => onMiddleClick(e.nativeEvent))} {...props} />;
}
