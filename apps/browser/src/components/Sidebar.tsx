import { ContextMenuArea, FadeLabel, Symbol, WindowDragRegion } from "@netnyahoo/shell";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { layout, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { useSettings, useWindowId } from "../store/hooks";
import { activeTabId } from "../store/model";
import { cleanUpCandidates } from "../store/organize";
import { openNewTabInSplit } from "./layout/splitActions";
import { SIDEBAR_PLAYER_HEIGHT, SidebarPlayer, useSidebarPlayerTab } from "./media/SidebarPlayer";
import { IconButton, useHover } from "./primitives";
import { ProfileIndicator } from "./ProfileIndicator";
import { useProfilePagingStyle } from "./layout/ProfileSwipe";
import { DragGhost } from "./sidebar/DragGhost";
import { DragProvider, useDragItem, type Ghost } from "./sidebar/dnd";
import { useSidebarEntries } from "./sidebar/entries";
import { GroupBlock } from "./sidebar/GroupBlock";
import { LiveFolders } from "./sidebar/LiveFolderBlock";
import { openOverflowMenu, openSidebarMenu } from "./sidebar/menus";
import { PinnedGrid } from "./sidebar/PinnedGrid";
import { ResizeHandle } from "./sidebar/ResizeHandle";
import { measureRow, rowView } from "./sidebar/state";
import { SplitRowItem, TabRowItem } from "./sidebar/TabRow";
import { useSidebarTokens, useSidebarWidth } from "./sidebar/tokens";

/** Room above the list for the selected row's TabSelectedShadow (radius 15). */
const GLOW_ROOM = 24;
const ROW_PITCH = layout.rowHeight + layout.rowGap;

/**
 * Dia's sidebar: header (traffic lights, profile, downloads), pinned tiles,
 * pinned groups, then tabs, groups and splits, with "+ New Tab" after them — or
 * docked at the bottom once the list overflows. Rows are split out under
 * ./sidebar (rows, tiles, groups, drag and drop, menus, overlays).
 */
export function Sidebar() {
  const windowId = useWindowId();
  const width = useSidebarWidth(windowId);
  const { tiles, pinnedGroups, list } = useSidebarEntries(windowId);
  const newTabsAtTop = useSettings((s) => s.newTabPosition === "top");
  const [available, setAvailable] = useState(0);
  const [listHeight, setListHeight] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const innerWidth = width - layout.sidebarInset * 2;
  // Dia 1.17: when tabs overflow, the New Tab button pins to the bottom.
  const docked = available > 0 && listHeight + ROW_PITCH + 12 > available;
  // Media playing in a background tab gets a player docked at the bottom (components/media).
  const playerTab = useSidebarPlayerTab(windowId);
  const playerHeight = playerTab ? SIDEBAR_PLAYER_HEIGHT : 0;

  useRevealTabs(windowId, scroll, scrollY);
  // Swiping between profiles moves the list (layout/ProfileSwipe).
  const paging = useProfilePagingStyle();

  return (
    <DragProvider>
      {(ghost: Ghost | null, controller) => (
        <View
          ref={(v) => {
            controller.root = v;
          }}
          style={{ width, height: "100%" }}
        >
          {/* The list starts under the header so the selected row's glow isn't clipped at the list's top edge. */}
          <Animated.View
            style={[{ position: "absolute", left: 0, right: 0, top: layout.sidebarHeader - GLOW_ROOM, bottom: (docked ? ROW_PITCH + 10 : 0) + playerHeight }, paging]}
            onLayout={(e) => setAvailable(e.nativeEvent.layout.height + (docked ? ROW_PITCH + 10 : 0))}
          >
            <ScrollView
              ref={(v) => {
                scroll.current = v;
                controller.scroll = v;
              }}
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={(e) => {
                scrollY.current = e.nativeEvent.contentOffset.y;
                controller.scrollY = scrollY.current;
              }}
              contentContainerStyle={{ flexGrow: 1, width, paddingHorizontal: layout.sidebarInset, paddingTop: GLOW_ROOM }}
            >
              <View
                // Measured without the inline New Tab row, so docking doesn't flip back and forth.
                onLayout={(e) => setListHeight(e.nativeEvent.layout.height + GLOW_ROOM - (docked ? 0 : ROW_PITCH))}
                style={{ paddingBottom: docked ? 8 : 0 }}
              >
                <PinnedGrid tabs={tiles} innerWidth={innerWidth} dragging={!!ghost} />
                <View
                  ref={(v) => {
                    controller.regions.set("pinnedGroups", v);
                  }}
                  style={{ marginTop: tiles.length || ghost ? 7 : layout.pinnedTop - layout.sidebarHeader, gap: layout.rowGap }}
                >
                  {pinnedGroups.map((id) => (
                    <GroupBlock key={id} groupId={id} section="pinnedGroups" />
                  ))}
                  <Tail id="tail:pinnedGroups" section="pinnedGroups" />
                </View>
                {/* Live folders (src/live) sit between the pinned groups and the tabs; they aren't drop targets. */}
                <LiveFolders windowId={windowId} spaced={pinnedGroups.length > 0} />
                <View
                  ref={(v) => {
                    controller.regions.set("list", v);
                  }}
                  style={{ marginTop: pinnedGroups.length ? 7 : 0, gap: layout.rowGap }}
                >
                  {newTabsAtTop && !docked ? <NewTabRow windowId={windowId} /> : null}
                  {list.map((entry) => (
                    <ListEntry key={entry} entry={entry} />
                  ))}
                  <Tail id="tail:list" section="list" />
                  {!newTabsAtTop && !docked ? <NewTabRow windowId={windowId} /> : null}
                </View>
                <CleanUpUpsell windowId={windowId} />
              </View>
              {/* Empty space: double-click opens a new tab; right-click has the sidebar menu. */}
              <ContextMenuArea style={{ flexGrow: 1, minHeight: 24 }} onContextMenu={() => void openSidebarMenu(windowId)}>
                <View style={{ flex: 1 }} onDoubleClick={() => useBrowser.getState().newTab(windowId)} />
              </ContextMenuArea>
            </ScrollView>
          </Animated.View>

          {playerTab ? (
            <View style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, bottom: docked ? ROW_PITCH + 10 : 8 }}>
              <SidebarPlayer tabId={playerTab} />
            </View>
          ) : null}

          {docked ? (
            <View style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, bottom: 6 }}>
              <NewTabRow windowId={windowId} />
            </View>
          ) : null}

          {/* Traffic lights sit in this header (positioned natively); the rest drags the window. */}
          <View
            style={{ height: layout.sidebarHeader, flexDirection: "row", alignItems: "flex-start", justifyContent: "flex-end", paddingRight: 7, paddingTop: 27 - 17 }}
          >
            <WindowDragRegion style={StyleSheet.absoluteFill} />
            <ProfileIndicator />
            <IconButton
              icon="arrow.down.circle"
              size={16}
              box={34}
              radius={10}
              tooltip="Downloads (⇧⌘J)"
              onPress={() => {
                const s = useBrowser.getState();
                s.setDownloadsOpen(windowId, !s.windowUi[windowId]?.downloadsOpen);
              }}
            />
          </View>

          <ResizeHandle windowId={windowId} width={width} />
          {ghost ? <DragGhost ghost={ghost} /> : null}
        </View>
      )}
    </DragProvider>
  );
}

