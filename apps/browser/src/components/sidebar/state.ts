import type { View } from "react-native";
import { create } from "zustand";

export type Anchor = { x: number; y: number; width: number; height: number };
export type Target = { kind: "tab" | "group" | "live"; id: string };

type SidebarUi = {
  renaming: (Target & { windowId: string }) | null;
  iconPicker: (Target & { windowId: string; anchor: Anchor | null }) | null;
  hover: (Target & { windowId: string; anchor: Anchor }) | null;
  searchTabs: string | null;
  switcher: { windowId: string; ids: string[]; index: number; visible: boolean } | null;
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

export function measureRow(windowId: string, id: string): Promise<Anchor | null> {
  const view = rowView(windowId, id);
  if (!view) return Promise.resolve(null);
  return new Promise((resolve) => view.measureInWindow((x, y, width, height) => resolve(width ? { x, y, width, height } : null)));
}
