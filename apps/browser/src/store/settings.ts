import {
  allEngines,
  BUILT_IN_ENGINES,
  controllingExtensionEngine,
  engineById,
  extensionEngineId,
  makeCustomEngine,
  validateEngine,
  type CustomSearchEngine,
  type EngineInput,
  type ExtensionSearchEngine,
  type SearchEngine,
} from "@netnyahoo/core";
import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";

/** The built-in search engines by id (`%s` = query). The full list with custom ones: `searchEngines()`. */
export const SEARCH_ENGINES: Record<string, { name: string; url: string }> = Object.fromEntries(
  BUILT_IN_ENGINES.map((e) => [e.id, { name: e.name, url: e.url }]),
);

/** A built-in engine id ("google", "duckduckgo"…), a custom engine's id, or legacy "custom" (customSearchUrl). */
export type SearchEngineId = string;

/**
 * User preferences, grouped like Dia's Settings panes (General / Tabs /
 * Appearance / Profiles). Everything here persists.
 */
export type Settings = {
  // General
  warnBeforeQuitting: boolean;
  /** ⇧⌘W / the close button ask first when the window has more than one tab. */
  warnBeforeClosingWindow: boolean;
  /** "Preserve tabs and windows" on relaunch vs. start fresh. */
  restoreSession: boolean;
  searchEngine: SearchEngineId;
  /** Used when searchEngine is "custom"; `%s` is replaced by the query. */
  customSearchUrl: string;
  /** User-added engines (name, Tab-to-search keyword, URL with `%s`); see addCustomEngine. */
  customSearchEngines: CustomSearchEngine[];
  /**
   * Engines extensions add, per engine profile, as Chrome last reported them
   * (components/extensions/searchEngines). Kept so an extension's engine is there from launch.
   */
  extensionSearchEngines: ExtensionSearchEngine[];
  /** Show the search engine's suggestions in the command bar. */
  searchSuggestions: boolean;
  /**
   * Command bar routing: "website" (Use Website First) makes the best matching site the top hit
   * and completes it inline; "search" (Prefer Search Engine) searches unless you typed an address.
   */
  commandBarPreference: "website" | "search";

  // Tabs
  tabLayout: "sidebar" | "top";
  newTabPosition: "top" | "bottom";
  warnBeforeClosingLastTab: boolean;
  /** Dia asks before moving tabs between profiles (some site data doesn't come along). */
  warnBeforeMovingTabsToProfile: boolean;
  tabReorderHaptics: boolean;
  /** Extend the page's theme colour into the tab bar. */
  extendWebsiteColor: boolean;
  cmdClickCreatesTabGroup: boolean;
  /** ⌥⇧-clicking a tab in the sidebar / top strip groups it with the current tab and selects it. */
  optShiftClickOpensInGroup: boolean;
  autoGroupMeetingTabs: boolean;
  /** Archive tabs untouched for this long; null = never. */
  cleanUpInactiveTabsAfterHours: number | null;
  /** Hosts muted with Mute Site (their tabs stay muted, including new ones). */
  mutedSites: string[];
  /** A playing video pops out into Picture in Picture when you switch away from it (Dia's auto-PiP). */
  autoPictureInPicture: boolean;
  /** The sidebar's width, dragged at its edge. */
  sidebarWidth: number;
  /** On battery or in Low Power Mode, freeze CPU-heavy background tabs (lib/tabLifecycle). */
  batterySaver: boolean;
  /** An extension side panel's width, dragged at its edge (Dia's extensionSidePanelPreferredWidth). */
  extensionSidePanelWidth: number;

  // View
  showFullUrl: boolean;
  bookmarksBar: "always" | "newTab" | "never";
  /** The empty bookmarks bar's "Import bookmarks" button was hidden from its menu. */
  hideBookmarksBarImport: boolean;

  // Appearance
  appearance: "auto" | "light" | "dark";
  /** Where the address bar and back / forward / reload sit: the page's toolbar, or the sidebar's top (Arc). */
  addressBar: "toolbar" | "sidebar";

  // Profiles
  defaultProfileId: string;

  // Keyboard Shortcuts
  /** Remapped menu shortcuts: menu item key → [key, ...modifiers] (key "" = no shortcut). */
  shortcuts: Record<string, string[]>;
};

export const DEFAULT_PROFILE_ID = "default";

export const DEFAULT_SETTINGS: Settings = {
  warnBeforeQuitting: false,
  warnBeforeClosingWindow: true,
  restoreSession: true,
  searchEngine: "google",
  customSearchUrl: "",
  customSearchEngines: [],
  extensionSearchEngines: [],
  searchSuggestions: true,
  commandBarPreference: "website",
  tabLayout: "sidebar",
  newTabPosition: "bottom",
  warnBeforeClosingLastTab: true,
  warnBeforeMovingTabsToProfile: true,
  tabReorderHaptics: true,
  extendWebsiteColor: true,
  // Dia 1.16: ⌘-clicking a link opens it in a tab group with its opener.
  cmdClickCreatesTabGroup: true,
  optShiftClickOpensInGroup: true,
  autoGroupMeetingTabs: true,
  cleanUpInactiveTabsAfterHours: null,
  mutedSites: [],
  autoPictureInPicture: true,
  sidebarWidth: 190,
  batterySaver: true,
  extensionSidePanelWidth: 360,
  showFullUrl: false,
  bookmarksBar: "never",
  hideBookmarksBarImport: false,
  appearance: "auto",
  addressBar: "toolbar",
  defaultProfileId: DEFAULT_PROFILE_ID,
  shortcuts: {},
};

