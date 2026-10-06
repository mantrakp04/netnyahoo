import { create, type StateCreator } from "zustand";
import { createBookmarksSlice, ensureRoots, type BookmarksSlice } from "./bookmarks";
import { changedIds } from "./changes";
import { createGroupsSlice, type GroupsSlice } from "./groups";
import { createHistorySlice, type HistorySlice } from "./history";
import { IDLE_LIVE, isIncognitoProfile, pinnedFirst } from "./model";
import { createOrganizeSlice, forgetClosedPrivateWindows, keptDeletedGroups, type OrganizeSlice } from "./organize";
import { createProfilesSlice, DEFAULT_PROFILE, engineIdOf, type ProfilesSlice } from "./profiles";
import { createSettingsSlice, DEFAULT_SETTINGS, type SettingsSlice } from "./settings";
import { createSplitsSlice, sanitizeSplits, type SplitsSlice } from "./splits";
import { activated, apply, createTabsSlice, type TabsSlice } from "./tabs";
import { transactional } from "./transaction";
import type { BrowserWindow, Tab } from "./types";
import { createUiSlice, type UiSlice } from "./ui";
import { createWindowsSlice, type WindowsSlice } from "./windows";

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
    hydrate(data: HydrateData): void;
  };

export type HydrateData = Partial<
  Pick<
    BrowserState,
    | "profiles"
    | "profileOrder"
    | "orphanedProfileData"
    | "windows"
    | "windowOrder"
    | "tabs"
    | "groups"
    | "splits"
    | "closedTabs"
    | "closedWindows"
    | "parkedPins"
    | "closedGroups"
    | "deletedGroups"
    | "cleanedTabs"
    | "history"
    | "bookmarks"
    | "downloads"
    | "settings"
  >
> & { focusedWindowId?: string | null };

// Batch external updates; React Native otherwise commits once per subscriber.
let batch = (update: () => void) => update();
export function setStoreBatching(batchedUpdates: (update: () => void) => void) {
  batch = batchedUpdates;
}
/** For the app's other stores: their subscribers re-render in one commit. */
export const batchStoreUpdates = (update: () => void) => batch(update);

const batched =
  <T,>(creator: StateCreator<T>): StateCreator<T> =>
  (set, get, api) => {
    const batchedSet = ((...args: Parameters<typeof set>) => batch(() => (set as (...a: typeof args) => void)(...args))) as typeof set;
    api.setState = batchedSet;
    return creator(batchedSet, get, api);
  };

// A tab's address or loading state can flip back within one transaction (a load that starts and ends, a same-document
// A → B → A), which hearing only the end would hide from the listeners that act on the change (translate's language
// detection, the web store's script, a screen-share request going with its page): each such write is heard as it
// lands; a title, an icon, the back and forward state and the rest join the next.
const pageMoved = (s: BrowserState, prev: BrowserState) => {
  if (s.tabs !== prev.tabs) for (const id of changedIds(s.tabs, prev.tabs)) if (s.tabs[id]?.url !== prev.tabs[id]?.url) return true;
  if (s.live !== prev.live) for (const id of changedIds(s.live, prev.live)) if (!!s.live[id]?.isLoading !== !!prev.live[id]?.isLoading) return true;
  return false;
};
const transactions = transactional<BrowserState>(pageMoved);
/**
 * Runs `run` with the store's listeners (and components) hearing its writes once, at the end (store/transaction.ts).
 * For writes that arrive together and mean nothing apart: a flush of a page's reports (lib/nativeEvents.ts).
 */
export const storeTransaction = transactions.transaction;

export const useBrowser = create<BrowserState>()(transactions.middleware(batched((...a) => ({
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
    const tabs: Record<string, Tab> = {};
    for (const t of Object.values(data.tabs ?? {})) {
      if (!rawWindows[t.windowId] || !profileOk(t.profileId)) continue;
      const { adoptId: _, ...rest } = t;
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
    let bookmarks = data.bookmarks ?? s.bookmarks;
    for (const id of profileOrder) bookmarks = ensureRoots(bookmarks, id)[0];
    const focused = data.focusedWindowId && windows[data.focusedWindowId] ? data.focusedWindowId : (windowOrder.at(-1) ?? null);

    const engines = new Set(Object.values(profiles).map(engineIdOf));
    let next: BrowserState = {
      ...s,
      profiles,
      profileOrder,
      orphanedProfileData: (data.orphanedProfileData ?? []).filter((e) => !engines.has(e)),
      settings,
      windows,
      windowOrder,
      tabs,
      live: Object.fromEntries(Object.keys(tabs).map((id) => [id, IDLE_LIVE])),
      groups,
      splits,
      closedTabs: data.closedTabs ?? [],
      closedWindows: data.closedWindows ?? [],
      parkedPins: Object.fromEntries(Object.entries(data.parkedPins ?? {}).filter(([p]) => profiles[p])),
      closedGroups: data.closedGroups ?? [],
      deletedGroups: keptDeletedGroups(data.deletedGroups ?? []),
      // Older builds saved private windows' cleaned tabs; drop them.
      cleanedTabs: (data.cleanedTabs ?? []).filter((c) => !isIncognitoProfile(c.tab.profileId)),
      privateCleanedTabs: {},
      privateSiteMutes: {},
      selection: {},
      history: Object.fromEntries(Object.entries(data.history ?? {}).filter(([p]) => profiles[p])),
      // A view handed in (tests) counts as read; the app's history and bookmarks come from Chrome later
      // (lib/history.ts, lib/bookmarks.ts).
      historyReady: Object.fromEntries(Object.keys(data.history ?? {}).filter((p) => profiles[p]).map((p) => [p, true as const])),
      bookmarks,
      bookmarksReady: Object.fromEntries(Object.keys(data.bookmarks?.roots ?? {}).filter((p) => profiles[p]).map((p) => [p, true as const])),
      downloads: data.downloads ?? [],
      windowUi: {},
      find: {},
      ui: { ...s.ui, focusedWindowId: focused, focusOrder: focused ? [focused, ...windowOrder.filter((id) => id !== focused).reverse()] : [] },
    };
    for (const w of Object.values(windows)) next = apply(next, activated(next, w.activeTabIds[w.profileId]!));
    set(next);
  },
}))));

useBrowser.subscribe((s, prev) => {
  const patch = s.windows !== prev.windows && forgetClosedPrivateWindows(s);
  if (patch) useBrowser.setState(patch);
});

export type { CreateWindowOptions } from "./windows";
