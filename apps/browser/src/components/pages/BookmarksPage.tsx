import { cleanUrl } from "@netnyahoo/core";
import { ContextMenuArea, copyText, MouseArea, showMenu, Symbol, type MenuItem } from "@netnyahoo/shell";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { bookmarkAncestors, folderChildren, folderLinks, type RemovedBookmarks } from "../../store/bookmarks";
import { useBrowser } from "../../store/browser";
import { plural } from "../../store/model";
import type { BookmarkNode } from "../../store/types";
import { openFolder, openModeFor, openUrl } from "../bookmarks/actions";
import { editBookmark } from "../bookmarks/edit";
import { FolderTree } from "../bookmarks/FolderTree";
import { Favicon, IconButton, useHover } from "../primitives";
import { Button, useFormColors } from "../settings/controls";
import { openImport } from "../settings/windows";
import { DropTargets } from "./dropTargets";
import { EmptyState, hostLabel, matchesQuery, PageHeader } from "./PageLayout";

const ROW = 36;

type Target = { kind: "folder"; id: string } | { kind: "row"; id: string; index: number; folder: boolean };
type Drop = { into: string } | { parentId: string; index: number };

/** The Bookmarks manager (⌥⌘B): folder tree, contents, search, drag and drop, bulk delete with undo. */
export function BookmarksPage({ tabId, profileId }: { tabId: string; profileId: string }) {
  const theme = useTheme();
  const colors = useFormColors();
  const windowId = useBrowser((s) => s.tabs[tabId]?.windowId ?? "");
  const roots = useBrowser((s) => s.bookmarks.roots[profileId]);
  const [folderId, setFolderId] = useState<string | null>(roots?.bar ?? null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ removed: RemovedBookmarks; count: number } | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const anchor = useRef<string | null>(null);
  const targets = useMemo(() => new DropTargets<Target>(), []);

  // The selected folder may be deleted (here or from the bar).
  const folderExists = useBrowser((s) => !!folderId && s.bookmarks.nodes[folderId]?.kind === "folder");
  useEffect(() => {
    if (!folderExists && roots) setFolderId(roots.bar);
  }, [folderExists, roots]);
  useEffect(() => setSelected([]), [folderId, query]);

  const folderTitle = useBrowser((s) => (folderId ? (s.bookmarks.nodes[folderId]?.title ?? "") : ""));
  // Search covers the whole profile tree; otherwise the selected folder's children.
  const listKey = useBrowser((s) => {
    if (query.trim() && roots) {
      const all = [...folderLinksAndFolders(s.bookmarks, roots.bar), ...folderLinksAndFolders(s.bookmarks, roots.other)];
      return all
        .filter((n) => matchesQuery(query, n.title, n.kind === "url" ? n.url : ""))
        .map((n) => n.id)
        .join(",");
    }
    const folder = folderId ? s.bookmarks.nodes[folderId] : undefined;
    return folder?.kind === "folder" ? folder.children.join(",") : "";
  });
  const ids = useMemo(() => (listKey ? listKey.split(",") : []), [listKey]);
  const searching = !!query.trim();

  const select = (id: string, e: { metaKey?: boolean; shiftKey?: boolean }) => {
    if (e.shiftKey && anchor.current && ids.includes(anchor.current)) {
      const [a, b] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((x, y) => x - y);
      setSelected(ids.slice(a!, b! + 1));
      return;
    }
    anchor.current = id;
    if (e.metaKey) setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    else setSelected([id]);
  };

  const remove = (list: string[]) => {
    if (!list.length) return;
    const removed = useBrowser.getState().removeBookmarks(list);
    setSelected([]);
    setUndo({ removed, count: removed.places.length });
  };
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(timer);
  }, [undo]);

  // MARK: Drag and drop

  const dragging = useRef<string[]>([]);
  const onDragStart = (id: string) => {
    dragging.current = selected.includes(id) ? ids.filter((x) => selected.includes(x)) : [id];
    targets.measure();
  };
  const dropFor = (x: number, y: number): Drop | null => {
    const hit = targets.hit(x, y);
    if (!hit || !folderId) return null;
    const t = hit.data;
    if (t.kind === "folder") return dragging.current.includes(t.id) ? null : { into: t.id };
    if (t.folder && hit.fraction > 0.25 && hit.fraction < 0.75 && !dragging.current.includes(t.id)) return { into: t.id };
    if (searching) return null;
    return { parentId: folderId, index: hit.fraction < 0.5 ? t.index : t.index + 1 };
  };
  const onDragMove = (x: number, y: number) => {
    const next = dropFor(x, y);
    setDrop((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  };
  const onDragEnd = (x: number, y: number) => {
    const target = dropFor(x, y);
    setDrop(null);
    if (!target) return;
    const s = useBrowser.getState();
    const moving = dragging.current;
    if ("into" in target) return moving.forEach((id) => s.moveBookmark(id, target.into));
    // Indexes before the drop point shift down as the dragged rows leave.
    let index = target.index;
    for (const id of moving) {
      const from = ids.indexOf(id);
      if (from >= 0 && from < target.index) index--;
    }
    moving.forEach((id, i) => useBrowser.getState().moveBookmark(id, target.parentId, index + i));
  };

  const addMenu = async () => {
    const choice = await showMenu([
      { id: "bookmark", title: "Add New Bookmark…" },
      { id: "folder", title: "Add New Folder…" },
      { separator: true },
      { id: "import", title: "Import Bookmarks…" },
    ]);
    const parentId = folderId ?? undefined;
    if (choice === "bookmark") editBookmark(null, windowId, { profileId, parentId });
    if (choice === "folder") editBookmark(null, windowId, { profileId, parentId, folder: true });
    if (choice === "import") openImport();
  };

  const actions =
    selected.length > 0 ? (
      <>
        <Text style={{ fontSize: 12, color: theme.textSecondary }}>{`${selected.length} selected`}</Text>
        <Button title="Delete" kind="primary" onPress={() => remove(selected)} />
      </>
    ) : (
      <IconButton icon="ellipsis.circle" size={15} box={30} radius={7} onPress={() => void addMenu()} tooltip="Organize" />
    );

  const indicator = drop && "index" in drop ? drop.index : null;

  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="Bookmarks" query={query} onQuery={setQuery} placeholder="Search bookmarks" actions={actions} />
      <View style={{ flex: 1, flexDirection: "row", paddingHorizontal: 16, paddingBottom: 16, gap: 16 }}>
        <ScrollView style={{ width: 230, flexGrow: 0 }} contentContainerStyle={{ paddingVertical: 4 }}>
          <FolderTree
            profileId={profileId}
            selectedId={searching ? null : folderId}
            onSelect={(id) => {
              setQuery("");
              setFolderId(id);
            }}
            rowHeight={28}
            wrapRow={(id, row) => (
              <View
                ref={targets.ref(`tree:${id}`, { kind: "folder", id })}
                style={{ borderRadius: 6, backgroundColor: drop && "into" in drop && drop.into === id ? `${colors.accent}40` : undefined }}
              >
                {row}
              </View>
            )}
          />
        </ScrollView>
        <View
          style={{
            flex: 1,
            borderRadius: 12,
            backgroundColor: colors.group,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.groupBorder,
            overflow: "hidden",
          }}
        >
          <View style={{ height: 40, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>
              {searching ? `Results for “${query.trim()}”` : folderTitle}
            </Text>
            {!searching && folderId && (
              <Button title="Open All" onPress={() => void openFolder(folderId, windowId)} disabled={!ids.length} />
            )}
          </View>
          <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.separator }} />
          {ids.length === 0 ? (
            <EmptyState
              icon={<Symbol name={searching ? "magnifyingglass" : "bookmark"} size={26} color={theme.textTertiary} style={{ width: 36, height: 36 }} />}
              title={searching ? "No search results found" : "This folder is empty"}
            />
          ) : (
            <ScrollView
              focusable
              enableFocusRing={false}
              keyDownEvents={[{ key: "Backspace" }, { key: "Delete" }, { key: "a", metaKey: true }]}
              onKeyDown={(e) => {
                const key = e.nativeEvent.key;
                if (key === "Backspace" || key === "Delete") remove(selected);
                if (key === "a") setSelected(ids);
              }}
              contentContainerStyle={{ padding: 6 }}
            >
              {ids.map((id, index) => (
                <View key={id}>
                  {indicator === index && <DropLine color={colors.accent} />}
                  <BookmarkRow
                    id={id}
                    index={index}
                    windowId={windowId}
                    profileId={profileId}
                    showPath={searching}
                    selected={selected.includes(id)}
                    highlighted={!!drop && "into" in drop && drop.into === id}
                    targetRef={targets.ref(`row:${id}`, { kind: "row", id, index, folder: useBrowser.getState().bookmarks.nodes[id]?.kind === "folder" })}
                    onSelect={(e) => select(id, e)}
                    onOpenFolder={(folder = id) => {
                      setQuery("");
                      setFolderId(folder);
                    }}
                    onDelete={() => remove(selected.includes(id) ? selected : [id])}
                    onDragStart={() => onDragStart(id)}
                    onDragMove={onDragMove}
                    onDragEnd={onDragEnd}
                  />
                </View>
              ))}
              {indicator === ids.length && <DropLine color={colors.accent} />}
            </ScrollView>
          )}
        </View>
      </View>
      {undo && (
        <UndoToast
          message={`${plural(undo.count, "item")} deleted`}
          onUndo={() => {
            useBrowser.getState().restoreBookmarks(undo.removed);
            setUndo(null);
          }}
        />
      )}
    </View>
  );
}

