import { showMenu, type MenuItem } from "@netnyahoo/shell";
import { closeTab, moveTabToProfile, moveTabToWindow, switchToTab, toggleMute } from "../../lib/actions";
import { folderChildren } from "../../store/bookmarks";
import { useBrowser } from "../../store/browser";
import { bookmarkProfileId, isIncognitoProfile, plural, tabLabel, viewTabIds, windowTitle } from "../../store/model";
import { awayFromPin, groupLabel, groupOf, selectedTabIds } from "../../store/organize";
import { splitOf } from "../../store/splits";
import type { GroupColor, Tab } from "../../store/types";
import {
  allMuted,
  bookmarkTabs,
  copyUrls,
  editPinnedPage,
  muteAll,
  newGroupWithSelection,
  openIconPicker,
  startRename,
  tabTitle,
} from "./actions";
import { isCalendarUrl } from "../../live/meetings";
import { bookmarkTab } from "../bookmarks/actions";
import { calendarMenuItem, newLiveFolderMenuItem, runCalendarMenu, runNewLiveFolder } from "./liveMenus";
import { setSidebarUi } from "./state";
import { GROUP_COLORS, nearestGroupColor } from "./tokens";

/**
 * The sidebar's context menus, after Dia's (tab, multi-selection, group, empty
 * space) and its overflow menu. Shortcut hints match the menu bar.
 */
const store = () => useBrowser.getState();
const sep = { separator: true } as const;
type Mods = NonNullable<Extract<MenuItem, { id: string }>["modifiers"]>;
const hint = (key: string, ...modifiers: Mods) => ({ key, modifiers });

function bookmarkFolderItems(windowId: string, prefix: string): MenuItem[] {
  const s = store();
  const roots = s.bookmarks.roots[bookmarkProfileId(s, s.windows[windowId])];
  const folders = roots
    ? [...folderChildren(s.bookmarks, roots.bar), ...folderChildren(s.bookmarks, roots.other)].filter((n) => n.kind === "folder")
    : [];
  return [
    { id: `${prefix}bar`, title: "Bookmarks Bar", symbol: "menubar.rectangle" },
    ...(roots ? [{ id: `${prefix}${roots.other}`, title: "Other Bookmarks", symbol: "folder" }] : []),
    ...folders.map((f) => ({ id: `${prefix}${f.id}`, title: f.title, symbol: "folder" })),
    sep,
    { id: `${prefix}new`, title: "New Folder…", symbol: "folder.badge.plus" },
  ];
}

function moveToWindowItems(windowId: string): MenuItem[] {
  const s = store();
  const others = s.windowOrder.filter((id) => id !== windowId && !s.windows[id]!.incognito);
  return [
    ...others.map((id) => ({ id: `window:${id}`, title: windowTitle(s, id) })),
    ...(others.length ? [sep] : []),
    { id: "window:new", title: "New Window" },
  ];
}

function moveToGroupItems(windowId: string, exclude: string | undefined): MenuItem[] {
  const s = store();
  const w = s.windows[windowId];
  const groups = Object.values(s.groups).filter((g) => g.windowId === windowId && g.profileId === w?.profileId && g.id !== exclude);
  return groups.map((g) => ({ id: `group:${g.id}`, title: groupLabel(s, g), symbol: g.pinned ? "pin" : "square.on.square" }));
}

