import { create } from "zustand";
import { layout } from "../../lib/theme";
import { useBrowser, type BrowserState } from "../../store/browser";
import { useWindowId } from "../../store/hooks";

/** The window's tab layout: sidebar or top strip (⇧⌘S); unset windows follow Settings. */
export function useTabLayout(): "sidebar" | "top" {
  const windowId = useWindowId();
  return useBrowser((s) => s.windows[windowId]?.tabLayout ?? s.settings.tabLayout);
}

/**
 * Settings › Appearance › Address Bar "In the sidebar" (Arc's layout): the URL field sits at the
 * top of the sidebar and back / forward / reload in its header, and panes have no toolbar. It needs
 * the sidebar on screen: with tabs along the top or the sidebar hidden (⌘S), the toolbar has them.
 */
export function addressBarInSidebar(s: BrowserState, windowId: string): boolean {
  const w = s.windows[windowId];
  return !!w && s.settings.addressBar === "sidebar" && w.sidebarOpen && (w.tabLayout ?? s.settings.tabLayout) === "sidebar";
}

export function useAddressBarInSidebar(): boolean {
  const windowId = useWindowId();
  return useBrowser((s) => addressBarInSidebar(s, windowId));
}

/** The sidebar's URL field: under the traffic-light row, 33 pt tall (Arc's field; not a Dia row). */
export const SIDEBAR_FIELD = { top: layout.sidebarHeader - 2, height: 33 } as const;
/** The sidebar header with the URL field in it: the list starts under the field. */
export const SIDEBAR_HEADER_WITH_FIELD = SIDEBAR_FIELD.top + SIDEBAR_FIELD.height;

/**
 * Where the focused pane's URL field is, in window coordinates, so the command
 * panel (⌘L / URL click) can open over it in any layout or split. `left` is
 * where the URL pill starts; `width` the pill's width. `sidebar`: it's the
 * sidebar's field (`top` is then the field's top, `height` its height).
 */
export type UrlAnchor = { left: number; top: number; width: number; sidebar?: { height: number } };

export const useUrlAnchors = create<Record<string, UrlAnchor>>()(() => ({}));

export function setUrlAnchor(windowId: string, anchor: UrlAnchor) {
  const current = useUrlAnchors.getState()[windowId];
  if (current && current.left === anchor.left && current.top === anchor.top && current.width === anchor.width && current.sidebar?.height === anchor.sidebar?.height) return;
  useUrlAnchors.setState({ [windowId]: anchor });
}

export const useUrlAnchor = (windowId: string): UrlAnchor | undefined => useUrlAnchors((s) => s[windowId]);
