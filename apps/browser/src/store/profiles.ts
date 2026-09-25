import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { bookmarkRoots, ensureRoots, removeBookmarkTree } from "./bookmarks";
import { newId, setSharedDataIds, viewTabIds, without } from "./model";
import { DEFAULT_PROFILE_ID } from "./settings";
import { activated, apply, removeTabs, withNewTab } from "./tabs";
import type { Profile, ProfileColor } from "./types";

export type ProfilesSlice = {
  profiles: Record<string, Profile>;
  /** Display order; ⌃1–⌃9 switch to the first nine. */
  profileOrder: string[];

  /** `shareWith`: a profile whose data the new one shares (Dia's "Share data with another profile"). */
  createProfile(options: { name: string; color?: ProfileColor; icon?: string | null; shareWith?: string | null }): string;
  updateProfile(id: string, patch: Partial<Pick<Profile, "name" | "color" | "icon">>): void;
  /**
   * Removes a profile and everything in it (tabs, history, bookmarks). Data that other
   * profiles share stays. The engine's on-disk data is deleted separately (lib/actions deleteProfile).
   */
  deleteProfile(id: string): void;
  reorderProfiles(ids: string[]): void;
  setDefaultProfile(id: string): void;
};

/** The profile every install starts with; its engine data is Chromium's default context. */
export const DEFAULT_PROFILE: Profile = { id: DEFAULT_PROFILE_ID, name: "Personal", color: "plum", icon: null, createdAt: 0 };

const COLORS: ProfileColor[] = ["blue", "green", "orange", "purple", "red", "yellow", "pink"];

/** A colour no other profile uses yet. */
export const unusedProfileColor = (profiles: Record<string, Profile>): ProfileColor =>
  COLORS.find((c) => !Object.values(profiles).some((p) => p.color === c)) ?? "blue";

// MARK: Shared data
//
// Dia (1.43) lets a new profile share another's data; in its model several profiles
// ("Spaces") sit on one browser profile. Here a sharing profile points at the data's
// id (`dataId`): the engine context resolves through engineProfile(), bookmark roots
// are the same folders, and history lists are kept identical (syncSharedData).

/** The id whose data a profile uses. */
export const dataIdOf = (profile: Profile) => profile.dataId ?? profile.id;

/**
 * Profiles grouped by the data they use, in profile order: one entry per set of
 * profiles that share data (most profiles are alone in theirs).
 */
export function dataGroups(s: Pick<BrowserState, "profiles" | "profileOrder">): { dataId: string; profileIds: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const id of s.profileOrder) {
    const p = s.profiles[id];
    if (!p) continue;
    const key = dataIdOf(p);
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  return [...groups].map(([dataId, profileIds]) => ({ dataId, profileIds }));
}

/** The other profiles that share `id`'s data. */
export function sharingProfiles(s: Pick<BrowserState, "profiles" | "profileOrder">, id: string): string[] {
  const p = s.profiles[id];
  if (!p) return [];
  return s.profileOrder.filter((other) => other !== id && s.profiles[other] && dataIdOf(s.profiles[other]!) === dataIdOf(p));
}

/**
 * Keeps sharing profiles in step after any change: the engine lookup, one set of
 * bookmark roots, and one history list (whichever member's list changed wins).
 * Returns the patch to apply, or null.
 */
function syncSharedData(s: BrowserState, prev: BrowserState): Partial<BrowserState> | null {
  if (s.profiles !== prev.profiles) {
    setSharedDataIds(Object.fromEntries(Object.values(s.profiles).filter((p) => p.dataId).map((p) => [p.id, p.dataId!])));
  }
  if (s.profiles === prev.profiles && s.history === prev.history && s.bookmarks.roots === prev.bookmarks.roots) return null;
  let history = s.history;
  let roots = s.bookmarks.roots;
  for (const { dataId, profileIds } of dataGroups(s)) {
    if (profileIds.length < 2) continue;
    const changed = profileIds.find((id) => s.history[id] !== prev.history[id]);
    const list = s.history[changed ?? profileIds.find((id) => s.history[id]) ?? ""];
    if (list) for (const id of profileIds) if (history[id] !== list) history = { ...history, [id]: list };
    // The data owner's folders, or (once it's deleted) the first member's.
    const shared = roots[dataId] ?? roots[profileIds.find((id) => roots[id]) ?? ""];
    if (shared) for (const id of profileIds) if (roots[id]?.bar !== shared.bar || roots[id]?.other !== shared.other) roots = { ...roots, [id]: shared };
  }
  if (history === s.history && roots === s.bookmarks.roots) return null;
  return { history, bookmarks: roots === s.bookmarks.roots ? s.bookmarks : { ...s.bookmarks, roots } };
}

