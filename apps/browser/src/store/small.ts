import type { BrowserState } from "./browser";
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

// A new Small Yahu uses the profile the frontmost main window shows, else the default profile.
export function smallYahuProfile(s: BrowserState): string {
  const main = mainWindowFor(s);
  return main ? s.windows[main]!.profileId : s.settings.defaultProfileId;
}