function ListEntry({ entry }: { entry: string }) {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return <GroupBlock groupId={id} section="list" />;
  if (entry.startsWith("s:")) return <SplitRowItem splitId={id} section="list" />;
  return <TabRowItem tabId={id} section="list" />;
}

/** Marks the end of a section for drops ("after the last one"). */
function Tail({ id, section }: { id: string; section: "list" | "pinnedGroups" }) {
  const { wrapper } = useDragItem(id, { kind: "tail", tabIds: [], section });
  return <Animated.View ref={wrapper.ref} style={wrapper.style} />;
}

/**
 * Scrolls the sidebar to show the selected tab when it changes, and background
 * tabs opened from links (⌘-click) as they appear, so new work isn't offscreen.
 */
function useRevealTabs(windowId: string, scroll: RefObject<ScrollView | null>, scrollY: RefObject<number>) {
  useEffect(() => {
    const reveal = (tabId: string) =>
      setTimeout(async () => {
        const view = scroll.current as unknown as View | null;
        const [row, viewport] = await Promise.all([
          measureRow(windowId, tabId),
          new Promise<{ y: number; h: number } | null>((resolve) =>
            view ? view.measureInWindow((_x, y, _w, h) => resolve(h ? { y, h } : null)) : resolve(null),
          ),
        ]);
        if (!row || !viewport || !scroll.current) return;
        const top = viewport.y + GLOW_ROOM;
        const bottom = viewport.y + viewport.h - 8;
        const y = scrollY.current ?? 0;
        if (row.y < top) scroll.current.scrollTo({ y: Math.max(0, y - (top - row.y)), animated: true });
        else if (row.y + row.height > bottom) scroll.current.scrollTo({ y: y + (row.y + row.height - bottom), animated: true });
      }, 60);
    return useBrowser.subscribe((s, prev) => {
      if (s.windows === prev.windows && s.tabs === prev.tabs) return;
      const active = activeTabId(s, windowId);
      if (active && active !== activeTabId(prev, windowId) && rowView(windowId, active) !== undefined) reveal(active);
      const w = s.windows[windowId];
      const before = prev.windows[windowId];
      if (!w || !before || w.tabIds === before.tabIds) return;
      for (const id of w.tabIds) {
        if (!before.tabIds.includes(id) && s.tabs[id]?.openerId && id !== active) reveal(id);
      }
    });
  }, [windowId]);
}