/** Every link and folder under a folder, depth-first. */
function folderLinksAndFolders(b: ReturnType<typeof useBrowser.getState>["bookmarks"], folderId: string): BookmarkNode[] {
  return folderChildren(b, folderId).flatMap((n) => (n.kind === "folder" ? [n, ...folderLinksAndFolders(b, n.id)] : [n]));
}

function DropLine({ color }: { color: string }) {
  return <View style={{ height: 2, marginHorizontal: 8, marginVertical: -1, borderRadius: 1, backgroundColor: color, zIndex: 5 }} />;
}

function BookmarkRow({
  id,
  index,
  windowId,
  profileId,
  showPath,
  selected,
  highlighted,
  targetRef,
  onSelect,
  onOpenFolder,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  id: string;
  index: number;
  windowId: string;
  profileId: string;
  showPath: boolean;
  selected: boolean;
  highlighted: boolean;
  targetRef: (v: View | null) => void;
  onSelect: (e: { metaKey?: boolean; shiftKey?: boolean }) => void;
  /** Shows a folder's contents (this row's, or `folder`). */
  onOpenFolder: (folder?: string) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const node = useBrowser((s) => s.bookmarks.nodes[id]);
  const path = useBrowser((s) => (showPath ? bookmarkAncestors(s.bookmarks, id).map((a) => a.title).reverse().join(" › ") : ""));
  const { hovered, hoverProps } = useHover();
  const dy = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const handlers = useRef({ onDragStart, onDragMove, onDragEnd });
  handlers.current = { onDragStart, onDragMove, onDragEnd };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 || Math.abs(g.dx) > 8,
        onPanResponderGrant: () => {
          setDragging(true);
          handlers.current.onDragStart();
        },
        onPanResponderMove: (_, g) => {
          dy.setValue(g.dy);
          handlers.current.onDragMove(g.moveX, g.moveY);
        },
        onPanResponderRelease: (_, g) => {
          dy.setValue(0);
          setDragging(false);
          handlers.current.onDragEnd(g.moveX, g.moveY);
        },
        onPanResponderTerminate: () => {
          dy.setValue(0);
          setDragging(false);
          handlers.current.onDragEnd(-1, -1);
        },
      }),
    [],
  );
  if (!node) return null;

  const open = (mode: Parameters<typeof openUrl>[2]) => node.kind === "url" && openUrl(node.url, windowId, mode);
  const menu = async () => {
    if (!selected) onSelect({});
    const items: MenuItem[] =
      node.kind === "url"
        ? [
            { id: "tab", title: "Open in New Tab" },
            { id: "window", title: "Open in New Window" },
            { id: "incognito", title: "Open in Incognito Window" },
            { id: "split", title: "Open in Split View" },
            { separator: true },
            { id: "edit", title: "Edit…" },
            { id: "copy", title: "Copy Link" },
          ]
        : [
            { id: "openAll", title: `Open All (${folderLinks(useBrowser.getState().bookmarks, node.id).length})` },
            { id: "openAllWindow", title: "Open All in New Window" },
            { separator: true },
            { id: "edit", title: "Rename…" },
          ];
    if (showPath) items.push({ id: "show", title: "Show in Folder" });
    items.push({ separator: true }, { id: "delete", title: "Delete" });
    const choice = await showMenu(items);
    if (choice === "tab") open("foreground");
    if (choice === "window") open("window");
    if (choice === "incognito") open("incognito");
    if (choice === "split") open("split");
    if (choice === "copy" && node.kind === "url") copyText(cleanUrl(node.url));
    if (choice === "edit") editBookmark(node.id, windowId, { profileId });
    if (choice === "openAll") void openFolder(node.id, windowId);
    if (choice === "openAllWindow") void openFolder(node.id, windowId, "window");
    if (choice === "show" && node.parentId) onOpenFolder(node.parentId);
    if (choice === "delete") onDelete();
  };

  return (
    <Animated.View
      ref={targetRef as never}
      {...responder.panHandlers}
      {...hoverProps}
      style={{ zIndex: dragging ? 10 : 0, opacity: dragging ? 0.85 : 1, transform: [{ translateY: dy }] }}
    >
      <ContextMenuArea onContextMenu={() => void menu()}>
        <MouseArea onMiddleClick={() => open("background")}>
          <Pressable onPress={(e) => onSelect(e.nativeEvent as unknown as { metaKey?: boolean; shiftKey?: boolean })}>
            <View
              onDoubleClick={() => (node.kind === "folder" ? onOpenFolder() : void open("current"))}
              style={{
                height: ROW,
                borderRadius: 7,
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 10,
                gap: 10,
                backgroundColor: selected ? `${colors.accent}${theme.dark ? "59" : "33"}` : highlighted ? `${colors.accent}40` : hovered ? theme.rowHover : undefined,
              }}
            >
              {node.kind === "url" ? (
                <Favicon url={node.url} favicon={node.favicon} profileId={profileId} />
              ) : (
                <Symbol name="folder" size={14} color={theme.icon} style={{ width: 16, height: 16 }} />
              )}
              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, color: theme.textPrimary }}>
                {node.title || (node.kind === "url" ? node.url : "")}
              </Text>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.textTertiary }}>
                {showPath ? path : node.kind === "url" ? hostLabel(node.url) : plural(node.children.length, "item")}
              </Text>
              <View style={{ opacity: hovered ? 1 : 0 }}>
                <IconButton icon="ellipsis" size={13} box={24} radius={6} onPress={() => void menu()} tooltip="More actions" />
              </View>
            </View>
          </Pressable>
        </MouseArea>
      </ContextMenuArea>
    </Animated.View>
  );
}

function UndoToast({ message, onUndo }: { message: string; onUndo: () => void }) {
  const theme = useTheme();
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 24, alignItems: "center" }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          paddingLeft: 16,
          paddingRight: 8,
          height: 38,
          borderRadius: 10,
          backgroundColor: theme.dark ? "#3A3A3C" : "#2C2C2E",
        }}
      >
        <Text style={{ fontSize: 13, color: "#FFFFFF" }}>{message}</Text>
        <Pressable onPress={onUndo} style={{ paddingHorizontal: 10, height: 26, borderRadius: 6, justifyContent: "center" }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#64A8FF" }}>Undo</Text>
        </Pressable>
      </View>
    </View>
  );
}
