import type { BrowserState } from "./browser";
import { engineProfile } from "./model";
import type { BrowserWindow } from "./types";

// Small Yahu, our Little Arc: a small window with one page and no sidebar. Links from other apps open there
// (settings.openLinksInSmallYahu), ⌘O moves the page into a main window, and closing it throws the page away
// (it stays in history, and ⇧⌘T brings it back in Small Yahu).

export const isSmallWindow = (w: BrowserWindow | undefined): boolean => w?.kind === "small";

export const isSmall = (s: Pick<BrowserState, "windows">, windowId?: string | null): boolean =>
  !!windowId && s.windows[windowId]?.kind === "small";

const isMain = (w: BrowserWindow | undefined): w is BrowserWindow => !!w && !w.incognito && w.kind !== "small";

// Where a Small Yahu page goes: the frontmost main window showing its profile, else the frontmost main window.
export function mainWindowFor(s: BrowserState, profileId?: string): string | undefined {
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].filter((id) => isMain(s.windows[id]));
  return (profileId ? order.find((id) => s.windows[id]!.profileId === profileId) : undefined) ?? order[0];
}

// The regular profile a window belongs to: the one it shows, or for a private window the one it was opened from
// (Chrome's GetOriginalProfile; in the engine a private window is that profile's off-the-record profile).
export function originalProfile(s: Pick<BrowserState, "profiles">, w: BrowserWindow | undefined): string | undefined {
  const id = w?.incognito ? w.originalProfileId : w?.profileId;
  return id && s.profiles[id] ? id : undefined;
}

// The regular profile of a private window a page opens (Open Link in Incognito Window, an extension's incognito
// window): the one Chrome's private tab is off the record of (`engineName`, the engine's name for it), else the page's
// window's.
export function privateWindowProfile(s: Pick<BrowserState, "profiles" | "profileOrder">, w: BrowserWindow | undefined, engineName?: string) {
  const named = engineName !== undefined ? s.profileOrder.find((p) => engineProfile(p) === engineName) : undefined;
  return named ?? originalProfile(s, w);
}

// The profile of the window used last: links from other apps and a new Small Yahu open in it, never privately. As
// Chrome's AppController keeps it (lastProfile, set when a window becomes main; links from other apps open in its
// original profile, never incognito; kept across a relaunch as Chrome's last-used profile): ui.lastProfileId, set when
// a window becomes key (a private window counting as its original profile) or the key one pages to another profile.
// It stays when a private window closes, until another window becomes key; the window in front closing hands it to
// the next one. It is saved with the session, so it holds after a relaunch until a restored window becomes key. A
// deleted one falls back to the windows in focus order, then the default profile.
export function lastActiveProfile(s: BrowserState): string {
  const last = s.ui.lastProfileId;
  if (last && s.profiles[last]) return last;
  for (const id of [...s.ui.focusOrder, ...[...s.windowOrder].reverse()]) {
    const profile = originalProfile(s, s.windows[id]);
    if (profile) return profile;
  }
  return s.settings.defaultProfileId;
}
