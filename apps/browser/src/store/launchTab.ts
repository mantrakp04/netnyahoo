import { switchOn } from "../lib/killSwitches";
import type { BrowserState } from "./browser";
import { engineProfile } from "./model";

/** The page a launch shows first: what the engine starts loading before the app's window is up (ArcadiaCoreWebView
 *  startLaunchTab:), and the app claims once its store is hydrated (lib/tabPages.ts). */
export type LaunchTab = { id: string; url: string; profile: string };

/**
 * The early load's switch (lib/killSwitches.ts): off, no hint is saved and a launch claims nothing, so the engine starts
 * nothing from the next launch on (a page this launch's engine started closes at the claim).
 */
export const earlyLaunchTabOn = () => switchOn("launchTab");

// A web page: never one of the app's own (arcadia://, which has no WebView) or Chrome's.
const WEB = /^https?:\/\//i;

/**
 * The window's active tab, when it is a web page a launch would load: the focused window of a session as saved (its
 * hint for the next launch) or as just hydrated (what that launch shows). None for a private or Little Arcadia window, a
 * session the user doesn't restore, or one of the app's own pages.
 */
export function launchTab(s: Pick<BrowserState, "windows" | "tabs" | "settings">, windowId: string | null | undefined): LaunchTab | null {
  const w = windowId ? s.windows[windowId] : undefined;
  if (!w || w.incognito || w.kind === "small" || s.settings.restoreSession === false) return null;
  const t = s.tabs[w.activeTabIds[w.profileId] ?? ""];
  if (!t || t.windowId !== w.id || t.profileId !== w.profileId || !WEB.test(t.url)) return null;
  return { id: t.id, url: t.url, profile: engineProfile(t.profileId) };
}