/** Right-click on a tab (or on one of several selected tabs). */
export async function openTabMenu(windowId: string, tab: Tab) {
  const s = store();
  const selected = selectedTabIds(s, windowId);
  // Right-clicking outside the selection resets it (Dia 1.2x).
  if (selected.length > 1 && selected.includes(tab.id)) return openMultiMenu(windowId, selected);
  if (s.selection[windowId]?.length) s.setSelection(windowId, []);

  const view = viewTabIds(s, windowId);
  const list = view.filter((id) => !s.tabs[id]!.pinned);
  const index = list.indexOf(tab.id);
  const above = tab.pinned ? [] : list.slice(0, index);
  const below = tab.pinned ? [] : list.slice(index + 1);
  const others = list.filter((id) => id !== tab.id);
  const group = groupOf(s, tab.id);
  const split = splitOf(s, tab.id);
  const incognito = isIncognitoProfile(tab.profileId);
  // The top strip runs left to right (Dia: Close Tabs to the Left / Right).
  const across = (s.windows[windowId]?.tabLayout ?? s.settings.tabLayout) === "top";
  const away = awayFromPin(tab);
  const moveToProfile: MenuItem[] = [
    ...s.profileOrder.map((id) => ({ id: `profile:${id}`, title: s.profiles[id]!.name, checked: id === tab.profileId, enabled: id !== tab.profileId })),
    sep,
    { id: "profile:new", title: "New Profile…" },
  ];
  const groups = moveToGroupItems(windowId, group?.id);

  const choice = await showMenu([
    ...(tab.pinned
      ? [
          { id: "backToPin", title: "Back to Pinned URL", symbol: "arrow.uturn.backward", enabled: away, ...hint("\r", "command") },
          { id: "replacePin", title: "Replace Pin with Current Page", symbol: "pin", enabled: away },
          { id: "editPin", title: "Edit Pinned Page…", symbol: "pencil" },
          // Live Calendar on a pinned calendar (src/live).
          ...(isCalendarUrl(tab.pinnedUrl ?? tab.url) ? [calendarMenuItem()] : []),
          sep,
        ]
      : []),
    { id: "rename", title: "Rename…", symbol: "character.cursor.ibeam" },
    ...(tab.customTitle ? [{ id: "resetName", title: "Reset Name", symbol: "arrow.counterclockwise" }] : []),
    { id: "icon", title: "Change Icon…", symbol: "face.smiling" },
    ...(tab.customIcon ? [{ id: "resetIcon", title: "Reset Icon", symbol: "arrow.counterclockwise" }] : []),
    sep,
    { id: "pin", title: tab.pinned ? "Unpin" : "Pin", symbol: tab.pinned ? "pin.slash" : "pin" },
    { id: "duplicate", title: "Duplicate", symbol: "plus.square.on.square" },
    ...(tab.pinned
      ? []
      : [
          group
            ? { id: "ungroupTab", title: "Remove from Group", symbol: "folder.badge.minus" }
            : { id: "newGroup", title: "New Group with Tab", symbol: "plus.rectangle.on.rectangle", ...hint("n", "control", "command") },
          ...(groups.length ? [{ id: "moveToGroup", title: "Move to Group", symbol: "rectangle.stack", children: groups }] : []),
        ]),
    ...(split ? [{ id: "unsplit", title: "Remove from Split View", symbol: "rectangle.split.2x1.slash" }] : []),
    sep,
    { id: "mute", title: tab.muted ? "Unmute Site" : "Mute Site", symbol: tab.muted ? "speaker.wave.2" : "speaker.slash", enabled: !!tab.url },
    { id: "copy", title: "Copy URL", symbol: "link", enabled: !!tab.url, ...hint("c", "shift", "command") },
    { id: "copyMd", title: "Copy Link as Markdown", symbol: "text.badge.checkmark", enabled: !!tab.url, ...hint("c", "option", "shift", "command") },
    { id: "bookmark", title: "Add to Bookmarks…", symbol: "bookmark", enabled: !!tab.url, ...hint("d", "command") },
    { id: "bookmarkTo", title: "Add Bookmark to Folder", symbol: "folder", enabled: !!tab.url, children: bookmarkFolderItems(windowId, "folder:") },
    sep,
    { id: "moveToProfile", title: "Move to Profile", symbol: "person.crop.circle", enabled: !incognito, children: moveToProfile },
    { id: "moveToWindow", title: "Move to Window", symbol: "macwindow", enabled: !incognito, children: moveToWindowItems(windowId) },
    sep,
    { id: "close", title: "Close Tab", symbol: "xmark", ...hint("w", "command") },
    { id: "closeOthers", title: "Close Other Tabs", enabled: others.length > 0 },
    { id: "closeAbove", title: across ? "Close Tabs to the Left" : "Close Tabs Above", enabled: above.length > 0 },
    { id: "closeBelow", title: across ? "Close Tabs to the Right" : "Close Tabs Below", enabled: below.length > 0 },
  ]);
  if (!choice) return;
  const t = { kind: "tab" as const, id: tab.id };
  if (runCalendarMenu(choice)) return;
  if (choice === "backToPin") s.returnToPinnedUrl(tab.id);
  else if (choice === "replacePin") s.setPinnedUrl(tab.id);
  else if (choice === "editPin") void editPinnedPage(windowId, tab.id);
  else if (choice === "rename") void startRename(windowId, t);
  else if (choice === "resetName") s.updateTab(tab.id, { customTitle: null });
  else if (choice === "icon") void openIconPicker(windowId, t);
  else if (choice === "resetIcon") s.updateTab(tab.id, { customIcon: null });
  else if (choice === "pin") s.togglePin(tab.id);
  else if (choice === "duplicate") s.duplicateTab(tab.id);
  else if (choice === "ungroupTab") s.removeTabsFromGroup([tab.id]);
  else if (choice === "newGroup") newGroupWithSelection(windowId, [tab.id]);
  else if (choice.startsWith("group:")) s.placeTabs([tab.id], { pinned: false, groupId: choice.slice(6) });
  else if (choice === "unsplit") s.removeTabFromSplit(tab.id);
  else if (choice === "mute") toggleMute(tab.id);
  else if (choice === "copy") copyUrls([tab.id], false);
  else if (choice === "copyMd") copyUrls([tab.id], true);
  // Like ⌘D: bookmarks the page (or finds its bookmark) and opens the dialog; never removes one.
  else if (choice === "bookmark") bookmarkTab(windowId, tab.id);
  else if (choice.startsWith("folder:")) void bookmarkTabs(windowId, [tab.id], choice.slice(7));
  else if (choice.startsWith("profile:")) void moveTabToProfile(tab.id, choice.slice(8));
  else if (choice.startsWith("window:")) moveTabToWindow(tab.id, choice.slice(7));
  else if (choice === "close") void closeTab(tab.id);
  else if (choice === "closeOthers") s.closeTabs(others);
  else if (choice === "closeAbove") s.closeTabs(above);
  else if (choice === "closeBelow") s.closeTabs(below);
}

