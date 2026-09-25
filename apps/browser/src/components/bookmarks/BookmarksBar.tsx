import { cleanUrl } from "@netnyahoo/core";
import { ContextMenuArea, copyText, MouseArea, prompt, showMenu, Symbol, type MenuItem } from "@netnyahoo/shell";
import { useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, type LayoutRectangle } from "react-native";
import { useTheme } from "../../lib/theme";
import { folderChildren, folderLinks } from "../../store/bookmarks";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { bookmarkProfileId } from "../../store/model";
import type { BookmarkNode } from "../../store/types";
import { openInternalPage } from "../pages/urls";
import { Favicon, useHover } from "../primitives";
import { openImport } from "../settings/windows";
import { openFolder, openModeFor, openUrl } from "./actions";
import { editBookmark } from "./edit";

export const BOOKMARKS_BAR_HEIGHT = 30;
const ITEM_HEIGHT = 24;
const OVERFLOW_WIDTH = 28;

/**
 * The bookmarks bar under the toolbar (View › Show Bookmarks Bar: Always / On
 * New Tab Only / Never, ⇧⌘B). Items that don't fit move into the » menu.
 */
export function BookmarksBar({ tabId, placeholder }: { tabId: string; placeholder?: boolean }) {
  const windowId = useWindowId();
  const shown = useBookmarksBarShown(tabId);
  if (!shown) return null;
  // Hidden tabs keep the bar's height so switching to them doesn't resize the page.
  return placeholder ? <View style={{ height: BOOKMARKS_BAR_HEIGHT }} /> : <Bar windowId={windowId} />;
}

/** Whether the bar shows above this tab (Always / On New Tab Only / Never; never in incognito). */
export function useBookmarksBarShown(tabId: string): boolean {
  return useBrowser((s) => {
    const tab = s.tabs[tabId];
    const mode = s.settings.bookmarksBar;
    if (!tab || mode === "never" || s.windows[tab.windowId]?.incognito) return false;
    return mode === "always" || !tab.url;
  });
}

