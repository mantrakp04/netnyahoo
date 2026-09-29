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

/**
 * Settings › Appearance › Sidebar Style "Liquid Glass" (Arc's look): the sidebar is Liquid Glass over
 * the desktop, the page sits flush beside it, and the sidebar's header and divider are Arc's. It's a
 * sidebar style: with tabs along the top the window keeps Dia's look.
 */
export function glassSidebar(s: BrowserState, windowId: string): boolean {
  const w = s.windows[windowId];
  return !!w && s.settings.sidebarStyle === "glass" && (w.tabLayout ?? s.settings.tabLayout) === "sidebar";
}

export function useGlassSidebar(): boolean {
  const windowId = useWindowId();
  return useBrowser((s) => glassSidebar(s, windowId));
}

/**
 * The sidebar's URL field. Arc puts its top 21.5 pt under the traffic lights' centre (ours are at
 * 26.75, Dia's), so 48; it's as tall as a Dia tab row. The dropdown (CommandPanel) opens from its top-left.
 */
export const SIDEBAR_FIELD = { top: 48, height: layout.rowHeight, radius: 10 } as const;
/**
 * Downloads in the sidebar footer (address bar in the sidebar): Dia's 34 pt button at the footer's
 * leading end, centred on its space-switcher band (the footer is 41 pt, the band 28 above its bottom 3).
 */
export const SIDEBAR_FOOTER_DOWNLOADS = { bottom: 3 + (28 - 34) / 2, size: 34 } as const;
/**
 * The gap over the sidebar's first tile or row: Dia's 8 under its header; under the URL field, the tiles'
 * own 6, so the field, the tiles and the rows sit evenly apart.
 */
export function listTopGap(addressBar: boolean): number {
  return addressBar ? 6 : layout.pinnedTop - layout.sidebarHeader;
}

/** The sidebar header with the URL field in it: the list starts under the field. */
export const SIDEBAR_HEADER_WITH_FIELD = SIDEBAR_FIELD.top + SIDEBAR_FIELD.height;

/**
 * Liquid Glass: the traffic lights' centre in the reference (Arc's spot: 17.5 pt in, 17.8 down; Dia's
 * is 26.75 both ways), set natively per window (shell setTrafficLights). The header's buttons share
 * its line.
 */
export const GLASS_LIGHTS = { x: 17.5, y: 17.8 } as const;
/** Liquid Glass: the reference's header, 8 pt (the tiles' margin) over its tiles' top, 42 pt down. */
const GLASS_HEADER = 34;

/**
 * The sidebar's header: its height (the list starts under it) and, with the URL field in it, the
 * field's top, 21.25 pt under the traffic lights' centre in either style.
 */
export function sidebarHeader(glass: boolean, addressBar: boolean): { height: number; fieldTop: number } {
  if (!glass) return { height: addressBar ? SIDEBAR_HEADER_WITH_FIELD : layout.sidebarHeader, fieldTop: SIDEBAR_FIELD.top };
  const fieldTop = SIDEBAR_FIELD.top - 26.75 + GLASS_LIGHTS.y;
  return { height: addressBar ? fieldTop + SIDEBAR_FIELD.height : GLASS_HEADER, fieldTop };
}

export function useSidebarHeader(): { height: number; fieldTop: number } {
  return sidebarHeader(useGlassSidebar(), useAddressBarInSidebar());
}

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
