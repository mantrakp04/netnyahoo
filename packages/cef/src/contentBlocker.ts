import { Cef } from "./native";

/**
 * Dia's categories: generic ad lists, tracker lists, cookie banners, regional variants;
 * plus uBlock Origin Lite's other annoyance lists and its malware lists (on by default).
 */
export type FilterListCategory = "ads" | "trackers" | "cookies" | "regional" | "annoyances" | "security";

/** One of uBlock Origin Lite's rulesets. */
export type FilterList = {
  /** "ublock-filters", "easylist", "easyprivacy", "annoyances-cookies", "deu-0"… */
  id: string;
  title: string;
  category: FilterListCategory;
  enabled: boolean;
  /** On by default (every list ships with the extension). */
  bundled: boolean;
  /** Network rules of this list while enabled (0 when off). */
  rules: number;
  /** Lists update with the extension: always null. */
  lastModified: number | null;
};

export type ContentBlockerStats = {
  ready: boolean;
  enabled: boolean;
  networkFilters?: number;
  cosmeticFilters?: number;
  unsupportedFilters?: number;
  /** Time to parse and index the enabled lists (off the main thread). */
  parseMs: number;
  lookups: number;
  averageLookupMicros: number;
  maxLookupMicros: number;
};

export type ContentBlockerState = {
  enabled: boolean;
  lists: FilterList[];
  /** Hosts where blocking is off ("disable on this site"); subdomains included. */
  allowedHosts: string[];
  stats: ContentBlockerStats;
};

export type FilterListUpdate = { updated: string[]; failed: string[] };
export type BlockingCheck = { blocked: boolean; filter: string | null; thirdParty: boolean; allowedSite: boolean };

/**
 * The built-in ad/tracker blocker is uBlock Origin Lite (declarativeNetRequest),
 * bundled with the app and loaded in every profile; these drive the default
 * profile's copy, like its own settings page. On by default.
 */
export const getContentBlocker = () => Cef.getContentBlocker();
export const setContentBlockerEnabled = (enabled: boolean) => Cef.setContentBlockerEnabled(enabled);
/** Turns a list on/off ("Block cookie banners" = "easylist-cookie"); rebuilds in the background. */
export const setFilterListEnabled = (id: string, enabled: boolean) => Cef.setFilterListEnabled(id, enabled);
/** Whether blocking is off for this host (per-site toggle). */
export const isContentBlockerAllowed = (host: string) => Cef.isContentBlockerAllowed(host);
/** Per-site toggle. Takes effect for new requests; reload the tab to re-show hidden elements. */
export const setContentBlockerAllowed = (host: string, allowed: boolean) => Cef.setContentBlockerAllowed(host, allowed);
/** Lists ship with (and update with) the bundled extension: nothing to fetch. */
export const updateFilterLists = async (): Promise<FilterListUpdate> => ({ updated: [], failed: [] });
/** Debugging: how a request would be treated. `type`: "script" | "image" | "stylesheet" | "xhr" | "subdocument" | "media" | "font" | "popup"… */
export const checkContentBlocking = (url: string, sourceURL: string, type = "other") =>
  Cef.checkContentBlocking(url, sourceURL, type);
/** Fires when the blocker's settings change, with fresh stats. */
export const onContentBlockerChange = (listener: (stats: ContentBlockerStats) => void) =>
  Cef.addListener("onContentBlocker", listener);