function Bar({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const profileId = useBrowser((s) => bookmarkProfileId(s, s.windows[windowId]));
  const barId = useBrowser((s) => s.bookmarks.roots[profileId]?.bar);
  const otherId = useBrowser((s) => s.bookmarks.roots[profileId]?.other);
  const children = useBrowser((s) => {
    const bar = barId ? s.bookmarks.nodes[barId] : undefined;
    return bar?.kind === "folder" ? bar.children : EMPTY;
  });
  const hasOther = useBrowser((s) => {
    const other = otherId ? s.bookmarks.nodes[otherId] : undefined;
    return other?.kind === "folder" && other.children.length > 0;
  });
  const hideImport = useBrowser((s) => s.settings.hideBookmarksBarImport);

  const [width, setWidth] = useState(0);
  const [frames, setFrames] = useState<Record<string, LayoutRectangle>>({});
  const [drop, setDrop] = useState<{ index: number; into: string | null } | null>(null);

  // Everything that ends past the available width goes into the overflow menu.
  const reserved = hasOther ? 150 : 0;
  const available = width - reserved;
  const fits = (id: string) => {
    const f = frames[id];
    return !f || f.x + f.width <= available - (overflowing() ? OVERFLOW_WIDTH : 0);
  };
  function overflowing() {
    const last = children.at(-1);
    const f = last ? frames[last] : undefined;
    return !!f && f.x + f.width > available;
  }
  const hidden = children.filter((id) => !fits(id));

  const dropAt = (id: string, dx: number): { index: number; into: string | null } | null => {
    const f = frames[id];
    if (!f || !barId) return null;
    const x = f.x + f.width / 2 + dx;
    const visible = children.filter((c) => frames[c] && fits(c));
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i]!;
      const r = frames[c]!;
      const node = useBrowser.getState().bookmarks.nodes[c];
      // The middle of a folder drops into it.
      if (c !== id && node?.kind === "folder" && x > r.x + r.width * 0.25 && x < r.x + r.width * 0.75) return { index: -1, into: c };
      if (x < r.x + r.width / 2) return { index: children.indexOf(c), into: null };
    }
    return { index: children.length, into: null };
  };

  const onDrop = (id: string, target: { index: number; into: string | null } | null) => {
    setDrop(null);
    if (!target || !barId) return;
    const s = useBrowser.getState();
    if (target.into) return s.moveBookmark(id, target.into);
    const from = children.indexOf(id);
    // Removing it first shifts later indexes down by one.
    s.moveBookmark(id, barId, target.index > from ? target.index - 1 : target.index);
  };

  const indicatorX = (() => {
    if (!drop || drop.into) return null;
    const id = children[drop.index];
    const f = id ? frames[id] : frames[children.at(-1) ?? ""];
    if (!f) return 8;
    return id ? f.x - 2 : f.x + f.width + 2;
  })();

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: BOOKMARKS_BAR_HEIGHT, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 }}
    >
      <ContextMenuArea onContextMenu={() => void openBarMenu(windowId, profileId, null)} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, height: ITEM_HEIGHT, flexDirection: "row", alignItems: "center", overflow: "hidden" }}>
        {children.length === 0 && !hideImport ? (
          <ImportButton />
        ) : children.length === 0 ? (
          <Text style={{ fontSize: 12, color: theme.textTertiary, marginLeft: 4 }}>For quick access, place your bookmarks here on the bookmarks bar.</Text>
        ) : (
          children.map((id) => (
            <BarItem
              key={id}
              id={id}
              windowId={windowId}
              profileId={profileId}
              hidden={!fits(id)}
              highlighted={drop?.into === id}
              onLayout={(r) => setFrames((prev) => (sameRect(prev[id], r) ? prev : { ...prev, [id]: r }))}
              onDragMove={(dx) => setDrop(dropAt(id, dx))}
              onDragEnd={(dx) => onDrop(id, dropAt(id, dx))}
            />
          ))
        )}
        {indicatorX !== null && (
          <View style={{ position: "absolute", left: indicatorX, top: 3, bottom: 3, width: 2, borderRadius: 1, backgroundColor: theme.accent }} />
        )}
      </View>
      {hidden.length > 0 && (
        <BarButton
          icon="chevron.right.2"
          tooltip="More bookmarks"
          onPress={(e) => void openFolderMenu(windowId, hidden, e)}
          width={OVERFLOW_WIDTH}
        />
      )}
      {hasOther && otherId && (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: StyleSheet.hairlineWidth * 2, height: 14, marginHorizontal: 6, backgroundColor: theme.divider }} />
          <BarButton
            icon="folder"
            title="Other Bookmarks"
            onPress={(e) => void openFolderMenu(windowId, folderChildren(useBrowser.getState().bookmarks, otherId).map((n) => n.id), e, otherId)}
          />
        </View>
      )}
    </View>
  );
}

const EMPTY: string[] = [];

const sameRect = (a: LayoutRectangle | undefined, b: LayoutRectangle) => !!a && a.x === b.x && a.width === b.width;

function BarItem({
  id,
  windowId,
  profileId,
  hidden,
  highlighted,
  onLayout,
  onDragMove,
  onDragEnd,
}: {
  id: string;
  windowId: string;
  profileId: string;
  hidden: boolean;
  highlighted: boolean;
  onLayout: (r: LayoutRectangle) => void;
  onDragMove: (dx: number) => void;
  onDragEnd: (dx: number) => void;
}) {
  const node = useBrowser((s) => s.bookmarks.nodes[id]);
  const dx = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const handlers = useRef({ onDragMove, onDragEnd });
  handlers.current = { onDragMove, onDragEnd };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4,
        onPanResponderGrant: () => setDragging(true),
        onPanResponderMove: (_, g) => {
          dx.setValue(g.dx);
          handlers.current.onDragMove(g.dx);
        },
        onPanResponderRelease: (_, g) => {
          dx.setValue(0);
          setDragging(false);
          handlers.current.onDragEnd(g.dx);
        },
        onPanResponderTerminate: () => {
          dx.setValue(0);
          setDragging(false);
          handlers.current.onDragMove(0);
          handlers.current.onDragEnd(0);
        },
      }),
    [],
  );
  if (!node) return null;
  const open = (e: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean }) =>
    node.kind === "url" ? openUrl(node.url, windowId, openModeFor(e)) : void openFolderMenu(windowId, node.children, undefined, node.id);

  return (
    <Animated.View
      {...responder.panHandlers}
      onLayout={(e) => onLayout(e.nativeEvent.layout)}
      pointerEvents={hidden ? "none" : "auto"}
      style={{ opacity: hidden ? 0 : dragging ? 0.85 : 1, zIndex: dragging ? 10 : 0, transform: [{ translateX: dx }] }}
    >
      <ContextMenuArea onContextMenu={() => void openBarMenu(windowId, profileId, node)}>
        <MouseArea onMiddleClick={(e) => open({ ...e, middle: true })}>
          <BarButton
            favicon={node.kind === "url" ? node : undefined}
            icon={node.kind === "folder" ? "folder" : undefined}
            title={node.title || (node.kind === "url" ? node.url : "")}
            tooltip={node.kind === "url" ? `${node.title}\n${node.url}` : node.title}
            highlighted={highlighted}
            onPress={(e) => open(e)}
          />
        </MouseArea>
      </ContextMenuArea>
    </Animated.View>
  );
}

