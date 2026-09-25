import { showMenu, type MenuItem } from "@netnyahoo/shell";
import { create } from "zustand";
import { closeTab } from "../../lib/actions";
import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { MAX_SPLIT_PANES, slotsOf, splitOf, type OpenPaneOptions, type SplitSide } from "../../store/splits";

/**
 * Split view operations for menus, shortcuts, the toolbar and the sidebar.
 * They wrap the store's split actions with Dia's feedback (the "Cannot Add New
 * Pane" toast) and native menus. Other areas call these, e.g. the sidebar's
 * ⌥-click on + → `openNewTabInSplit(windowId)`, a tab's "Open in Split View"
 * → `openInSplit(tabId)`.
 */
const store = () => useBrowser.getState();

/** Transient toasts per window ("Cannot Add New Pane"). */
type Toast = { id: number; title: string; message?: string } & ToastOptions;
/** `icon`: SF Symbol (default: the split view glyph). `action`: an accessory button (Dia's "Settings"). */
export type ToastOptions = { icon?: string; action?: { title: string; run(): void } };
export const useToasts = create<{ toasts: Record<string, Toast | null> }>()(() => ({ toasts: {} }));
let toastSeq = 0;
export function showToast(windowId: string, title: string, message?: string, options?: ToastOptions) {
  useToasts.setState((s) => ({ toasts: { ...s.toasts, [windowId]: { id: ++toastSeq, title, message, ...options } } }));
}
export function hideToast(windowId: string, id: number) {
  useToasts.setState((s) => (s.toasts[windowId]?.id === id ? { toasts: { ...s.toasts, [windowId]: null } } : s));
}

const maxedOut = (windowId: string) =>
  showToast(windowId, "Cannot Add New Pane", `Split View can show up to ${MAX_SPLIT_PANES} tabs at once.`);

/** ⌃⇧= / the toolbar's split button: a New Tab page (or `url`) next to the focused pane. */
export function openSplitPane(windowId: string, options: OpenPaneOptions = {}): string | null {
  const result = store().openSplitPane(windowId, options);
  if (!result.ok) {
    if (result.reason === "max") maxedOut(windowId);
    return null;
  }
  return result.tabId;
}

/** Sidebar ⌥-click on "+ New Tab": a New Tab page in a split with the current tab. */
export const openNewTabInSplit = (windowId: string) => openSplitPane(windowId);

/** "Open in Split View": shows an existing tab next to the window's current one. */
export function openInSplit(tabId: string, side: SplitSide = "right") {
  const tab = store().tabs[tabId];
  if (!tab) return;
  const active = activeTabId(store(), tab.windowId);
  if (!active || active === tabId) return;
  openSplitPane(tab.windowId, { tabId, anchorTabId: active, side });
}

/** ⇧⌥-click on a link: the link opens in the pane to the right (a new one if there's none). */
export function openLinkInSplit(sourceTabId: string, url: string) {
  const s = store();
  const source = s.tabs[sourceTabId];
  if (!source) return;
  const split = splitOf(s, sourceTabId);
  const next = split?.tabIds[split.tabIds.indexOf(sourceTabId) + 1];
  if (split && (next || split.tabIds.length >= MAX_SPLIT_PANES)) {
    const target = next ?? split.tabIds.at(-1)!;
    if (target !== sourceTabId) return s.navigate(target, url);
  }
  openSplitPane(source.windowId, { anchorTabId: sourceTabId, url, side: "right", background: true });
}

/** A tab dropped on a pane's edge. */
export function dropTabIntoSplit(tabId: string, targetTabId: string, side: SplitSide) {
  const target = store().tabs[targetTabId];
  if (!target || tabId === targetTabId) return;
  openSplitPane(target.windowId, { tabId, anchorTabId: targetTabId, side });
}

/** A pane's ✕: closes that tab (the rest of the split stays). */
export function closePane(tabId: string) {
  void closeTab(tabId);
}

/** The per-pane split menu (Dia's content-toolbar split button). */
export async function showSplitMenu(tabId: string) {
  const s = store();
  const split = splitOf(s, tabId);
  const tab = s.tabs[tabId];
  if (!split || !tab) return;
  const horizontal = split.orientation === "horizontal";
  const index = split.tabIds.indexOf(tabId);
  const full = split.tabIds.length >= MAX_SPLIT_PANES;
  const stacked = slotsOf(split).some((slot) => slot.length === 2 && slot.includes(tabId));
  const items: MenuItem[] = [
    { id: "add", title: horizontal ? "Add Vertical Split View" : "Add Horizontal Split View", symbol: horizontal ? "rectangle.split.2x1" : "rectangle.split.1x2", enabled: !full, key: "=", modifiers: ["control", "shift"] },
    { id: "bottom", title: horizontal ? "Add Bottom Split" : "Add Right Split", symbol: horizontal ? "rectangle.bottomhalf.inset.filled" : "rectangle.righthalf.inset.filled", enabled: !full && !stacked },
    { separator: true },
    { id: "left", title: horizontal ? "Move Pane Left" : "Move Pane Up", symbol: "rectangle.lefthalf.inset.filled.arrow.left", enabled: index > 0 },
    { id: "right", title: horizontal ? "Move Pane Right" : "Move Pane Down", symbol: "rectangle.righthalf.inset.filled.arrow.right", enabled: index < split.tabIds.length - 1 },
    { id: "flip", title: "Flip Split View", symbol: horizontal ? "arrow.left.arrow.right" : "arrow.up.arrow.down" },
    { id: "convert", title: horizontal ? "Convert to Vertical Split View" : "Convert to Horizontal Split View", symbol: horizontal ? "rectangle.split.1x2" : "rectangle.split.2x1" },
    { separator: true },
    { id: "remove", title: "Remove from Split View", symbol: "rectangle.portrait.and.arrow.right" },
    { id: "separate", title: "Separate All Tabs", symbol: "rectangle.split.3x1" },
    { separator: true },
    { id: "close", title: "Close Pane", symbol: "xmark" },
  ];
  const choice = await showMenu(items);
  const st = store();
  switch (choice) {
    case "add":
      return void openSplitPane(tab.windowId, { anchorTabId: tabId, side: horizontal ? "right" : "bottom" });
    case "bottom":
      return void openSplitPane(tab.windowId, { anchorTabId: tabId, side: horizontal ? "bottom" : "right" });
    case "left":
      return st.movePane(tabId, -1);
    case "right":
      return st.movePane(tabId, 1);
    case "flip":
      return st.flipSplit(split.id);
    case "convert":
      return st.toggleSplitOrientation(split.id);
    case "remove":
      return st.removeTabFromSplit(tabId);
    case "separate":
      return st.separateSplit(split.id);
    case "close":
      return closePane(tabId);
  }
}
