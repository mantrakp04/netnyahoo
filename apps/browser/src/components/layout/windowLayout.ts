import { create } from "zustand";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";

/** The window's tab layout: sidebar or top strip (⇧⌘S); unset windows follow Settings. */
export function useTabLayout(): "sidebar" | "top" {
  const windowId = useWindowId();
  return useBrowser((s) => s.windows[windowId]?.tabLayout ?? s.settings.tabLayout);
}

/**
 * Where the focused pane's URL field is, in window coordinates, so the command
 * panel (⌘L / URL click) can open over it in any layout or split. `left` is
 * where the URL pill starts; `width` the pill's width.
 */
export type UrlAnchor = { left: number; top: number; width: number };

export const useUrlAnchors = create<Record<string, UrlAnchor>>()(() => ({}));

export function setUrlAnchor(windowId: string, anchor: UrlAnchor) {
  const current = useUrlAnchors.getState()[windowId];
  if (current && current.left === anchor.left && current.top === anchor.top && current.width === anchor.width) return;
  useUrlAnchors.setState({ [windowId]: anchor });
}

export const useUrlAnchor = (windowId: string): UrlAnchor | undefined => useUrlAnchors((s) => s[windowId]);
