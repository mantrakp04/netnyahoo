/**
 * The AppleScript this extension sends Netnyahoo (its dictionary: Netnyahoo.sdef in the app),
 * kept free of Raycast imports so it can be checked on its own (`npm test`) and run inside the
 * app by its DEV AppleScript runner.
 */

export const BUNDLE_ID = "com.netnyahoo.browser";

/** Who the scripts talk to: the app by bundle id (tests inside the app use `current application`). */
export const APP_TARGET = `application id "${BUNDLE_ID}"`;

export type Tab = {
  windowId: string;
  /** Front to back, 1 = the front window. */
  windowIndex: number;
  tabId: string;
  title: string;
  /** Empty for the New Tab page. */
  url: string;
  isPinned: boolean;
  /** The tab its window shows. */
  isFocused: boolean;
};

// ASCII unit and record separators: never in titles or URLs.
const FIELD = "\u001f";
const RECORD = "\u001e";

/** "a\"b" → a quoted AppleScript string literal. */
export const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Every window's tabs in sidebar order (pinned first), windows front to back. One Apple event
 * per property and window (`… of every tab`), not one per tab.
 */
export function listTabsScript(target = APP_TARGET) {
  return `set fs to character id 31
set rs to character id 30
set out to ""
tell ${target}
  set windowIndex to 0
  repeat with w in windows
    set windowIndex to windowIndex + 1
    set wId to id of w
    set tIds to id of every tab of w
    set tTitles to title of every tab of w
    set tURLs to URL of every tab of w
    set tPinned to isPinned of every tab of w
    set tFocused to isFocused of every tab of w
    repeat with i from 1 to count of tIds
      set out to out & wId & fs & windowIndex & fs & (item i of tIds) & fs & (item i of tTitles) & fs & (item i of tURLs) & fs & (item i of tPinned) & fs & (item i of tFocused) & rs
    end repeat
  end repeat
end tell
return out`;
}

/** What `listTabsScript` returns → tabs. */
export function parseTabs(output: string): Tab[] {
  return output
    .split(RECORD)
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [windowId = "", windowIndex = "0", tabId = "", title = "", url = "", pinned = "", focused = ""] = record.split(FIELD);
      return {
        windowId: windowId.trim(),
        windowIndex: Number(windowIndex) || 0,
        tabId,
        title,
        url: url === "missing value" ? "" : url,
        isPinned: pinned === "true",
        isFocused: focused === "true",
      };
    });
}

/** Selects the tab, bringing its window forward. Activating the app is a separate step (`activateScript`). */
export function focusTabScript(tab: Pick<Tab, "windowId" | "tabId">, target = APP_TARGET) {
  return `tell ${target} to focus (tab id ${quote(tab.tabId)} of window id ${quote(tab.windowId)})`;
}

export function closeTabScript(tab: Pick<Tab, "windowId" | "tabId">, target = APP_TARGET) {
  return `tell ${target} to close (tab id ${quote(tab.tabId)} of window id ${quote(tab.windowId)})`;
}

export function activateScript(target = APP_TARGET) {
  return `tell ${target} to activate`;
}

/** The part of a URL a tab row shows under its title. */
export function hostOf(url: string) {
  try {
    const { hostname, protocol } = new URL(url);
    return hostname.replace(/^www\./, "") || protocol.replace(/:$/, "");
  } catch {
    return url;
  }
}