export const createProfilesSlice: StateCreator<BrowserState, [], [], ProfilesSlice> = (set, get, api) => {
  // Registered before any view subscribes, so the views and persistence see consistent state.
  api.subscribe((s, prev) => {
    const patch = syncSharedData(s, prev);
    if (patch) set(patch);
  });

  return {
    profiles: { [DEFAULT_PROFILE.id]: DEFAULT_PROFILE },
    profileOrder: [DEFAULT_PROFILE.id],

    createProfile({ name, color, icon = null, shareWith }) {
      const s = get();
      const source = shareWith ? s.profiles[shareWith] : undefined;
      const profile: Profile = {
        id: newId("p"),
        name: name.trim() || `Profile ${s.profileOrder.length + 1}`,
        // New profiles get a colour the others don't use yet.
        color: color ?? unusedProfileColor(s.profiles),
        icon,
        createdAt: Date.now(),
        ...(source ? { dataId: dataIdOf(source) } : {}),
      };
      let bookmarks = s.bookmarks;
      let history = s.history;
      if (source) {
        // Same folders and the same history list (syncSharedData keeps them together).
        const [withRoots, roots] = ensureRoots(bookmarks, source.id);
        bookmarks = { ...withRoots, roots: { ...withRoots.roots, [profile.id]: roots } };
        if (s.history[source.id]) history = { ...history, [profile.id]: s.history[source.id]! };
      } else {
        bookmarks = ensureRoots(bookmarks, profile.id)[0];
      }
      set({ profiles: { ...s.profiles, [profile.id]: profile }, profileOrder: [...s.profileOrder, profile.id], bookmarks, history });
      return profile.id;
    },

    updateProfile(id, patch) {
      set((s) => (s.profiles[id] ? { profiles: { ...s.profiles, [id]: { ...s.profiles[id]!, ...patch } } } : {}));
    },

    deleteProfile(id) {
      let s = get();
      if (!s.profiles[id] || s.profileOrder.length <= 1) return;
      const profileOrder = s.profileOrder.filter((p) => p !== id);
      const fallback = s.settings.defaultProfileId === id ? profileOrder[0]! : s.settings.defaultProfileId;
      const settings = s.settings.defaultProfileId === id ? { ...s.settings, defaultProfileId: fallback } : s.settings;
      const shared = sharingProfiles(s, id).length > 0;

      // Windows showing it switch to the fallback profile first, so they don't close with its tabs.
      for (const w of Object.values(s.windows)) {
        if (w.profileId !== id) continue;
        const other = w.tabIds.find((t) => s.tabs[t]?.profileId !== id);
        if (other) s = apply(s, activated(s, w.activeTabIds[s.tabs[other]!.profileId] ?? other));
        else {
          const [next, tab] = withNewTab(s, w.id, { profileId: fallback, background: true });
          s = apply(next, activated(next, tab));
        }
      }
      s = removeTabs(
        s,
        Object.values(s.tabs).filter((t) => t.profileId === id).map((t) => t.id),
        false,
      );
      const windows = { ...s.windows };
      for (const w of Object.values(windows)) {
        if (w.activeTabIds[id]) windows[w.id] = { ...w, activeTabIds: without(w.activeTabIds, [id]) };
      }
      const roots = bookmarkRoots(s.bookmarks, id);
      set({
        ...s,
        windows,
        profiles: without(s.profiles, [id]),
        profileOrder,
        settings,
        history: without(s.history, [id]),
        // Shared bookmarks stay with the profiles that share them.
        bookmarks: roots && !shared ? removeBookmarkTree(s.bookmarks, [roots.bar, roots.other], id) : { ...s.bookmarks, roots: without(s.bookmarks.roots, [id]) },
        groups: Object.fromEntries(Object.entries(s.groups).filter(([, g]) => g.profileId !== id)),
        closedTabs: s.closedTabs.filter((c) => c.tab.profileId !== id),
        closedWindows: s.closedWindows
          .map((c) => ({ ...c, tabs: c.tabs.filter((t) => t.profileId !== id) }))
          .filter((c) => c.tabs.length > 0),
      });
      // Every window must still show something.
      for (const w of Object.values(get().windows)) {
        if (!viewTabIds(get(), w.id).length) get().newTab(w.id);
      }
    },

    reorderProfiles(ids) {
      set((s) => {
        const known = ids.filter((id) => s.profiles[id]);
        return { profileOrder: [...known, ...s.profileOrder.filter((id) => !known.includes(id))] };
      });
    },

    setDefaultProfile(id) {
      set((s) => (s.profiles[id] ? { settings: { ...s.settings, defaultProfileId: id } } : {}));
    },
  };
};