type ClickMods = { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

function BarButton({
  title,
  icon,
  favicon,
  tooltip,
  onPress,
  width,
  highlighted,
}: {
  title?: string;
  icon?: string;
  favicon?: { url: string; favicon: string | null };
  tooltip?: string;
  onPress: (e: ClickMods) => void;
  width?: number;
  highlighted?: boolean;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const windowId = useWindowId();
  // Icons of pages without a tab are fetched through the bookmarks' own profile.
  const profileId = useBrowser((s) => bookmarkProfileId(s, s.windows[windowId]));
  return (
    <View {...hoverProps} tooltip={tooltip}>
      <Pressable onPress={(e) => onPress(e.nativeEvent as unknown as ClickMods)}>
        {({ pressed }) => (
          <View
            style={{
              height: ITEM_HEIGHT,
              width,
              maxWidth: 190,
              borderRadius: 6,
              paddingHorizontal: title ? 7 : 0,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              backgroundColor: pressed ? theme.toolbarPressed : hovered || highlighted ? theme.toolbarHover : undefined,
            }}
          >
            {favicon ? (
              <Favicon url={favicon.url} favicon={favicon.favicon} size={14} profileId={profileId} />
            ) : icon ? (
              <Symbol name={icon} size={12} color={theme.icon} style={{ width: 16, height: 16 }} />
            ) : null}
            {title ? (
              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: theme.textTab }}>
                {title}
              </Text>
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

/** Dia's empty-bar button: "Import bookmarks" (right-click to hide it). */
function ImportButton() {
  return (
    <ContextMenuArea
      onContextMenu={async () => {
        const choice = await showMenu([{ id: "hide", title: "Hide Import Bookmarks Button" }]);
        if (choice === "hide") useBrowser.getState().updateSettings({ hideBookmarksBarImport: true });
      }}
    >
      <BarButton icon="rectangle.portrait.and.arrow.right" title="Import bookmarks" tooltip="Add bookmarks from another browser" onPress={() => openImport()} />
    </ContextMenuArea>
  );
}

/** A folder (or the overflow) as a native menu; submenus for nested folders. */
async function openFolderMenu(windowId: string, ids: string[], _e?: ClickMods, folderId?: string) {
  const b = useBrowser.getState().bookmarks;
  const build = (list: string[], parent?: string, depth = 0): MenuItem[] => {
    const items: MenuItem[] = list
      .map((id) => b.nodes[id])
      .filter((n): n is BookmarkNode => !!n)
      .map((n) =>
        n.kind === "url"
          ? { id: `open:${n.id}`, title: n.title || n.url, symbol: "globe" }
          : { id: `folder:${n.id}`, title: n.title, symbol: "folder", children: depth < 8 ? build(n.children, n.id, depth + 1) : [] },
      );
    if (!items.length) items.push({ id: "empty", title: "Empty", enabled: false });
    const links = parent ? folderLinks(b, parent).length : 0;
    if (links > 0) {
      items.push(
        { separator: true },
        { id: `openAll:${parent}`, title: `Open All (${links})` },
        { id: `openAllWindow:${parent}`, title: "Open All in New Window" },
        { id: `openAllIncognito:${parent}`, title: "Open All in Incognito Window" },
      );
    }
    return items;
  };
  const choice = await showMenu(build(ids, folderId));
  if (!choice) return;
  const [action, id] = splitChoice(choice);
  const node = id ? useBrowser.getState().bookmarks.nodes[id] : undefined;
  if (action === "open" && node?.kind === "url") openUrl(node.url, windowId, "current");
  if (action === "openAll" && id) void openFolder(id, windowId, "tabs");
  if (action === "openAllWindow" && id) void openFolder(id, windowId, "window");
  if (action === "openAllIncognito" && id) void openFolder(id, windowId, "incognito");
}

const splitChoice = (choice: string): [string, string] => {
  const i = choice.indexOf(":");
  return i < 0 ? [choice, ""] : [choice.slice(0, i), choice.slice(i + 1)];
};

/** Right-click on the bar or an item (Chrome/Dia's bookmark context menu). */
async function openBarMenu(windowId: string, profileId: string, node: BookmarkNode | null) {
  const s = useBrowser.getState();
  const barMode = s.settings.bookmarksBar;
  const items: MenuItem[] = [];
  if (node?.kind === "url") {
    items.push(
      { id: "tab", title: "Open in New Tab" },
      { id: "window", title: "Open in New Window" },
      { id: "incognito", title: "Open in Incognito Window" },
      { id: "split", title: "Open in Split View" },
      { separator: true },
      { id: "edit", title: "Edit…" },
      { id: "copy", title: "Copy Link" },
      { id: "delete", title: "Delete" },
      { separator: true },
    );
  } else if (node?.kind === "folder") {
    const n = folderLinks(s.bookmarks, node.id).length;
    items.push(
      { id: "openAll", title: `Open All (${n})`, enabled: n > 0 },
      { id: "openAllWindow", title: "Open All in New Window", enabled: n > 0 },
      { id: "openAllIncognito", title: "Open All in Incognito Window", enabled: n > 0 },
      { separator: true },
      { id: "rename", title: "Rename…" },
      { id: "delete", title: "Delete" },
      { separator: true },
    );
  }
  items.push(
    { id: "addPage", title: "Add Page…" },
    { id: "addFolder", title: "Add Folder…" },
    { separator: true },
    { id: "manage", title: "Manage Bookmarks" },
    {
      id: "show",
      title: "Show Bookmarks Bar",
      children: [
        { id: "bar:always", title: "Always", checked: barMode === "always" },
        { id: "bar:newTab", title: "On New Tab Only", checked: barMode === "newTab" },
        { id: "bar:never", title: "Never", checked: barMode === "never" },
      ],
    },
  );
  const choice = await showMenu(items);
  if (!choice) return;
  const bar = s.bookmarks.roots[profileId]?.bar;
  if (node?.kind === "url") {
    if (choice === "tab") openUrl(node.url, windowId, "foreground");
    if (choice === "window") openUrl(node.url, windowId, "window");
    if (choice === "incognito") openUrl(node.url, windowId, "incognito");
    if (choice === "split") openUrl(node.url, windowId, "split");
    if (choice === "edit") void editBookmark(node.id, windowId);
    if (choice === "copy") copyText(cleanUrl(node.url));
  }
  if (node?.kind === "folder") {
    if (choice === "openAll") void openFolder(node.id, windowId, "tabs");
    if (choice === "openAllWindow") void openFolder(node.id, windowId, "window");
    if (choice === "openAllIncognito") void openFolder(node.id, windowId, "incognito");
    if (choice === "rename") void editBookmark(node.id, windowId);
  }
  if (choice === "delete" && node) useBrowser.getState().removeBookmark(node.id);
  // New items go after the one right-clicked, or at the end of the bar.
  const parentId = node?.parentId ?? bar;
  const index = node && parentId ? (folderChildren(useBrowser.getState().bookmarks, parentId).findIndex((n) => n.id === node.id) + 1) : undefined;
  if (choice === "addPage") void editBookmark(null, windowId, { profileId, parentId: parentId ?? undefined, index });
  if (choice === "addFolder") {
    const title = await prompt({ title: "New Folder", placeholder: "Folder name", confirmTitle: "Create", windowId });
    if (title) useBrowser.getState().addBookmarkFolder({ profileId, title, parentId: parentId ?? undefined, index });
  }
  if (choice === "manage") openInternalPage("bookmarks", windowId);
  if (choice.startsWith("bar:")) useBrowser.getState().updateSettings({ bookmarksBar: choice.slice(4) as typeof barMode });
}
