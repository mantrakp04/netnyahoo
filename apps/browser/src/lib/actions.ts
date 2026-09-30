import * as cef from "@netnyahoo/cef";
import { listExtensions } from "@netnyahoo/cef";
import { confirm, focusWindow, prompt } from "@netnyahoo/shell";
import { pageToProfile } from "../components/layout/profilePager";
import { profileNames, requestCreateProfile, type CreateProfilePreset } from "../components/profiles/CreateProfile";
import { useBrowser, type CreateWindowOptions } from "../store/browser";
import { activeTabId, closesWindow, engineProfile, isIncognitoProfile, resolveWindowId } from "../store/model";
import { engineIdOf, sharingProfiles } from "../store/profiles";
import { webviews } from "./webviews";
import { closeWindowDialog } from "./windowClose";

const store = () => useBrowser.getState();

export function focus(windowId: string) {
  store().setFocusedWindow(windowId);
  void focusWindow(windowId);
}

export function openWindow(options?: CreateWindowOptions): string {
  return store().createWindow(options);
}

export function switchToTab(tabId: string) {
  const tab = store().tabs[tabId];
  if (!tab) return;
  store().activate(tabId);
  if (tab.windowId !== store().ui.focusedWindowId) focus(tab.windowId);
}

export async function closeTab(tabId: string) {
  const s = store();
  const tab = s.tabs[tabId];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w) return;
  const last = closesWindow(s, tabId);
  if (last && s.settings.warnBeforeClosingLastTab && !w.incognito) {
    const { confirmed, suppressed } = await confirm({ ...closeWindowDialog(w.id), suppression: "Don’t ask me again", windowId: w.id });
    if (suppressed) store().updateSettings({ warnBeforeClosingLastTab: false });
    if (!confirmed) return;
  }
  store().closeTab(tabId);
}

export function toggleMute(tabId: string) {
  const tab = store().tabs[tabId];
  if (!tab) return;
  store().setSiteMuted(tabId, !tab.muted);
  void webviews.get(tabId)?.setMuted(!tab.muted);
}

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
      : `All data associated with this Profile will be removed. This action cannot be undone.${engineIdOf(profile) === "" ? await keptExtensionsNote() : ""}`,
    confirmTitle: "Delete Profile",
    destructive: true,
    windowId,
  });
  if (!confirmed) return;
  // The store queues its engine data for deletion (lib/profileData.ts).
  store().deleteProfile(profileId);
}

// Chrome won't remove the original profile's extensions without asking, so they're only turned off
// (ProfileData in packages/cef/ios/CefModule.swift); say so.
async function keptExtensionsNote(): Promise<string> {
  const names = await listExtensions("").then(
    (list) => list.filter((e) => e.mayModify).map((e) => e.name),
    () => null,
  );
  if (names && !names.length) return "";
  return names ? ` Its extensions (${profileNames(names)}) stay installed on this Mac, turned off.` : " Its extensions stay installed on this Mac, turned off.";
}

export async function moveTabToProfile(tabId: string, target: string) {
  const tab = store().tabs[tabId];
  if (!tab || isIncognitoProfile(tab.profileId)) return;
  const profileId = target === "new" ? await createProfile(tab.windowId) : target;
  if (!profileId || profileId === tab.profileId) return;
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

export function moveTabToWindow(tabId: string, target: string) {
  const windowId = store().moveTabsToWindow([tabId], target === "new" ? null : target);
  if (windowId) focus(windowId);
}

export function switchProfile(windowId: string, profileId: string, animated = false) {
  if (animated) pageToProfile(windowId, profileId);
  else store().switchProfile(windowId, profileId);
}

export function cycleProfile(windowId: string, delta: 1 | -1) {
  if (!cycleTarget(windowId, delta)) return;
  // The native pager steps from its own selection, so rapid presses advance past a store that lags.
  if (((cef as { nativePagerVersion?: number }).nativePagerVersion ?? 0) < 1) return cycleFromStore(windowId, delta);
  void cef.stepPager(windowId, delta, true, store().profileOrder.join("\n")).then((ok) => ok || cycleFromStore(windowId, delta));
}

function cycleFromStore(windowId: string, delta: 1 | -1) {
  const target = cycleTarget(windowId, delta);
  if (target) switchProfile(windowId, target, true);
}

function cycleTarget(windowId: string, delta: 1 | -1) {
  const s = store();
  const w = s.windows[windowId];
  if (!w || w.incognito || s.profileOrder.length < 2) return null;
  const i = s.profileOrder.indexOf(w.profileId);
  return s.profileOrder[(i + delta + s.profileOrder.length) % s.profileOrder.length]!;
}

export function adjacentProfile(windowId: string, delta: 1 | -1): string | null {
  const s = store();
  const w = s.windows[windowId];
  if (!w || w.incognito) return null;
  const i = s.profileOrder.indexOf(w.profileId);
  return i < 0 ? null : (s.profileOrder[i + delta] ?? null);
}

export function openUrls(urls: string[], windowId?: string | null) {
  let target = resolveWindowId(store(), windowId);
  for (const url of urls) {
    if (!target || store().windows[target]?.incognito) target = openWindow({ url });
    else store().newTab(target, { url });
  }
}

export function activeTabOf(windowId?: string | null) {
  const s = store();
  const id = resolveWindowId(s, windowId);
  const tabId = id ? activeTabId(s, id) : undefined;
  return tabId ? s.tabs[tabId] : undefined;
}
