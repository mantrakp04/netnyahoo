import { Cef } from "./native";

/**
 * Chrome-style per-host zoom (1 = 100%): every tab showing the host follows,
 * new tabs on the host open at its level, and levels persist per profile.
 * Tabs report changes (menu, ⌘-scroll, other tabs) through `onZoom`.
 */
export const getZoom = (profile: string, host: string) => Cef.getZoom(profile, host);
export const setZoom = (profile: string, host: string, zoom: number) => Cef.setZoom(profile, host, zoom);
/** Hosts with a non-default zoom: { host: zoom }. */
export const getZoomLevels = (profile: string) => Cef.getZoomLevels(profile);
/** Chrome's zoom steps (⌘+ / ⌘- walk this ladder via `WebViewHandle.zoomStep`). */
export const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const;
