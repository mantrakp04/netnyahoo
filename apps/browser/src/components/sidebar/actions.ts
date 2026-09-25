import { cleanUrl, markdownLink } from "@netnyahoo/core";
import { copyText, prompt } from "@netnyahoo/shell";
import { updateFolder } from "../../live/store";
import { useBrowser } from "../../store/browser";
import { activeTabId, bookmarkProfileId, viewTabIds } from "../../store/model";
import { groupOf, selectedTabIds } from "../../store/organize";
import type { Tab } from "../../store/types";
import { measureRow, setSidebarUi, sidebarUi, type Target } from "./state";

/**
 * Sidebar operations shared by rows, context menus and menu-bar commands.
 */
const store = () => useBrowser.getState();

/** Where ⇧-click ranges start: the last plainly- or ⌘-clicked tab per window. */
const anchors = new Map<string, string>();

/**
 * Click on a tab: select it, ⌘ toggles it in the selection, ⇧ selects a range, ⌥⇧ opens it in
 * the current tab's group (Settings › Tabs "⌥⇧-click opens tab in group").
 */
export function clickTab(windowId: string, tabId: string, mods: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) {
  const s = store();
  if (mods.altKey && mods.shiftKey && !mods.metaKey && s.settings.optShiftClickOpensInGroup) return openInCurrentGroup(windowId, tabId);
  const view = viewTabIds(s, windowId);
  const active = activeTabId(s, windowId);
  const current = s.selection[windowId] ?? [];
  if (mods.metaKey) {
    // The active tab counts as selected when a multi-selection starts.
    const base = current.length ? current : active ? [active] : [];
    const next = base.includes(tabId) ? base.filter((id) => id !== tabId) : [...base, tabId];
    anchors.set(windowId, tabId);
    return s.setSelection(windowId, next.length > 1 ? next : []);
  }
  if (mods.shiftKey) {
    const from = view.indexOf(anchors.get(windowId) ?? active ?? tabId);
    const to = view.indexOf(tabId);
    if (from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      return s.setSelection(windowId, view.slice(a, b + 1));
    }
  }
  anchors.set(windowId, tabId);
  s.setSelection(windowId, []);
  s.activate(tabId);
}

/** ⌥⇧-click: the tab joins the selected tab's group (or they start one, pinned like ⌃⌘N's) and is selected. */
function openInCurrentGroup(windowId: string, tabId: string) {
  const s = store();
  const active = activeTabId(s, windowId);
  if (active && active !== tabId && !s.tabs[tabId]?.pinned && !s.tabs[active]?.pinned) {
    const group = groupOf(s, active);
    if (group) s.addTabsToGroup(group.id, [tabId]);
    else s.groupTabs([active, tabId]);
  }
  anchors.set(windowId, tabId);
  store().setSelection(windowId, []);
  store().activate(tabId);
}

export const isSelected = (windowId: string, tabId: string) => (store().selection[windowId] ?? []).includes(tabId);

/** Rename… — inline in the list; pinned tiles (no visible title) ask in a sheet. */
export async function startRename(windowId: string, target: Target) {
  const s = store();
  if (target.kind === "tab") {
    const tab = s.tabs[target.id];
    if (!tab) return;
    if (tab.pinned) {
      const name = await prompt({
        title: "Rename Tab",
        value: tab.customTitle ?? tab.title,
        placeholder: tab.title || "Tab name",
        confirmTitle: "Update",
        windowId,
      });
      if (name !== null) store().updateTab(tab.id, { customTitle: name });
      return;
    }
    // A collapsed group opens so the row can be edited.
    const group = groupOf(s, tab.id);
    if (group?.collapsed && activeTabId(s, windowId) !== tab.id) s.updateGroup(group.id, { collapsed: false });
  }
  setSidebarUi({ renaming: { windowId, ...target } });
}

