import { Cef } from "./native";

/**
 * Chrome-style per-host zoom (1 = 100%): every tab showing the host follows,
 * new tabs on the host open at its level, and levels persist per profile.
 * Tabs report changes (menu, ⌘-scroll, other tabs) through `onZoom`.
 */
export const setZoom = (profile: string, host: string, zoom: number) => Cef.setZoom(profile, host, zoom);
/** Hosts with a non-default zoom: { host: zoom }. */
export const getZoomLevels = (profile: string) => Cef.getZoomLevels(profile);
