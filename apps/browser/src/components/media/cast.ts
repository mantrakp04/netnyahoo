import {
  closeCastDialog,
  onCastDialog,
  onCastRoutes,
  showCastDialog,
  watchCastRoutes,
  type CastDialog,
  type CastRoute,
} from "@netnyahoo/cef";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTabId, engineProfile, incognitoProfileId } from "../../store/model";
import { browserIdOf } from "../extensions/state";
import { tabForBrowser } from "../layout/pageState";

/**
 * Cast (Chrome's Media Router): the dialog's model per tab (CastPicker.tsx), and the
 * casts each profile has running for the toolbar's cast button (ToolbarExtensions).
 * The Cast dialog comes from Chrome both when we ask (the toolbar, Site Controls,
 * View › Cast…) and when a page does (a site's own Cast button, the Presentation API).
 */
type CastStore = {
  dialogs: Record<string, CastDialog>;
  /** Local routes by engine profile. */
  routes: Record<string, CastRoute[]>;
};

export const useCast = create<CastStore>()(() => ({ dialogs: {}, routes: {} }));
/** DEV: for lib/devHarness scripts (`globalThis.nnCast`). */
if (__DEV__) (globalThis as { nnCast?: unknown }).nnCast = { useCast };

/** The engine profile a window's casts run in. */
export function castProfile(s: BrowserState, windowId: string): string {
  const w = s.windows[windowId];
  return !w ? "" : w.incognito ? incognitoProfileId(windowId) : engineProfile(w.profileId);
}

let started = false;
export function startCast() {
  if (started) return;
  started = true;
  onCastDialog((dialog) => {
    const tabId = tabForBrowser(dialog.browserId);
    if (!tabId) {
      if (dialog.open) void closeCastDialog(dialog.id);
      return;
    }
    useCast.setState((c) => {
      const dialogs = { ...c.dialogs };
      if (dialog.open) dialogs[tabId] = dialog;
      else if (dialogs[tabId]?.id === dialog.id) delete dialogs[tabId];
      return { dialogs };
    });
  });
  onCastRoutes(({ profile, routes }) => useCast.setState((c) => ({ routes: { ...c.routes, [profile]: routes } })));
  // Each window's profile reports its casts.
  const watched = new Set<string>();
  const watch = (s: BrowserState) => {
    for (const id of s.windowOrder) {
      const profile = castProfile(s, id);
      if (watched.has(profile)) continue;
      watched.add(profile);
      void watchCastRoutes(profile);
    }
  };
  watch(useBrowser.getState());
  useBrowser.subscribe((s, prev) => {
    if (s.windowOrder !== prev.windowOrder) watch(s);
  });
}

/** Opens the Cast picker for the window's page (or closes it when it's open). */
export async function toggleCastPicker(windowId: string) {
  const tabId = activeTabId(useBrowser.getState(), windowId);
  if (!tabId) return;
  const open = useCast.getState().dialogs[tabId];
  if (open) return closeCastPicker(tabId);
  const browserId = browserIdOf(tabId);
  if (browserId) await showCastDialog(browserId);
}

export function closeCastPicker(tabId: string) {
  const dialog = useCast.getState().dialogs[tabId];
  if (dialog) void closeCastDialog(dialog.id);
}

const NONE: CastRoute[] = [];
/** Casts running in the window's profile. */
export function useCastRoutes(windowId: string): CastRoute[] {
  const profile = useBrowser((s) => castProfile(s, windowId));
  return useCast((c) => c.routes[profile] ?? NONE);
}
