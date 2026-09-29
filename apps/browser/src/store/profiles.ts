import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { bookmarkRoots, ensureRoots, removeBookmarkTree } from "./bookmarks";
import { newId, setSharedDataIds, viewTabIds, without } from "./model";
import { DEFAULT_PROFILE_ID } from "./settings";
import { activated, apply, removeTabs, withNewTab } from "./tabs";
import type { Profile, ProfileColor } from "./types";

export type ProfilesSlice = {
  profiles: Record<string, Profile>;
  profileOrder: string[];
  // Engine profiles whose data a deleted profile left behind, until it's gone (lib/profileData.ts).
  orphanedProfileData: string[];

  createProfile(options: { name: string; color?: ProfileColor; icon?: string | null; shareWith?: string | null }): string;
  updateProfile(id: string, patch: Partial<Pick<Profile, "name" | "color" | "icon">>): void;
  deleteProfile(id: string): void;
  reorderProfiles(ids: string[]): void;
  setDefaultProfile(id: string): void;
  profileDataDeleted(engineId: string): void;
};

export const DEFAULT_PROFILE: Profile = { id: DEFAULT_PROFILE_ID, name: "Personal", color: "plum", icon: null, createdAt: 0 };

const COLORS: ProfileColor[] = ["blue", "green", "orange", "purple", "red", "yellow", "pink"];

export const unusedProfileColor = (profiles: Record<string, Profile>): ProfileColor =>
  COLORS.find((c) => !Object.values(profiles).some((p) => p.color === c)) ?? "blue";

// MARK: Shared data

export const dataIdOf = (profile: Profile) => profile.dataId ?? profile.id;
// The engine's profile id, as model.engineProfile maps it: the original profile's data is Chrome's default profile.
export const engineIdOf = (profile: Profile) => (dataIdOf(profile) === DEFAULT_PROFILE_ID ? "" : dataIdOf(profile));

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

export function sharingProfiles(s: Pick<BrowserState, "profiles" | "profileOrder">, id: string): string[] {
  const p = s.profiles[id];
  if (!p) return [];
  return s.profileOrder.filter((other) => other !== id && s.profiles[other] && dataIdOf(s.profiles[other]!) === dataIdOf(p));
}

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
    const shared = roots[dataId] ?? roots[profileIds.find((id) => roots[id]) ?? ""];
    if (shared) for (const id of profileIds) if (roots[id]?.bar !== shared.bar || roots[id]?.other !== shared.other) roots = { ...roots, [id]: shared };
  }
  if (history === s.history && roots === s.bookmarks.roots) return null;
  return { history, bookmarks: roots === s.bookmarks.roots ? s.bookmarks : { ...s.bookmarks, roots } };
}

export const createProfilesSlice: StateCreator<BrowserState, [], [], ProfilesSlice> = (set, get, api) => {
  api.subscribe((s, prev) => {
    const patch = syncSharedData(s, prev);
    if (patch) set(patch);
  });

  return {
    profiles: { [DEFAULT_PROFILE.id]: DEFAULT_PROFILE },
    profileOrder: [DEFAULT_PROFILE.id],
    orphanedProfileData: [],

    createProfile({ name, color, icon = null, shareWith }) {
      const s = get();
      const source = shareWith ? s.profiles[shareWith] : undefined;
      const profile: Profile = {
        id: newId("p"),
        name: name.trim() || `Profile ${s.profileOrder.length + 1}`,
        color: color ?? unusedProfileColor(s.profiles),
        icon,
        createdAt: Date.now(),
        ...(source ? { dataId: dataIdOf(source) } : {}),
      };
      let bookmarks = s.bookmarks;
      let history = s.history;
      if (source) {
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
      const settings = {
        ...s.settings,
        defaultProfileId: s.settings.defaultProfileId === id ? fallback : s.settings.defaultProfileId,
        neverTranslateSites: without(s.settings.neverTranslateSites ?? {}, [id]),
      };
      const shared = sharingProfiles(s, id).length > 0;
      const engine = engineIdOf(s.profiles[id]!);
      const orphaned = profileOrder.some((p) => engineIdOf(s.profiles[p]!) === engine) || s.orphanedProfileData.includes(engine)
        ? s.orphanedProfileData
        : [...s.orphanedProfileData, engine];

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
        orphanedProfileData: orphaned,
        settings,
        history: without(s.history, [id]),
        bookmarks: roots && !shared ? removeBookmarkTree(s.bookmarks, [roots.bar, roots.other], id) : { ...s.bookmarks, roots: without(s.bookmarks.roots, [id]) },
        groups: Object.fromEntries(Object.entries(s.groups).filter(([, g]) => g.profileId !== id)),
        closedTabs: s.closedTabs.filter((c) => c.tab.profileId !== id),
        cleanedTabs: s.cleanedTabs.filter((c) => c.tab.profileId !== id),
        closedGroups: s.closedGroups.filter((c) => c.tabs.every((t) => t.profileId !== id)),
        deletedGroups: s.deletedGroups.filter((c) => c.tabs.every((t) => t.profileId !== id)),
        closedWindows: s.closedWindows
          .map((c) => ({ ...c, tabs: c.tabs.filter((t) => t.profileId !== id) }))
          .filter((c) => c.tabs.length > 0),
        parkedPins: without(s.parkedPins, [id]),
      });
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

    profileDataDeleted(engineId) {
      set((s) => (s.orphanedProfileData.includes(engineId) ? { orphanedProfileData: s.orphanedProfileData.filter((e) => e !== engineId) } : {}));
    },
  };
};
