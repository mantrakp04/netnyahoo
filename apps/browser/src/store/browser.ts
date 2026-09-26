import { create, type StateCreator } from "zustand";
import { createBookmarksSlice, ensureRoots, type BookmarksSlice } from "./bookmarks";
import { createGroupsSlice, type GroupsSlice } from "./groups";
import { createHistorySlice, type HistorySlice } from "./history";
import { IDLE_LIVE, isIncognitoProfile, pinnedFirst } from "./model";
import { createOrganizeSlice, type OrganizeSlice } from "./organize";
import { createProfilesSlice, DEFAULT_PROFILE, type ProfilesSlice } from "./profiles";
import { createSettingsSlice, DEFAULT_SETTINGS, type SettingsSlice } from "./settings";
import { createSplitsSlice, sanitizeSplits, type SplitsSlice } from "./splits";
import { activated, apply, createTabsSlice, type TabsSlice } from "./tabs";
import type { BrowserWindow, Tab } from "./types";
import { createUiSlice, type UiSlice } from "./ui";
import { createWindowsSlice, type WindowsSlice } from "./windows";

/**
 * The whole app's state, in one zustand store shared by every window (all
 * windows run in one JS runtime). Slices live in their own files; actions take
 * explicit ids — per-window convenience hooks are in ./hooks.
 */
export type BrowserState = ProfilesSlice &
  WindowsSlice &
  TabsSlice &
  GroupsSlice &
  OrganizeSlice &
  SplitsSlice &
  HistorySlice &
  BookmarksSlice &
  SettingsSlice &
  UiSlice & {
    /** Loads a saved session (lib/persist) and repairs anything inconsistent. */
    hydrate(data: HydrateData): void;
  };

export type HydrateData = Partial<
  Pick<
    BrowserState,
    | "profiles"
    | "profileOrder"
    | "windows"
    | "windowOrder"
    | "tabs"
    | "groups"
    | "splits"
    | "closedTabs"
    | "closedWindows"
    | "closedGroups"
    | "cleanedTabs"
    | "history"
    | "bookmarks"
    | "downloads"
    | "settings"
  >
> & { focusedWindowId?: string | null };

/**
 * How an update reaches React. The app passes React Native's unstable_batchedUpdates (index.js), so
 * one update re-renders every component it changes in a single commit. Without it, an update from
 * outside a React event handler (a native event, a timer, an animation ending) commits once per
 * subscribed component: a profile switch made over a hundred commits.
 */
let batch = (update: () => void) => update();
export function setStoreBatching(batchedUpdates: (update: () => void) => void) {
  batch = batchedUpdates;
}

const batched =
  <T,>(creator: StateCreator<T>): StateCreator<T> =>
  (set, get, api) => {
    const batchedSet = ((...args: Parameters<typeof set>) => batch(() => (set as (...a: typeof args) => void)(...args))) as typeof set;
    api.setState = batchedSet;
    return creator(batchedSet, get, api);
  };

