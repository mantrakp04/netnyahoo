import { Cef } from "./native";

/**
 * Dia's categories (ad lists, trackers, cookie banners, regional lists) plus uBlock Origin
 * Lite's other annoyance lists and its malware lists (on by default).
 */
export type FilterListCategory = "ads" | "trackers" | "cookies" | "regional" | "annoyances" | "security";

/** One of uBlock Origin Lite's rulesets. */
export type FilterList = {
  /** "ublock-filters", "easylist", "easyprivacy", "annoyances-cookies", "deu-0"… */
  id: string;
  title: string;
  category: FilterListCategory;
  enabled: boolean;
  /** On in uBOL's defaults (every list ships with it; the rest are opt-in). */
  defaultOn: boolean;
  /** Filters of this list uBOL uses (its network rules pack many into one). */
  filters: number;
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
  /**
   * The bundled uBlock Origin Lite's version. Its lists are the ones it shipped with: they
   * change when the app ships a newer one (built-in extensions don't update themselves).
   */
  version: string;
  lists: FilterList[];
  /** Hosts where blocking is off ("disable on this site"); subdomains included. */
  allowedHosts: string[];
  stats: ContentBlockerStats;
};


/** How a request would be treated (the engine's `checkContentBlocking`, for debugging). */
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
/** Fires when the blocker's settings change, with fresh stats. */
export const onContentBlockerChange = (listener: (stats: ContentBlockerStats) => void) =>
  Cef.addListener("onContentBlocker", listener);
