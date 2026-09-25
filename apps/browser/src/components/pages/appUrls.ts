import { appUrlRoute } from "@netnyahoo/core";
import { useBrowser } from "../../store/browser";
import { setAppUrlOpener } from "../../store/tabs";
import { openSettings, type SettingsPane } from "../settings/windows";

/**
 * netnyahoo:// URLs that don't load in the tab: netnyahoo://settings[/pane] opens the Settings
 * window and netnyahoo://newtab a New Tab page, from the bar, bookmarks, history, AppleScript and
 * opened URLs alike (store `navigate` / `newTab`). Chrome's own deep links that name one of our
 * panes land there too; other netnyahoo://settings/… paths load Chrome's settings page.
 */
const PANES: Record<string, SettingsPane> = {
  general: "general",
  profiles: "profiles",
  people: "profiles",
  manageprofile: "profiles",
  tabs: "tabs",
  appearance: "appearance",
  privacy: "privacy",
  passwords: "passwords",
  autofill: "autofill",
  addresses: "autofill",
  payments: "autofill",
  extensions: "extensions",
  search: "search",
  searchengines: "search",
  shortcuts: "shortcuts",
  livefolders: "liveFolders",
  calendar: "calendar",
  advanced: "advanced",
};

/** The Settings pane a netnyahoo://settings URL opens: "root" for the window as it was, null for Chrome's page. */
export function settingsPaneOf(url: string): SettingsPane | "root" | null {
  const route = appUrlRoute(url);
  if (route?.kind !== "settings") return null;
  return route.section === null ? "root" : (PANES[route.section.toLowerCase()] ?? null);
}

setAppUrlOpener((url, windowId) => {
  const route = appUrlRoute(url);
  if (route?.kind === "newTab") {
    useBrowser.getState().newTab(windowId);
    return true;
  }
  const pane = settingsPaneOf(url);
  if (!pane) return false;
  openSettings(pane === "root" ? undefined : pane);
  return true;
});
