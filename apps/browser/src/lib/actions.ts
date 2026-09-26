import { deleteProfileData } from "@netnyahoo/cef";
import { confirm, focusWindow, hasWindowHost, prompt } from "@netnyahoo/shell";
import { pageToProfile } from "../components/layout/profilePager";
import { profileNames, requestCreateProfile, type CreateProfilePreset } from "../components/profiles/CreateProfile";
import { useBrowser, type CreateWindowOptions } from "../store/browser";
import { activeTabId, engineProfile, isIncognitoProfile, resolveWindowId, viewTabIds } from "../store/model";
import { sharingProfiles } from "../store/profiles";
import { webviews } from "./webviews";
import { closeWindowDialog } from "./windowClose";

/**
 * User-facing operations that need more than a store update: confirmation
 * dialogs, focusing native windows, engine calls. Menus, shortcuts and UI all
 * go through these so they behave the same everywhere.
 */
const store = () => useBrowser.getState();

/** Brings a window to the front (its NSWindow opens on its own when created). */
export function focus(windowId: string) {
  store().setFocusedWindow(windowId);
  if (hasWindowHost) void focusWindow(windowId);
}

export function openWindow(options?: CreateWindowOptions): string {
  return store().createWindow(options);
}

/** Selects a tab, bringing its window forward if it's another one (e.g. "Switch to Tab"). */
export function switchToTab(tabId: string) {
  const tab = store().tabs[tabId];
  if (!tab) return;
  store().activate(tabId);
  if (tab.windowId !== store().ui.focusedWindowId) focus(tab.windowId);
}

/**
 * ⌘W. Closing the last tab closes the window; Dia asks first ("Warn before closing last tab in a Profile").
 * A pinned tab stays, its page unloaded (store/tabs `unloadPinnedTabs`).
 */
export async function closeTab(tabId: string) {
  const s = store();
  const tab = s.tabs[tabId];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w) return;
  const last = !tab.pinned && tab.profileId === w.profileId && viewTabIds(s, w.id).length === 1;
  if (last && s.settings.warnBeforeClosingLastTab && !w.incognito) {
    // Same Dia wording as closing the window itself (lib/windowClose).
    const { confirmed, suppressed } = await confirm({ ...closeWindowDialog(w.id), suppression: "Don’t ask me again", windowId: w.id });
    if (suppressed) store().updateSettings({ warnBeforeClosingLastTab: false });
    if (!confirmed) return;
  }
  store().closeTab(tabId);
}

/** Mute Site: every tab of the site in the tab's profile (their web views follow via sidebar/effects). */
export function toggleMute(tabId: string) {
  const tab = store().tabs[tabId];
  if (!tab) return;
  store().setSiteMuted(tabId, !tab.muted);
  void webviews.get(tabId)?.setMuted(!tab.muted);
}

/**
 * Dia's Create Profile dialog (name, colour, share data with another profile), over the
 * window or in Settings. Resolves with the new profile's id, or null if cancelled.
 */
export function createProfile(windowId?: string, preset?: CreateProfilePreset): Promise<string | null> {
  return requestCreateProfile(windowId, preset);
}

export async function renameProfile(profileId: string, windowId?: string) {
  const profile = store().profiles[profileId];
  if (!profile) return;
  const name = await prompt({ title: "Rename Profile", value: profile.name, placeholder: "Profile name", confirmTitle: "Rename", windowId });
  if (name) store().updateProfile(profileId, { name });
}

export async function deleteProfile(profileId: string, windowId?: string) {
  const s = store();
  const profile = s.profiles[profileId];
  if (!profile || s.profileOrder.length <= 1) return;
  const sharing = sharingProfiles(s, profileId).map((id) => s.profiles[id]!.name);
  const { confirmed } = await confirm({
    title: `Delete “${profile.name}”?`,
    message: sharing.length
      ? `Its tabs will be closed. Its cookies, passwords, extensions, bookmarks and history stay with ${profileNames(sharing)}, which share them.`
      : "All data associated with this Profile will be removed. This action cannot be undone.",
    confirmTitle: "Delete Profile",
    destructive: true,
    windowId,
  });
  if (!confirmed) return;
  const engine = engineProfile(profileId);
  store().deleteProfile(profileId);
  // Data other profiles share stays. Its web views close as their tabs unmount; give
  // them a moment before deleting the data directory.
  if (store().profileOrder.some((id) => engineProfile(id) === engine)) return;
  setTimeout(() => void deleteProfileData(engine), 1500);
}

/** Tabs › Move to Profile. Dia warns once that some site data doesn't come along. */
export async function moveTabToProfile(tabId: string, target: string) {
  const tab = store().tabs[tabId];
  if (!tab || isIncognitoProfile(tab.profileId)) return;
  const profileId = target === "new" ? await createProfile(tab.windowId) : target;
  if (!profileId || profileId === tab.profileId) return;
  // Profiles that share data lose nothing in the move.
  const shared = engineProfile(profileId) === engineProfile(tab.profileId);
  if (store().settings.warnBeforeMovingTabsToProfile && !shared) {
    const { confirmed, suppressed } = await confirm({
      title: "Move Tab to Profile?",
      message: "Moving tabs between profiles could result in some data being lost.",
      confirmTitle: "Move Tab",
      suppression: "Don't warn me again",
      windowId: tab.windowId,
    });
    if (suppressed) store().updateSettings({ warnBeforeMovingTabsToProfile: false });
    if (!confirmed) return;
  }
  store().moveTabToProfile(tabId, profileId);
}

/** Tabs › Move to Window ("new" opens one). The page keeps its state in the new window (lib/chromeTabs). */
export function moveTabToWindow(tabId: string, target: string) {
  const windowId = store().moveTabsToWindow([tabId], target === "new" ? null : target);
  if (windowId) focus(windowId);
}

/** ⌃1–⌃9 / next / previous profile. */
/** `animated`: the sidebar (or tab strip) pages to it first, like a swipe (layout/profilePager). */
export function switchProfile(windowId: string, profileId: string, animated = false) {
  if (animated) pageToProfile(windowId, profileId);
  else store().switchProfile(windowId, profileId);
}

export function cycleProfile(windowId: string, delta: 1 | -1) {
  const s = store();
  const w = s.windows[windowId];
  if (!w || w.incognito || s.profileOrder.length < 2) return;
  const i = s.profileOrder.indexOf(w.profileId);
  switchProfile(windowId, s.profileOrder[(i + delta + s.profileOrder.length) % s.profileOrder.length]!, true);
}

/**
 * The profile next to the window's in Settings order, without wrapping (swiping between
 * profiles pages through them and rubber-bands at the ends). Null at an end, in incognito
 * windows and with a single profile.
 */
export function adjacentProfile(windowId: string, delta: 1 | -1): string | null {
  const s = store();
  const w = s.windows[windowId];
  if (!w || w.incognito) return null;
  const i = s.profileOrder.indexOf(w.profileId);
  return i < 0 ? null : (s.profileOrder[i + delta] ?? null);
}

/** URLs handed to the app (default browser, Dock drops): new tabs in the front window. */
export function openUrls(urls: string[], windowId?: string | null) {
  let target = resolveWindowId(store(), windowId);
  for (const url of urls) {
    if (!target || store().windows[target]?.incognito) target = openWindow({ url });
    else store().newTab(target, { url });
  }
}

/** The active tab of a window (or the focused one). */
export function activeTabOf(windowId?: string | null) {
  const s = store();
  const id = resolveWindowId(s, windowId);
  const tabId = id ? activeTabId(s, id) : undefined;
  return tabId ? s.tabs[tabId] : undefined;
}
