import { confirm, onWindowEvent } from "@netnyahoo/shell";
import { useBrowser } from "../store/browser";
import { plural, profileFor } from "../store/model";

/** ⇧⌘W / the close button on a window with at least this many tabs asks first. */
const MIN_TABS = 2;

/**
 * "Warn before closing a window with multiple tabs": with the setting on, the native close
 * (⇧⌘W, the close button) comes here as `closeRequest` instead of closing. The dialog uses
 * Dia's close-window confirmation (`confirmCloseWindowOnLastTab`), strings from its binary.
 */
export function startWindowCloseGuard() {
  const pending = new Set<string>();
  onWindowEvent((e) => {
    if (e.type !== "closeRequest" || pending.has(e.id)) return;
    pending.add(e.id);
    void requestClose(e.id).finally(() => pending.delete(e.id));
  });
}

async function requestClose(windowId: string) {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!w) return;
  const count = w.tabIds.length;
  if (s.settings.warnBeforeClosingWindow && count >= MIN_TABS) {
    const { confirmed, suppressed } = await confirm({ ...closeWindowDialog(windowId), suppression: "Don’t ask me again", windowId });
    if (suppressed) useBrowser.getState().updateSettings({ warnBeforeClosingWindow: false });
    if (!confirmed) return;
  }
  // The store closes the native window (lib/native syncWindows).
  if (useBrowser.getState().windows[windowId]) useBrowser.getState().closeWindow(windowId);
}

/** Dia's wording: "Close 3 tabs?" / "This window has 3 tabs open in your Work profile." */
export function closeWindowDialog(windowId: string) {
  const s = useBrowser.getState();
  const w = s.windows[windowId]!;
  const tabs = (n: number) => plural(n, "tab");
  const byProfile = new Map<string, number>();
  for (const id of w.tabIds) {
    const profileId = s.tabs[id]?.profileId ?? w.profileId;
    byProfile.set(profileId, (byProfile.get(profileId) ?? 0) + 1);
  }
  const count = w.tabIds.length;
  const message =
    byProfile.size > 1
      ? ["Closing this window closes all tabs open across profiles:", ...[...byProfile].map(([id, n]) => `  • ${tabs(n)} in ${profileFor(s, id).name}`)].join("\n")
      : `This window has ${tabs(count)} open in your ${profileFor(s, w.profileId).name} profile.`;
  return {
    title: count === 1 ? "Close 1 tab?" : `Close ${count} tabs?`,
    message,
    confirmTitle: count === 1 ? "Close Tab" : "Close All Tabs",
  };
}
