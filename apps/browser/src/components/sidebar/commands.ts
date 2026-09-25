import type { BrowserCommand, MenuEntry } from "@netnyahoo/shell";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTabId, plural } from "../../store/model";
import { awayFromPin, groupOf, selectedTabIds } from "../../store/organize";
import { newGroupWithSelection, openIconPicker, startRename } from "./actions";
import { closeAllTabs } from "./menus";
import { setSidebarUi } from "./state";
import { switcherStep } from "./switcher";

/**
 * Menu-bar / shortcut commands for tabs and the sidebar (lib/commands forwards
 * them). Returns false for commands that aren't ours.
 */
export function runSidebarCommand(command: BrowserCommand, arg: string | null, windowId: string): boolean {
  const s = useBrowser.getState();
  const tabId = activeTabId(s, windowId);
  switch (command) {
    case "newTabInGroup": {
      const group = groupOf(s, tabId);
      const id = group ? s.newTabInGroup(group.id) : s.newTab(windowId);
      if (id) useBrowser.getState().activate(id);
      return true;
    }
    case "newGroupWithTabs":
      newGroupWithSelection(windowId);
      return true;
    case "cleanUpTabs":
      s.cleanUpTabs(windowId);
      return true;
    case "closeAllTabs":
      closeAllTabs(windowId);
      return true;
    case "searchTabs":
      setSidebarUi({ searchTabs: windowId, hover: null });
      return true;
    case "renameTab":
      if (tabId) void startRename(windowId, { kind: "tab", id: tabId });
      return true;
    case "changeTabIcon":
      if (tabId) void openIconPicker(windowId, { kind: "tab", id: tabId });
      return true;
    case "returnToPinnedUrl":
      if (tabId) s.returnToPinnedUrl(tabId);
      return true;
    case "tabSwitcher":
      switcherStep(windowId, arg === "backward");
      return true;
  }
  return false;
}

/** Commands above that need a window. */
export const SIDEBAR_WINDOW_COMMANDS = [
  "newTabInGroup", "newGroupWithTabs", "cleanUpTabs", "searchTabs", "renameTab", "changeTabIcon", "returnToPinnedUrl", "tabSwitcher",
];

/** The menu bar's view of these commands for the focused window (see lib/native menuState). */
export function sidebarMenuState(s: BrowserState, windowId: string | undefined) {
  const disabled: string[] = [];
  const titles: Record<string, string> = {};
  const tab = windowId ? s.tabs[activeTabId(s, windowId) ?? ""] : undefined;
  if (!windowId) disabled.push(...SIDEBAR_WINDOW_COMMANDS);
  else {
    if (!tab || !awayFromPin(tab)) disabled.push("returnToPinnedUrl");
    const selected = selectedTabIds(s, windowId).filter((id) => !s.tabs[id]?.pinned);
    if (!selected.length) disabled.push("newGroupWithTabs");
    if (selected.length > 1) titles.newGroupWithTabs = `New Group with ${plural(selected.length, "Tab")}`;
  }
  const recentlyClosedGroups: MenuEntry[] = [...s.closedGroups]
    .reverse()
    .slice(0, 10)
    .map((c) => ({ id: c.id, title: `${c.group.name} (${plural(c.tabs.length, "Tab")})` }));
  return { disabled, titles, recentlyClosedGroups };
}
