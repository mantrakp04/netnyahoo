import { requireNativeModule, type EventSubscription } from "expo-modules-core";
import type { ContentBlockerState, ContentBlockerStats } from "./contentBlocker";
import type { DisplayMediaSource } from "./WebView";
import type { ExternalAppAllowance } from "./externalApps";
import type { FaviconImage } from "./favicons";
import type { BrowsingDataType, Download, EngineComponent, EngineInfo, EngineTask, ChromeWindowState, PermissionRequest, PermissionResult, SystemState } from "./module";
import type { PasswordExportStatus, SavedPassword } from "./passwords";
import type { TabStripCommand, TabStripTransaction } from "./tabStrip";
import type { AddressInput, CardInput, SavedAddress, SavedCard } from "./autofill";
import type { ClearSiteDataResult, SiteSettingType, SiteSettingValue, SiteSettings } from "./siteSettings";

export type Result<T> = T | { error: string };

export function valueOr<T extends object, F>(result: Result<T>, fallback: F): T | F {
  if (result && typeof result === "object" && "error" in result) {
    console.warn(`[cef] ${result.error}`);
    return fallback;
  }
  return result as T;
}

export const Cef = requireNativeModule<{
  addListener(name: "onDownload", listener: (d: Download) => void): EventSubscription;
  addListener(name: "onPermission", listener: (p: PermissionRequest) => void): EventSubscription;
  addListener(name: "onPermissionDismissed", listener: (p: { id: string }) => void): EventSubscription;
  addListener(name: "onContentBlocker", listener: (s: ContentBlockerStats) => void): EventSubscription;
  addListener(name: "onSystemState", listener: (s: SystemState) => void): EventSubscription;
  addListener(name: "onEngineEvent", listener: (e: { topic: string; payload: string }) => void): EventSubscription;

  engineInfo(): Promise<EngineInfo>;
  chromeWindows(): Promise<ChromeWindowState[]>;
  prepareTransfer(key: string): void;
  releaseTransfer(key: string): void;
  addListener(name: "onTabStrip", listener: (tx: TabStripTransaction) => void): EventSubscription;
  tabStripCommand(id: number, command: TabStripCommand): Promise<void>;
  tabStrips(): Promise<TabStripTransaction>;
  devWindow(windowNumber: number, action: string): Promise<string>;
  components(): Promise<EngineComponent[]>;
  beginTracing(): Promise<boolean>;
  endTracing(keep: boolean): Promise<string | null>;
  isTracing(): Promise<boolean>;
  setDisplayMediaPicker(enabled: boolean): Promise<void>;
  setAutoPictureInPicture?(enabled: boolean): Promise<void>;
  setSearchEngineName(name: string): Promise<void>;
  displayMediaSources(): Promise<DisplayMediaSource[]>;
  listTasks(): Promise<EngineTask[]>;
  killTask(id: number): Promise<boolean>;
  systemState(): Promise<SystemState>;

  cancelDownload(id: string): Promise<void>;
  pauseDownload(id: string): Promise<void>;
  resumeDownload(id: string): Promise<void>;
  resolvePermission(id: string, result: PermissionResult, remember?: boolean): Promise<void>;
  resolveExternalApp(id: string, open: boolean, remember: boolean): Promise<void>;
  getExternalAppAllowances(profile: string): Promise<ExternalAppAllowance[]>;
  removeExternalAppAllowance(profile: string, origin: string, scheme: string): Promise<void>;
  clearBrowsingData(profile: string, types: BrowsingDataType[], since: number | null): Promise<void>;
  fetchFavicon(url: string, profile: string): Promise<FaviconImage | null>;
  removeLegacyFavicons(profile: string): Promise<void>;
  engineCall(name: string, profile: string, args: string | null): Promise<string>;
  releaseProfile(profile: string): Promise<void>;
  deleteProfileData(profile: string): Promise<{ remaining: string[] }>;

  getContentBlocker(): Promise<ContentBlockerState>;
  setContentBlockerEnabled(enabled: boolean): Promise<void>;
  setFilterListEnabled(id: string, enabled: boolean): Promise<void>;
  isContentBlockerAllowed(host: string): Promise<boolean>;
  setContentBlockerAllowed(host: string, allowed: boolean): Promise<void>;

  setSiteSetting(profile: string, origin: string, type: SiteSettingType, value: SiteSettingValue): Promise<void>;
  getSiteSettings(profile: string, origin: string): Promise<SiteSettings>;
  getSiteSettingsOrigins(profile: string): Promise<string[]>;
  resetSiteSettings(profile: string, origin: string): Promise<void>;
  clearSiteData(profile: string, origin: string): Promise<ClearSiteDataResult>;

  setZoom(profile: string, host: string, zoom: number): Promise<void>;
  getZoomLevels(profile: string): Promise<Record<string, number>>;

  listPasswords(profile: string): Promise<Result<{ passwords: SavedPassword[] }>>;
  unlockPasswords(profile: string): Promise<Result<{ unlocked: boolean }>>;
  getPassword(profile: string, origin: string, username: string): Promise<Result<{ password: string | null }>>;
  savePassword(profile: string, origin: string, username: string, password: string): Promise<Result<{ ok: true }>>;
  updatePassword(
    profile: string,
    origin: string,
    username: string,
    newUsername: string | null,
    newPassword: string | null,
  ): Promise<Result<{ ok: true }>>;
  deletePassword(profile: string, origin: string, username: string): Promise<Result<{ ok: true }>>;
  getNeverSavePasswordOrigins(profile: string): Promise<Result<{ origins: string[] }>>;
  allowSavingPasswords(profile: string, origin: string): Promise<Result<{ ok: true }>>;
  exportPasswords(profile: string): Promise<Result<{ status: PasswordExportStatus; path?: string }>>;
  getPasswordAutofill(profile: string): Promise<boolean>;
  setPasswordAutofill(profile: string, enabled: boolean): Promise<void>;

  getAutofillSettings(profile: string): Promise<{ addresses: boolean; cards: boolean }>;
  setAutofillSettings(profile: string, addresses: boolean | null, cards: boolean | null): Promise<void>;
  listAddresses(profile: string): Promise<Result<{ addresses: SavedAddress[] }>>;
  saveAddress(profile: string, address: AddressInput): Promise<Result<{ id: string }>>;
  listCards(profile: string): Promise<Result<{ cards: SavedCard[] }>>;
  saveCard(profile: string, card: CardInput, number: string | null): Promise<Result<{ id: string }>>;
  deleteAutofillEntry(profile: string, id: string): Promise<Result<{ ok: true }>>;
  revealCardNumber(profile: string, id: string): Promise<Result<{ number?: string | null }>>;
}>("NetnyahooCEF");
