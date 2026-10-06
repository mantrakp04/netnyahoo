import {
  closeCastDialog,
  onCastDialog,
  onCastRoutes,
  showCastDialog,
  watchCastRoutes,
  type CastDialog,
  type CastRoute,
} from "@netnyahoo/nncore";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTabId, engineProfile } from "../../store/model";
import { browserIdOf } from "../extensions/state";
import { tabForBrowser } from "../layout/pageState";

type CastStore = {
  dialogs: Record<string, CastDialog>;
  routes: Record<string, CastRoute[]>;
};

export const useCast = create<CastStore>()(() => ({ dialogs: {}, routes: {} }));
if (__DEV__) (globalThis as { nnCast?: unknown }).nnCast = { useCast };

export function castProfile(s: BrowserState, windowId: string): string {
  const w = s.windows[windowId];
  return !w ? "" : engineProfile(w.profileId);
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
export function useCastRoutes(windowId: string): CastRoute[] {
  const profile = useBrowser((s) => castProfile(s, windowId));
  return useCast((c) => c.routes[profile] ?? NONE);
}
