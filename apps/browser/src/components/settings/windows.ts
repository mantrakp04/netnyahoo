import { hasWindowHost, openWindow } from "@netnyahoo/shell";
import { create } from "zustand";
import { TASK_MANAGER_WINDOW_ID } from "../taskManager/window";

/**
 * The Settings (⌘,) and Import windows. Each is a utility NSWindow with its own
 * React root (Windows.swift, `kind`), rendered by WindowRoot for these ids.
 */
export const SETTINGS_WINDOW_ID = "settings";
export const IMPORT_WINDOW_ID = "import";

export const isUtilityWindowId = (id: string | null | undefined) =>
  id === SETTINGS_WINDOW_ID || id === IMPORT_WINDOW_ID || id === TASK_MANAGER_WINDOW_ID;

export type SettingsPane =
  | "general"
  | "profiles"
  | "tabs"
  | "appearance"
  | "privacy"
  | "passwords"
  | "autofill"
  | "extensions"
  | "search"
  | "shortcuts"
  | "liveFolders"
  | "calendar"
  | "advanced";

type Nav = {
  pane: SettingsPane;
  /** Profiles › Profile Details; for Passwords and Autofill, the profile they start on. */
  profileId: string | null;
  /** Back / forward history, like Dia's toolbar arrows. */
  back: { pane: SettingsPane; profileId: string | null }[];
  forward: { pane: SettingsPane; profileId: string | null }[];
  go(pane: SettingsPane, profileId?: string | null): void;
  goBack(): void;
  goForward(): void;
};

export const useSettingsNav = create<Nav>((set, get) => ({
  pane: "general",
  profileId: null,
  back: [],
  forward: [],
  go(pane, profileId = null) {
    const { pane: from, profileId: fromProfile, back } = get();
    if (from === pane && fromProfile === profileId) return;
    set({ pane, profileId, back: [...back, { pane: from, profileId: fromProfile }].slice(-30), forward: [] });
  },
  goBack() {
    const { back, forward, pane, profileId } = get();
    const prev = back.at(-1);
    if (prev) set({ ...prev, back: back.slice(0, -1), forward: [{ pane, profileId }, ...forward] });
  },
  goForward() {
    const { back, forward, pane, profileId } = get();
    const next = forward[0];
    if (next) set({ ...next, forward: forward.slice(1), back: [...back, { pane, profileId }] });
  },
}));

/** ⌘, (optionally straight to a pane). */
export function openSettings(pane?: SettingsPane, profileId?: string | null) {
  if (pane) useSettingsNav.getState().go(pane, profileId ?? null);
  if (hasWindowHost) void openWindow(SETTINGS_WINDOW_ID, { kind: "settings", title: "Settings" });
}

/** "Import from Another Browser…" (app menu, Settings, the empty bookmarks bar). */
export function openImport() {
  if (hasWindowHost) void openWindow(IMPORT_WINDOW_ID, { kind: "import", title: "Import from Another Browser" });
}