/** Empty text resets the name (the page title / derived group name shows again). */
export function commitRename(target: Target, text: string) {
  const name = text.trim();
  if (target.kind === "tab") {
    const tab = store().tabs[target.id];
    if (tab) store().updateTab(tab.id, { customTitle: name && name !== tab.title ? name : null });
  } else store().updateGroup(target.id, { name });
  endRename(target);
}

export function endRename(target: Target) {
  const r = sidebarUi().renaming;
  if (r && r.id === target.id) setSidebarUi({ renaming: null });
}

/** Change Icon… — opens the picker next to the row (or the window's top left if it's not shown). */
export async function openIconPicker(windowId: string, target: Target) {
  const anchor = await measureRow(windowId, target.id);
  setSidebarUi({ iconPicker: { windowId, ...target, anchor }, hover: null });
}

export function setIcon(target: Target, icon: string | null) {
  if (target.kind === "tab") store().updateTab(target.id, { customIcon: icon });
  // A live folder's header row ("livefolder|<id>").
  else if (target.kind === "live") updateFolder(target.id.split("|")[1] ?? "", { icon });
  else store().updateGroup(target.id, { icon });
}

/** New Group with Tab(s) ⌃⌘N: groups the selection and drops you into naming it, like Dia. */
export function newGroupWithSelection(windowId: string, ids = selectedTabIds(store(), windowId)) {
  const groupId = store().groupTabs(ids.filter((id) => !store().tabs[id]?.pinned));
  if (groupId) void startRename(windowId, { kind: "group", id: groupId });
  return groupId;
}

export const tabTitle = (t: Pick<Tab, "customTitle" | "title" | "url">) => t.customTitle || t.title || t.url || "New Tab";

/** Copy URLs (one per line), or as Markdown links. */
export function copyUrls(ids: string[], markdown: boolean) {
  const tabs = ids.map((id) => store().tabs[id]).filter((t): t is Tab => !!t?.url);
  if (!tabs.length) return;
  // Every Copy URL drops trackers, like ⇧⌘C (Dia's "without any trackers").
  const lines = tabs.map((t) => (markdown ? markdownLink(tabTitle(t), t.url) : cleanUrl(t.url)));
  copyText(markdown && lines.length > 1 ? lines.map((l) => `- ${l}`).join("\n") : lines.join("\n"));
}

/** Add Tabs to Bookmarks Bar / Folder (`"new"` asks for a folder name, made on the Bookmarks Bar). */
export async function bookmarkTabs(windowId: string, ids: string[], folder: string | "bar" | "new") {
  const s = store();
  const profileId = bookmarkProfileId(s, s.windows[windowId]);
  let parentId: string | undefined = folder === "bar" ? undefined : folder;
  if (folder === "new") {
    const title = await prompt({ title: "New Folder", placeholder: "Folder name", confirmTitle: "Create", windowId });
    if (!title) return;
    parentId = store().addBookmarkFolder({ profileId, title });
  }
  for (const id of ids) {
    const t = store().tabs[id];
    if (t?.url) store().addBookmark({ profileId, url: t.url, title: tabTitle(t), favicon: t.favicon, parentId });
  }
}

/** Edit Pinned Page… */
export async function editPinnedPage(windowId: string, tabId: string) {
  const tab = store().tabs[tabId];
  if (!tab?.pinned) return;
  const url = await prompt({
    title: "Edit Pinned Page",
    value: tab.pinnedUrl ?? tab.url,
    placeholder: "Enter Pinned URL",
    confirmTitle: "Save",
    windowId,
  });
  if (url) store().setPinnedUrl(tabId, url.includes("://") ? url : `https://${url}`);
}

/** Mute All Tabs / Unmute All Tabs in the window's current profile. */
export function muteAll(windowId: string, muted: boolean) {
  store().setMuted(viewTabIds(store(), windowId), muted);
}

export const allMuted = (windowId: string) => {
  const s = store();
  const view = viewTabIds(s, windowId).filter((id) => s.tabs[id]!.url);
  return view.length > 0 && view.every((id) => s.tabs[id]!.muted);
};
