import { cleanUrl, markdownLink } from "@netnyahoo/core";
import { copyText, prompt, showMenu, type MenuItem } from "@netnyahoo/shell";
import { closeTab } from "../../lib/actions";
import { calendarConnected, connectCalendar, setCalendarHidden, useCalendar } from "../../live/calendar";
import { deleteLiveFolder, newLiveFolder, openLiveItem, refreshFolder, statusText } from "../../live/engine";
import { ALERT_LEADS } from "../../live/meetings";
import { SOURCES } from "../../live/sources";
import { live, markRead, moveFolder, setLive, updateCalendarSettings, updateFolder } from "../../live/store";
import type { LiveItem, LiveSourceId } from "../../live/types";
import { openSettings } from "../settings/windows";
import { openIconPicker } from "./actions";

/**
 * Context menus for live folders (Dia's LiveFolderContextMenuModel: status,
 * refresh, filters and sources), their items, the sidebar's "New Live Folder"
 * submenu, and the Calendar submenu of a pinned calendar tab.
 */
const sep = { separator: true } as const;

/** Items for the empty-sidebar menu (ids prefixed "live:"). */
export function newLiveFolderMenuItem(): MenuItem {
  return {
    id: "live",
    title: "New Live Folder",
    symbol: "dot.radiowaves.left.and.right",
    children: [
      { id: "live:pullRequests", title: "Pull Requests", symbol: "arrow.triangle.pull" },
      { id: "live:documents", title: "Documents", symbol: "doc.text" },
    ],
  };
}

export function runNewLiveFolder(windowId: string, choice: string): boolean {
  if (choice === "live:pullRequests") newLiveFolder(windowId, "pullRequests");
  else if (choice === "live:documents") newLiveFolder(windowId, "documents");
  else return false;
  return true;
}

const SOURCE_GROUPS: Record<"pullRequests" | "documents", LiveSourceId[]> = {
  pullRequests: ["github", "bitbucket"],
  documents: ["notion", "confluence", "gdrive"],
};

export async function openLiveFolderMenu(windowId: string, folderId: string) {
  const s = live();
  const folder = s.folders[folderId];
  if (!folder) return;
  const index = s.folderOrder.indexOf(folderId);
  const pr = folder.kind === "pullRequests";
  const status = s.status[folderId];
  const choice = await showMenu([
    { id: "status", title: statusText(folderId), enabled: false },
    { id: "refresh", title: "Refresh", symbol: "arrow.clockwise", enabled: status?.state !== "updating" },
    sep,
    ...(pr
      ? [
          { id: "filter:authored", title: "Created by Me", checked: folder.filters.authored },
          { id: "filter:reviewRequests", title: "Awaiting My Review", checked: folder.filters.reviewRequests },
          sep,
        ]
      : []),
    {
      id: "sources",
      title: pr ? "Pull Requests" : "Documents",
      symbol: pr ? "arrow.triangle.pull" : "doc.text",
      children: SOURCE_GROUPS[folder.kind].map((id) => ({
        id: `source:${id}`,
        title: s.accounts[id] ? SOURCES[id].name : `${SOURCES[id].name} (Not Connected)`,
        checked: folder.sources.includes(id),
      })),
    },
    sep,
    { id: "rename", title: "Rename…", symbol: "character.cursor.ibeam" },
    { id: "icon", title: folder.icon ? "Change Icon…" : "Add Icon…", symbol: "face.smiling" },
    { id: "read", title: "Mark All as Read", symbol: "circle", enabled: (s.unread[folderId]?.length ?? 0) > 0 },
    { id: "collapse", title: folder.collapsed ? "Expand" : "Collapse", symbol: folder.collapsed ? "chevron.down" : "chevron.up" },
    { id: "up", title: "Move Up", enabled: index > 0 },
    { id: "down", title: "Move Down", enabled: index < s.folderOrder.length - 1 },
    sep,
    { id: "settings", title: "Live Folder Settings…", symbol: "gearshape" },
    { id: "delete", title: "Delete Live Folder", symbol: "trash" },
  ]);
  if (!choice) return;
  if (choice === "refresh") void refreshFolder(folderId);
  else if (choice.startsWith("filter:")) {
    const key = choice.slice(7) as "authored" | "reviewRequests";
    updateFolder(folderId, { filters: { ...folder.filters, [key]: !folder.filters[key] } });
    void refreshFolder(folderId);
  } else if (choice.startsWith("source:")) {
    const id = choice.slice(7) as LiveSourceId;
    if (!s.accounts[id]) return openSettings("liveFolders");
    const sources = folder.sources.includes(id) ? folder.sources.filter((x) => x !== id) : [...folder.sources, id];
    updateFolder(folderId, { sources: sources.length ? sources : folder.sources });
    void refreshFolder(folderId);
  } else if (choice === "rename") {
    const name = await prompt({ title: "Rename Live Folder", value: folder.name, placeholder: "Live folder name", confirmTitle: "Rename", windowId });
    if (name?.trim()) updateFolder(folderId, { name: name.trim() });
  } else if (choice === "icon") void openIconPicker(windowId, { kind: "live", id: `livefolder|${folderId}` });
  else if (choice === "read") markRead(folderId);
  else if (choice === "collapse") updateFolder(folderId, { collapsed: !folder.collapsed });
  else if (choice === "up") moveFolder(folderId, -1);
  else if (choice === "down") moveFolder(folderId, 1);
  else if (choice === "settings") openSettings("liveFolders");
  else if (choice === "delete") deleteLiveFolder(folderId);
}

