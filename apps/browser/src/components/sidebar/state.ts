import type { View } from "react-native";
import { create } from "zustand";

/**
 * Transient sidebar UI shared between the sidebar, its window-level overlays
 * (icon picker, hover card, Search Tabs, ⌃Tab switcher) and menu commands.
 * Nothing here persists; tab and group data live in the app store.
 */
export type Anchor = { x: number; y: number; width: number; height: number };
/** "live": a live folder item, id = liveRowKey(folder, item). */
export type Target = { kind: "tab" | "group" | "live"; id: string };

type SidebarUi = {
  renaming: (Target & { windowId: string }) | null;
  iconPicker: (Target & { windowId: string; anchor: Anchor | null }) | null;
  /** Hover card (a tab's title/URL/actions, or a collapsed group's peek). */
  hover: (Target & { windowId: string; anchor: Anchor }) | null;
  /** Window showing Search Tabs (⇧⌘A). */
  searchTabs: string | null;
  switcher: { windowId: string; ids: string[]; index: number; visible: boolean } | null;
  /** Live width while dragging the sidebar edge (the setting is saved on release). */
  dragWidth: Record<string, number>;
};

export const useSidebarUi = create<SidebarUi>()(() => ({
  renaming: null,
  iconPicker: null,
  hover: null,
  searchTabs: null,
  switcher: null,
  dragWidth: {},
}));

export const sidebarUi = () => useSidebarUi.getState();
export const setSidebarUi = (patch: Partial<SidebarUi>) => useSidebarUi.setState(patch);

/**
 * Rendered rows by window, so overlays and menu commands can anchor to them
 * (Change Icon…, the hover card) and the list can scroll one into view.
 */
const rows = new Map<string, Map<string, View>>();

export function registerRow(windowId: string, id: string, view: View | null) {
  let byId = rows.get(windowId);
  if (!byId) rows.set(windowId, (byId = new Map()));
  if (view) byId.set(id, view);
  else byId.delete(id);
}

export function rowView(windowId: string, id: string): View | undefined {
  return rows.get(windowId)?.get(id);
}

/** A row's frame in window coordinates (null if it isn't on screen). */
export function measureRow(windowId: string, id: string): Promise<Anchor | null> {
  const view = rowView(windowId, id);
  if (!view) return Promise.resolve(null);
  return new Promise((resolve) => view.measureInWindow((x, y, width, height) => resolve(width ? { x, y, width, height } : null)));
}
