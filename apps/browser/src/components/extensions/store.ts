import type { ActionState, ExtensionInstallPrompt, ExtensionPackage, InstalledExtension } from "@netnyahoo/nncore";
import { useMemo } from "react";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTabId, engineProfile } from "../../store/model";
import { usePages } from "../layout/pageState";

export type Anchor = { x: number; y: number; width: number; height: number };

export type InstallRequest = {
  windowId: string;
  profile: string;
  source: "webStore" | "unpacked";
  status: "ready" | "installing" | "error";
  pkg?: ExtensionPackage;
  error?: string;
  prompt?: ExtensionInstallPrompt;
};

type ExtensionsStore = {
  lists: Record<string, InstalledExtension[]>;
  actions: Record<number, Record<string, ActionState>>;
  /** `pageProfile`: the engine profile its page runs in. */
  popup: { windowId: string; pageProfile: string; extensionId: string; url: string; anchor: Anchor } | null;
  install: InstallRequest | null;
  pinDialog: { windowId: string } | null;
  sidePanels: Record<string, SidePanel>;
};

export type SidePanel = {
  extensionId: string;
  /** The profile whose extension list it's from. */
  profile: string;
  /** The engine profile its page runs in: a private window's own. */
  pageProfile: string;
  url: string;
};

export const useExtensions = create<ExtensionsStore>()(() => ({ lists: {}, actions: {}, popup: null, install: null, pinDialog: null, sidePanels: {} }));

const EMPTY: InstalledExtension[] = [];

/** The profile whose extensions a window lists. Private windows are the default profile's, off the record. */
export function extensionProfile(s: BrowserState, windowId: string | null | undefined): string {
  const w = windowId ? s.windows[windowId] : undefined;
  return !w || w.incognito ? "" : engineProfile(w.profileId);
}

export const isPrivate = (s: BrowserState, windowId: string) => !!s.windows[windowId]?.incognito;

/** The engine profile an extension's popup or side panel runs in: a private window's own. */
export const pageProfile = (s: BrowserState, windowId: string) =>
  isPrivate(s, windowId) ? engineProfile(s.windows[windowId]!.profileId) : extensionProfile(s, windowId);

/**
 * Whether a window shows an extension. A private window shows only extensions allowed in incognito whose pages
 * Chrome runs in the private profile (split mode); a spanning one's popup and side panel would use the regular
 * profile's storage and sign-ins.
 */
const showsExtension = (priv: boolean, ext: InstalledExtension) => ext.enabled && (!priv || (ext.incognito && !!ext.incognitoSplit));

export function useWindowExtensions(windowId: string): InstalledExtension[] {
  const profile = useBrowser((s) => extensionProfile(s, windowId));
  const priv = useBrowser((s) => isPrivate(s, windowId));
  const list = useExtensionList(profile);
  return useMemo(() => list.filter((x) => showsExtension(priv, x)), [list, priv]);
}

export function windowExtensions(s: BrowserState, windowId: string | undefined): InstalledExtension[] {
  if (!windowId) return EMPTY;
  const priv = isPrivate(s, windowId);
  return (useExtensions.getState().lists[extensionProfile(s, windowId)] ?? EMPTY).filter((x) => showsExtension(priv, x));
}

export const shownIn = (windowId: string, extensionId: string) => windowExtensions(useBrowser.getState(), windowId).find((x) => x.id === extensionId);

export function useExtensionList(profile: string): InstalledExtension[] {
  return useExtensions((e) => e.lists[profile] ?? EMPTY);
}

export function browserIdOf(tabId: string | undefined): number {
  if (!tabId) return 0;
  for (const [browserId, tab] of Object.entries(usePages.getState().browsers)) if (tab === tabId) return Number(browserId);
  return 0;
}

export const activeBrowserId = (windowId: string) => browserIdOf(activeTabId(useBrowser.getState(), windowId));