/** "+ New Tab", with the overflow menu's chevron at its trailing edge. */
function NewTabRow({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const cleaned = useBrowser((s) => s.cleanedTabs.length);
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ flexDirection: "row", alignItems: "center" }}>
      {/* ⌥-click: a New Tab page in a split with the current tab. */}
      <Pressable
        style={{ flex: 1 }}
        onPress={(e) => {
          if ((e.nativeEvent as unknown as { altKey?: boolean }).altKey) openNewTabInSplit(windowId);
          else useBrowser.getState().newTab(windowId);
        }}
      >
        {({ pressed }) => (
          <View
            style={{
              height: layout.rowHeight,
              borderRadius: 10,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 9,
              paddingRight: 34,
              backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
            }}
          >
            <Symbol name="plus" size={13} weight="medium" color={theme.textSecondary} style={{ width: 16, height: 16 }} />
            <FadeLabel text="New Tab" fontSize={13} color={theme.textSecondary} style={{ flex: 1, height: 18, marginLeft: 5 }} />
          </View>
        )}
      </Pressable>
      <View style={{ position: "absolute", right: 6, flexDirection: "row", alignItems: "center" }}>
        {cleaned > 0 && hovered ? <Text style={{ fontSize: 11, color: theme.textTertiary, marginRight: 2 }}>{cleaned} cleaned</Text> : null}
        <IconButton
          icon="chevron.down"
          size={10}
          weight="semibold"
          box={22}
          radius={6}
          color={hovered ? theme.textSecondary : theme.textTertiary}
          tooltip="Open and recently closed tabs"
          onPress={() => void openOverflowMenu(windowId)}
        />
      </View>
    </View>
  );
}

/**
 * Dia asks once there are 10+ tabs that haven't been touched in a while:
 * clean up once, daily, or not now (then it doesn't ask again this session).
 */
const UPSELL_MIN = 10;
let upsellDeclined = false;

function CleanUpUpsell({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const [count, setCount] = useState(0);
  const [hidden, setHidden] = useState(upsellDeclined);
  const daily = useBrowser((s) => s.settings.cleanUpInactiveTabsAfterHours !== null);
  useEffect(() => {
    const check = () => setCount(cleanUpCandidates(useBrowser.getState(), windowId).length);
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [windowId]);
  if (hidden || daily || count < UPSELL_MIN) return null;
  const button = (title: string, onPress: () => void, primary = false) => (
    <Pressable onPress={onPress} style={{ flex: primary ? 1 : undefined }}>
      {({ pressed }) => (
        <View
          style={{
            height: 24,
            borderRadius: 7,
            paddingHorizontal: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? tokens.upsellButtonHover : primary ? theme.textPrimary : tokens.upsellButton,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "500", color: primary ? (theme.dark ? "#000000" : "#FFFFFF") : theme.textPrimary }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
  const dismiss = () => {
    upsellDeclined = true;
    setHidden(true);
  };
  return (
    <View style={{ marginTop: 10, borderRadius: 12, padding: 10, backgroundColor: tokens.groupFill, borderWidth: 0.5, borderColor: tokens.groupStroke, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Symbol name="wand.and.stars" size={12} color={theme.icon} style={{ width: 16, height: 16 }} />
        <Text style={{ flex: 1, fontSize: 12, fontWeight: "600", color: theme.textPrimary }}>{count} tabs haven’t been touched in a while</Text>
      </View>
      <Text style={{ fontSize: 12, color: theme.textSecondary }}>Netnyahoo can tidy up for you. You can always reopen closed tabs from the ⌄ menu.</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {button("Clean Up Once", () => {
          useBrowser.getState().cleanUpTabs(windowId);
          dismiss();
        }, true)}
        {button("Daily", () => {
          useBrowser.getState().updateSettings({ cleanUpInactiveTabsAfterHours: 24 });
          useBrowser.getState().cleanUpTabs(windowId);
        })}
        {button("Not Now", dismiss)}
      </View>
    </View>
  );
}
