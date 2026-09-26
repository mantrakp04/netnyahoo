import { Cef } from "./native";

export type SiteSettingType =
  | "popups" | "camera" | "microphone" | "location" | "notifications" | "sound" | "autoplay" | "javascript"
  | "images" | "clipboard" | "automaticDownloads" | "cookies" | "midi" | "sensors" | "windowManagement"
  | "localFonts" | "idleDetection" | "storageAccess" | "fileSystem" | "keyboardLock" | "pointerLock"
  | "cameraPanTiltZoom";

/** "default" = no site-specific value (reading returns the effective value instead). */
export type SiteSettingValue = "allow" | "block" | "ask" | "default";

export type SiteSettings = Record<SiteSettingType, { value: SiteSettingValue; isDefault: boolean }>;
export type ClearSiteDataResult = { cookies: number | false; storage: boolean };

/**
 * Per-origin content settings (`origin` like "https://example.com"; `profile` "" = default).
 * Values set here and remembered permission decisions persist per profile
 * (incognito: in memory). "sound: block" mutes the site's tabs; "popups: allow"
 * lets it open windows without a click.
 */
export const setSiteSetting = (profile: string, origin: string, type: SiteSettingType, value: SiteSettingValue) =>
  Cef.setSiteSetting(profile, origin, type, value);
/** Every setting's effective value for an origin (for a site-controls popover). */
export const getSiteSettings = (profile: string, origin: string) => Cef.getSiteSettings(profile, origin);
/** Origins with site-specific values (for a settings pane). */
export const getSiteSettingsOrigins = (profile: string) => Cef.getSiteSettingsOrigins(profile);
/** Removes every site-specific value for an origin. */
export const resetSiteSettings = (profile: string, origin: string) => Cef.resetSiteSettings(profile, origin);
/** Clears cookies and all storage (local/session storage, IndexedDB, cache storage, service workers) for an origin. */
export const clearSiteData = (profile: string, origin: string) => Cef.clearSiteData(profile, origin);