export const useBrowser = create<BrowserState>()(batched((...a) => ({
  ...createProfilesSlice(...a),
  ...createWindowsSlice(...a),
  ...createTabsSlice(...a),
  ...createGroupsSlice(...a),
  ...createOrganizeSlice(...a),
  ...createSplitsSlice(...a),
  ...createHistorySlice(...a),
  ...createBookmarksSlice(...a),
  ...createSettingsSlice(...a),
  ...createUiSlice(...a),

  hydrate(data) {
    const [set, get] = a;
    const s = get();
    const profiles = data.profiles && Object.keys(data.profiles).length ? data.profiles : { [DEFAULT_PROFILE.id]: DEFAULT_PROFILE };
    const profileOrder = [
      ...(data.profileOrder ?? []).filter((id) => profiles[id]),
      ...Object.keys(profiles).filter((id) => !data.profileOrder?.includes(id)),
    ];
    const settings = { ...DEFAULT_SETTINGS, ...data.settings };
    if (!profiles[settings.defaultProfileId]) settings.defaultProfileId = profileOrder[0]!;

    const rawWindows = data.windows ?? {};
    const profileOk = (p: string) => !!profiles[p] || isIncognitoProfile(p);
    // Restored tabs load when first selected; adopted popups don't survive a relaunch.
    const tabs: Record<string, Tab> = {};
    for (const t of Object.values(data.tabs ?? {})) {
      if (!rawWindows[t.windowId] || !profileOk(t.profileId)) continue;
      const { adoptId: _, ...rest } = t;
      // Pinned tabs from before base URLs existed pin their current page.
      tabs[t.id] = { ...rest, navigation: null, pinnedUrl: rest.pinnedUrl ?? (rest.pinned ? rest.url || null : null) };
    }
    const windows: Record<string, BrowserWindow> = {};
    for (const w of Object.values(rawWindows)) {
      const tabIds = pinnedFirst(w.tabIds.filter((id) => tabs[id]?.windowId === w.id), tabs);
      if (!tabIds.length) continue;
      const activeTabIds = Object.fromEntries(Object.entries(w.activeTabIds).filter(([p, id]) => tabs[id]?.profileId === p));
      const profileId = tabIds.some((id) => tabs[id]!.profileId === w.profileId) ? w.profileId : tabs[tabIds[0]!]!.profileId;
      activeTabIds[profileId] ??= tabIds.find((id) => tabs[id]!.profileId === profileId)!;
      windows[w.id] = { ...w, tabIds, profileId, activeTabIds };
    }
    for (const t of Object.values(tabs)) if (!windows[t.windowId]) delete tabs[t.id];
    const windowOrder = [...(data.windowOrder ?? []).filter((id) => windows[id]), ...Object.keys(windows).filter((id) => !data.windowOrder?.includes(id))];
    const inWindow = (id: string, windowId: string) => tabs[id]?.windowId === windowId;
    const groups = Object.fromEntries(
      Object.values(data.groups ?? {})
        .map((g) => ({ ...g, tabIds: g.tabIds.filter((id) => inWindow(id, g.windowId)) }))
        .filter((g) => g.tabIds.length)
        .map((g) => [g.id, g]),
    );
    const splits = sanitizeSplits(data.splits ?? {}, tabs);
    // Every profile has its Bookmarks Bar / Other Bookmarks roots (the menus list them).
    let bookmarks = data.bookmarks ?? s.bookmarks;
    for (const id of profileOrder) bookmarks = ensureRoots(bookmarks, id)[0];
    const focused = data.focusedWindowId && windows[data.focusedWindowId] ? data.focusedWindowId : (windowOrder.at(-1) ?? null);

    let next: BrowserState = {
      ...s,
      profiles,
      profileOrder,
      settings,
      windows,
      windowOrder,
      tabs,
      live: Object.fromEntries(Object.keys(tabs).map((id) => [id, IDLE_LIVE])),
      groups,
      splits,
      closedTabs: data.closedTabs ?? [],
      closedWindows: data.closedWindows ?? [],
      closedGroups: data.closedGroups ?? [],
      cleanedTabs: data.cleanedTabs ?? [],
      selection: {},
      history: Object.fromEntries(Object.entries(data.history ?? {}).filter(([p]) => profiles[p])),
      bookmarks,
      downloads: data.downloads ?? [],
      windowUi: {},
      find: {},
      ui: { ...s.ui, focusedWindowId: focused, focusOrder: focused ? [focused, ...windowOrder.filter((id) => id !== focused).reverse()] : [] },
    };
    // Each window's selected tab loads right away; the rest wait until selected.
    for (const w of Object.values(windows)) next = apply(next, activated(next, w.activeTabIds[w.profileId]!));
    set(next);
  },
})));

export type { CreateWindowOptions } from "./windows";