/** Right-click on a multi-selection: bulk actions. */
async function openMultiMenu(windowId: string, ids: string[]) {
  const s = store();
  const n = ids.length;
  const tabs = ids.map((id) => s.tabs[id]!);
  const allPinned = tabs.every((t) => t.pinned);
  const incognito = tabs.some((t) => isIncognitoProfile(t.profileId));
  const groups = moveToGroupItems(windowId, undefined);
  const choice = await showMenu([
    { id: "pin", title: allPinned ? `Unpin ${n} Tabs` : `Pin ${n} Tabs`, symbol: allPinned ? "pin.slash" : "pin" },
    { id: "duplicate", title: `Duplicate ${n} Tabs`, symbol: "plus.square.on.square" },
    { id: "newGroup", title: `New Group with ${n} Tabs`, symbol: "plus.rectangle.on.rectangle", enabled: !allPinned, ...hint("n", "control", "command") },
    ...(groups.length ? [{ id: "moveToGroup", title: "Move to Group", symbol: "rectangle.stack", children: groups }] : []),
    ...(tabs.some((t) => groupOf(s, t.id)) ? [{ id: "ungroup", title: "Remove from Group", symbol: "folder.badge.minus" }] : []),
    sep,
    { id: "copy", title: `Copy ${n} URLs`, symbol: "link", ...hint("c", "shift", "command") },
    { id: "copyMd", title: `Copy ${n} URLs as Markdown`, symbol: "text.badge.checkmark", ...hint("c", "option", "shift", "command") },
    { id: "bar", title: `Add ${n} Tabs to Bookmarks Bar`, symbol: "bookmark" },
    { id: "bookmarkTo", title: `Add ${n} Tabs to Bookmarks Folder`, symbol: "folder", children: bookmarkFolderItems(windowId, "folder:") },
    sep,
    { id: "moveToWindow", title: "Move to Window", symbol: "macwindow", enabled: !incognito, children: moveToWindowItems(windowId) },
    sep,
    { id: "close", title: `Close ${n} Tabs`, symbol: "xmark", ...hint("w", "command") },
  ]);
  if (!choice) return;
  if (choice === "pin") s.pinTabs(ids, !allPinned);
  else if (choice === "duplicate") ids.forEach((id) => store().duplicateTab(id));
  else if (choice === "newGroup") newGroupWithSelection(windowId, ids);
  else if (choice.startsWith("group:")) s.placeTabs(ids, { pinned: false, groupId: choice.slice(6) });
  else if (choice === "ungroup") s.removeTabsFromGroup(ids);
  else if (choice === "copy") copyUrls(ids, false);
  else if (choice === "copyMd") copyUrls(ids, true);
  else if (choice === "bar") void bookmarkTabs(windowId, ids, "bar");
  else if (choice.startsWith("folder:")) void bookmarkTabs(windowId, ids, choice.slice(7));
  else if (choice.startsWith("window:")) {
    const target = store().moveTabsToWindow(ids, choice === "window:new" ? null : choice.slice(7));
    if (target) switchToTab(store().windows[target]?.activeTabIds[tabs[0]!.profileId] ?? ids[0]!);
  } else if (choice === "close") s.closeTabs(ids);
  if (choice !== "copy" && choice !== "copyMd") store().setSelection(windowId, []);
}