const NO_CUSTOM_ENGINES: CustomSearchEngine[] = [];
const NO_EXTENSION_ENGINES: ExtensionSearchEngine[] = [];
const engineCache = new WeakMap<
  CustomSearchEngine[],
  { legacyUrl: string; extension: ExtensionSearchEngine[]; engines: SearchEngine[] }
>();

/**
 * Every engine the user can pick: built-ins, the user's own, then the ones extensions add.
 * A legacy single custom URL (`searchEngine: "custom"` + customSearchUrl) shows up as "Custom".
 */
export function searchEngines(settings: Settings): SearchEngine[] {
  // Memoised so selectors get a stable array (and a stable default engine object).
  const custom = settings.customSearchEngines ?? NO_CUSTOM_ENGINES;
  const extension = settings.extensionSearchEngines ?? NO_EXTENSION_ENGINES;
  const cached = engineCache.get(custom);
  if (cached && cached.legacyUrl === settings.customSearchUrl && cached.extension === extension) return cached.engines;
  const engines = allEngines(custom, extension);
  if (settings.customSearchUrl?.includes("%s")) {
    const at = engines.findIndex((e) => e.extension);
    engines.splice(at < 0 ? engines.length : at, 0, { id: "custom", name: "Custom", keyword: "custom", url: settings.customSearchUrl, custom: true });
  }
  engineCache.set(custom, { legacyUrl: settings.customSearchUrl, extension, engines });
  return engines;
}

/**
 * The extension that controls the default search engine, like Chrome: one that asked to be the
 * default (`is_default`) wins over the user's choice until it's disabled or removed.
 */
export function controllingSearchExtension(settings: Settings): ExtensionSearchEngine | undefined {
  return controllingExtensionEngine(settings.extensionSearchEngines ?? NO_EXTENSION_ENGINES);
}

/** The engine the command bar searches with (Google if the chosen one is gone). */
export function defaultSearchEngine(settings: Settings): SearchEngine {
  const controlling = controllingSearchExtension(settings);
  return engineById(searchEngines(settings), controlling ? extensionEngineId(controlling.extensionId) : settings.searchEngine);
}

/**
 * The default engine's search URL template (`…?q=%s`). Pass it to core's `resolveInput`, which
 * also accepts plain prefixes.
 */
export function searchUrlPrefix(settings: Settings): string {
  return defaultSearchEngine(settings).url;
}

/** Why `input` can't be saved as a custom engine, or null (`ignoreId`: the engine being edited). */
export function validateCustomEngine(settings: Settings, input: EngineInput, ignoreId?: string): string | null {
  return validateEngine(input, searchEngines(settings), ignoreId);
}

export type SettingsSlice = {
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  /** Makes an engine (built-in or custom id) the default. */
  setSearchEngine(id: string): void;
  /** Adds a custom engine after validating it; returns its id, or the validation error. */
  addCustomEngine(input: EngineInput): { id: string } | { error: string };
  /** Edits a custom engine; returns the validation error, or null when saved. */
  updateCustomEngine(id: string, input: EngineInput): string | null;
  /** Removes a custom engine; if it was the default, Google takes over. */
  removeCustomEngine(id: string): void;
};

let engineCounter = 0;
const newEngineId = () => `engine-${Date.now().toString(36)}-${(++engineCounter).toString(36)}`;

export const createSettingsSlice: StateCreator<BrowserState, [], [], SettingsSlice> = (set, get) => ({
  settings: DEFAULT_SETTINGS,
  updateSettings(patch) {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
  },

  setSearchEngine(id) {
    if (searchEngines(get().settings).some((e) => e.id === id)) get().updateSettings({ searchEngine: id });
  },

  addCustomEngine(input) {
    const { settings } = get();
    const error = validateCustomEngine(settings, input);
    if (error) return { error };
    const engine = makeCustomEngine(input, newEngineId());
    get().updateSettings({ customSearchEngines: [...settings.customSearchEngines, engine] });
    return { id: engine.id };
  },

  updateCustomEngine(id, input) {
    const { settings } = get();
    if (!settings.customSearchEngines.some((e) => e.id === id)) return "This search engine no longer exists.";
    const error = validateCustomEngine(settings, input, id);
    if (error) return error;
    get().updateSettings({ customSearchEngines: settings.customSearchEngines.map((e) => (e.id === id ? makeCustomEngine(input, id) : e)) });
    return null;
  },

  removeCustomEngine(id) {
    const { settings } = get();
    get().updateSettings({
      customSearchEngines: settings.customSearchEngines.filter((e) => e.id !== id),
      ...(settings.searchEngine === id ? { searchEngine: DEFAULT_SETTINGS.searchEngine } : {}),
    });
  },
});