export async function openLiveItemMenu(windowId: string, folderId: string, item: LiveItem, tabId: string | null) {
  const unread = !!live().unread[folderId]?.includes(item.id);
  const choice = await showMenu([
    { id: "open", title: tabId ? "Show Tab" : "Open", symbol: "arrow.up.forward.square" },
    { id: "background", title: "Open in Background", enabled: !tabId },
    sep,
    { id: "copy", title: "Copy Link", symbol: "link", key: "c", modifiers: ["shift", "command"] },
    { id: "copyMd", title: "Copy Link as Markdown", symbol: "text.badge.checkmark" },
    { id: "unread", title: unread ? "Mark as Read" : "Mark as Unread", symbol: unread ? "circle" : "circle.fill" },
    ...(tabId ? [sep, { id: "close", title: "Close Tab", symbol: "xmark", key: "w", modifiers: ["command" as const] }] : []),
  ]);
  if (choice === "open") openLiveItem(windowId, folderId, item);
  else if (choice === "background") openLiveItem(windowId, folderId, item, { background: true });
  else if (choice === "copy") copyText(cleanUrl(item.url));
  else if (choice === "copyMd") copyText(markdownLink(item.title, item.url));
  else if (choice === "unread") {
    if (unread) markRead(folderId, [item.id]);
    else setLive((s) => ({ unread: { ...s.unread, [folderId]: [...(s.unread[folderId] ?? []), item.id] } }));
  } else if (choice === "close" && tabId) void closeTab(tabId);
}

/** The Calendar submenu on a pinned calendar tab (Dia's "Calendar context menu"). */
export function calendarMenuItem(): MenuItem {
  const settings = live().calendar;
  const { calendars } = useCalendar.getState();
  const owned = calendars.filter((c) => c.owned);
  const others = calendars.filter((c) => !c.owned);
  const hidden = new Set(settings.hiddenCalendarIds);
  const calendarItems = (list: typeof calendars): MenuItem[] => list.map((c) => ({ id: `cal:toggle:${c.id}`, title: c.title, swatch: c.color, checked: !hidden.has(c.id) }));
  return {
    id: "cal",
    title: "Calendar",
    symbol: "calendar",
    children: [
      ...(calendarConnected() ? [] : [{ id: "cal:connect", title: "Connect Calendar…", symbol: "calendar.badge.plus" }, sep]),
      {
        id: "cal:alerts",
        title: "Show Next Meeting Alert",
        children: ALERT_LEADS.map((l) => ({ id: `cal:lead:${l.value}`, title: l.title, checked: settings.alertLead === l.value })),
      },
      { id: "cal:preview", title: "Show Calendar Preview", checked: settings.showPreview },
      { id: "cal:badge", title: "Show Time to Next Meeting", checked: settings.showTimeToNext },
      {
        id: "cal:active",
        title: "Active Calendars",
        enabled: calendars.length > 0,
        children: [
          ...(owned.length ? [{ id: "cal:h1", title: "My Calendars", enabled: false }, ...calendarItems(owned)] : []),
          ...(others.length ? [sep, { id: "cal:h2", title: "Other Calendars", enabled: false }, ...calendarItems(others)] : []),
        ],
      },
      sep,
      { id: "cal:settings", title: "Calendar Settings…", symbol: "gearshape" },
    ],
  };
}

export function runCalendarMenu(choice: string): boolean {
  if (!choice.startsWith("cal:")) return false;
  const settings = live().calendar;
  if (choice === "cal:connect") void connectCalendar();
  else if (choice.startsWith("cal:lead:")) updateCalendarSettings({ alertLead: choice.slice(9) });
  else if (choice === "cal:preview") updateCalendarSettings({ showPreview: !settings.showPreview });
  else if (choice === "cal:badge") updateCalendarSettings({ showTimeToNext: !settings.showTimeToNext });
  else if (choice.startsWith("cal:toggle:")) {
    const id = choice.slice(11);
    setCalendarHidden(id, !settings.hiddenCalendarIds.includes(id));
  } else if (choice === "cal:settings") openSettings("calendar");
  return true;
}