/** Right-click on a group's header. */
export async function openGroupMenu(windowId: string, groupId: string) {
  const s = store();
  const g = s.groups[groupId];
  if (!g) return;
  const colors: GroupColor[] = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
  // Dia takes a group's colour from its site (favicon / theme colour); we use the page's theme colour.
  const siteColor = g.tabIds.map((id) => s.live[id]?.themeColor).find(Boolean);
  const matched = siteColor ? nearestGroupColor(siteColor) : null;
  const choice = await showMenu([
    { id: "rename", title: "Rename…", symbol: "character.cursor.ibeam" },
    { id: "icon", title: g.icon ? "Change Icon…" : "Add Icon…", symbol: "face.smiling" },
    {
      id: "color",
      title: "Color",
      symbol: "paintpalette",
      children: [
        { id: "color:", title: "Neutral", checked: !g.color },
        { id: `color:${matched ?? ""}`, title: "Match Site Color", enabled: !!matched, swatch: matched ? GROUP_COLORS[matched].hex : undefined },
        sep,
        ...colors.map((c) => ({ id: `color:${c}`, title: GROUP_COLORS[c].name, swatch: GROUP_COLORS[c].hex, checked: g.color === c })),
      ],
    },
    sep,
    { id: "newTab", title: "New Tab in Group", symbol: "plus", ...hint("t", "option", "command") },
    { id: "pin", title: g.pinned ? "Unpin Group" : "Pin Group", symbol: g.pinned ? "pin.slash" : "pin" },
    { id: "duplicate", title: "Duplicate Group", symbol: "plus.square.on.square" },
    { id: "collapse", title: g.collapsed ? "Expand Group" : "Collapse Group", symbol: g.collapsed ? "chevron.down" : "chevron.up" },
    sep,
    { id: "copy", title: "Copy All Links", symbol: "link" },
    { id: "copyMd", title: "Copy All Links as Markdown", symbol: "text.badge.checkmark" },
    sep,
    { id: "ungroup", title: "Ungroup", symbol: "folder.badge.minus" },
    { id: "bookmarkBar", title: "Move to Bookmark Bar", symbol: "bookmark" },
    { id: "close", title: "Close Group", symbol: "xmark" },
  ]);
  if (!choice) return;
  const target = { kind: "group" as const, id: groupId };
  if (choice === "rename") void startRename(windowId, target);
  else if (choice === "icon") void openIconPicker(windowId, target);
  else if (choice.startsWith("color:")) s.updateGroup(groupId, { color: (choice.slice(6) || null) as GroupColor | null });
  else if (choice === "newTab") {
    const id = s.newTabInGroup(groupId);
    if (id) store().activate(id);
  }
  else if (choice === "pin") s.moveGroup(groupId, { pinned: !g.pinned });
  else if (choice === "duplicate") s.duplicateGroup(groupId);
  else if (choice === "collapse") s.updateGroup(groupId, { collapsed: !g.collapsed });
  else if (choice === "copy") copyUrls(g.tabIds, false);
  else if (choice === "copyMd") copyUrls(g.tabIds, true);
  else if (choice === "ungroup") s.ungroup(groupId);
  else if (choice === "bookmarkBar") s.moveGroupToBookmarksBar(groupId);
  else if (choice === "close") s.closeGroup(groupId);
}

/** Right-click on empty sidebar space. */
export async function openSidebarMenu(windowId: string) {
  const s = store();
  const muted = allMuted(windowId);
  const choice = await showMenu([
    { id: "newTab", title: "New Tab", symbol: "plus", ...hint("t", "command") },
    { id: "search", title: "Search Tabs…", symbol: "magnifyingglass", ...hint("a", "shift", "command") },
    sep,
    { id: "clean", title: "Clean Up Tabs", symbol: "wand.and.stars", ...hint("k", "option", "command") },
    { id: "mute", title: muted ? "Unmute All Tabs" : "Mute All Tabs", symbol: muted ? "speaker.wave.2" : "speaker.slash" },
    { id: "closeAll", title: "Close All Tabs", symbol: "xmark", ...hint("k", "shift", "command") },
    sep,
    newLiveFolderMenuItem(),
  ]);
  if (choice && runNewLiveFolder(windowId, choice)) return;
  if (choice === "newTab") s.newTab(windowId);
  else if (choice === "search") setSidebarUi({ searchTabs: windowId });
  else if (choice === "clean") s.cleanUpTabs(windowId);
  else if (choice === "mute") muteAll(windowId, !muted);
  else if (choice === "closeAll") closeAllTabs(windowId);
}

