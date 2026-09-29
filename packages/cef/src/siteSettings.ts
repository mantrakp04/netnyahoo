import { Cef } from "./native";

export type SiteSettingType =
  | "popups" | "camera" | "microphone" | "location" | "notifications" | "sound" | "autoplay" | "javascript"
  | "images" | "clipboard" | "automaticDownloads" | "cookies" | "midi" | "sensors" | "windowManagement"
  | "localFonts" | "idleDetection" | "storageAccess" | "fileSystem" | "keyboardLock" | "pointerLock"
  | "cameraPanTiltZoom";

export type SiteSettingValue = "allow" | "block" | "ask" | "default";

export type SiteSettings = Record<SiteSettingType, { value: SiteSettingValue; isDefault: boolean }>;
export type ClearSiteDataResult = { cookies: number | false; storage: boolean };

export const setSiteSetting = (profile: string, origin: string, type: SiteSettingType, value: SiteSettingValue) =>
  Cef.setSiteSetting(profile, origin, type, value);
export const getSiteSettings = (profile: string, origin: string) => Cef.getSiteSettings(profile, origin);
export const getSiteSettingsOrigins = (profile: string) => Cef.getSiteSettingsOrigins(profile);
export const resetSiteSettings = (profile: string, origin: string) => Cef.resetSiteSettings(profile, origin);
export const clearSiteData = (profile: string, origin: string) => Cef.clearSiteData(profile, origin);