/** ⇧⌘K: every regular tab of the window's profile (pinned tabs and pinned groups stay). */
export function closeAllTabs(windowId: string) {
  const s = store();
  const pinnedGroup = new Set(Object.values(s.groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
  s.closeTabs(viewTabIds(s, windowId).filter((id) => !s.tabs[id]!.pinned && !pinnedGroup.has(id)));
}

/** The chevron at the bottom of the sidebar: open tabs, recently closed / cleaned, clean up. */
export async function openOverflowMenu(windowId: string) {
  const s = store();
  const w = s.windows[windowId];
  if (!w) return;
  const muted = allMuted(windowId);
  const open = viewTabIds(s, windowId).map((id) => s.tabs[id]!);
  const closed = [
    ...s.closedTabs
      .filter((c) => c.tab.profileId === w.profileId)
      .map((c) => ({ id: `restore:${c.id}`, title: c.tab.customTitle || c.tab.title || tabLabel(c.tab), symbol: "clock.arrow.circlepath", at: c.closedAt })),
    ...s.closedGroups.map((c) => ({ id: `restore:${c.id}`, title: `${c.group.name} (${plural(c.tabs.length, "Tab")})`, symbol: "rectangle.stack", at: c.closedAt })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 15)
    .map(({ at: _, ...item }) => item);
  const cleaned = [...s.cleanedTabs].reverse().slice(0, 20);
  const daily = s.settings.cleanUpInactiveTabsAfterHours !== null;
  const choice = await showMenu([
    { id: "search", title: "Search Tabs…", symbol: "magnifyingglass", ...hint("a", "shift", "command") },
    sep,
    {
      id: "open",
      title: "Open Tabs",
      symbol: "square.stack",
      enabled: open.length > 0,
      children: open.map((t) => ({ id: `tab:${t.id}`, title: tabTitle(t), checked: w.activeTabIds[w.profileId] === t.id })),
    },
    { id: "closed", title: "Recently Closed", symbol: "clock.arrow.circlepath", enabled: closed.length > 0, children: closed.length ? closed : [{ id: "none", title: "Empty", enabled: false }] },
    {
      id: "cleaned",
      title: "Recently Cleaned",
      symbol: "wand.and.stars",
      enabled: cleaned.length > 0,
      children: cleaned.length
        ? [
            ...cleaned.map((c) => ({ id: `cleaned:${c.id}`, title: c.tab.customTitle || c.tab.title || tabLabel(c.tab) })),
            sep,
            { id: "restoreAll", title: `Restore ${plural(s.cleanedTabs.length, "Tab")}` },
          ]
        : [{ id: "none", title: "Empty", enabled: false }],
    },
    sep,
    { id: "clean", title: "Clean Up Tabs", symbol: "wand.and.stars", ...hint("k", "option", "command") },
    { id: "daily", title: "Clean Up Daily", checked: daily },
    sep,
    { id: "mute", title: muted ? "Unmute All Tabs" : "Mute All Tabs", symbol: muted ? "speaker.wave.2" : "speaker.slash" },
    { id: "closeAll", title: "Close All Tabs", symbol: "xmark", ...hint("k", "shift", "command") },
  ]);
  if (!choice) return;
  if (choice === "search") setSidebarUi({ searchTabs: windowId });
  else if (choice.startsWith("tab:")) switchToTab(choice.slice(4));
  else if (choice.startsWith("restore:")) s.restoreClosed(choice.slice(8), windowId);
  else if (choice.startsWith("cleaned:")) s.restoreCleaned(choice.slice(8));
  else if (choice === "restoreAll") s.restoreCleaned();
  else if (choice === "clean") s.cleanUpTabs(windowId);
  else if (choice === "daily") s.updateSettings({ cleanUpInactiveTabsAfterHours: daily ? null : 24 });
  else if (choice === "mute") muteAll(windowId, !muted);
  else if (choice === "closeAll") closeAllTabs(windowId);
}
