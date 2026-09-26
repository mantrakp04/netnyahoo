import { ContextMenuArea, FadeLabel, Symbol, WindowDragRegion } from "@netnyahoo/shell";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { layout, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { PageProfileContext, useSettings, useWindowId, useWindowProfileId } from "../store/hooks";
import { activeTabId } from "../store/model";
import { downloadsIn } from "../store/ui";
import { cleanUpCandidates } from "../store/organize";
import { openNewTabInSplit } from "./layout/splitActions";
import { SIDEBAR_HEADER_WITH_FIELD, useAddressBarInSidebar } from "./layout/windowLayout";
import { SIDEBAR_PLAYER_HEIGHT, SidebarPlayer, useSidebarPlayerTab } from "./media/SidebarPlayer";
import { IconButton, useHover } from "./primitives";
import { PROFILE_INDICATOR_X, ProfileIndicator } from "./ProfileIndicator";
import { usePageOffset, usePagerPages } from "./layout/profilePager";
import { PROFILE_DOTS_HEIGHT, ProfileDots, useProfileDotsShown } from "./profiles/ProfileDots";
import { SIDEBAR_NAV_WIDTH, SidebarAddressRow, SidebarNavigation } from "./sidebar/AddressBar";
import { DragGhost } from "./sidebar/DragGhost";
import { DragProvider, DragScope, useDragController, useDragItem, type Ghost } from "./sidebar/dnd";
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
  const current = useWindowProfileId();
  // Swiping between profiles pages the list (layout/profilePager); the pages beside it only mount then.
  const { pages, paging } = usePagerPages(windowId);
  const [available, setAvailable] = useState(0);
  const [listHeight, setListHeight] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  // Dia 1.17: when tabs overflow, the New Tab button pins to the bottom.
  const docked = available > 0 && listHeight + ROW_PITCH + 12 > available;
  // Media playing in a background tab gets a player docked at the bottom (components/media).
  const playerTab = useSidebarPlayerTab(windowId);
  const playerHeight = playerTab ? SIDEBAR_PLAYER_HEIGHT : 0;
  // Dia's footer with the space switcher: a dot per profile.
  const footer = useProfileDotsShown() ? PROFILE_DOTS_HEIGHT : 0;
  // Settings › Appearance › Address Bar: the header also holds the URL field, and the list starts
  // under it. The field is translucent, so the list doesn't reach under it for the glow.
  const addressBar = useAddressBarInSidebar();
  const header = addressBar ? SIDEBAR_HEADER_WITH_FIELD : layout.sidebarHeader;
  const glowRoom = addressBar ? 0 : GLOW_ROOM;
  // Dia's Downloads button is there only while the window lists downloads (in progress or done);
  // clearing the list hides it again.
  const hasDownloads = useBrowser((s) => downloadsIn(s, windowId).length > 0);

  useRevealTabs(windowId, scroll, scrollY, glowRoom);

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
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: header - glowRoom,
              bottom: (docked ? ROW_PITCH + 10 : 0) + playerHeight + footer,
              // Pages are clipped to the sidebar only while they move.
              overflow: paging ? "hidden" : "visible",
            }}
            onLayout={(e) => setAvailable(e.nativeEvent.layout.height + (docked ? ROW_PITCH + 10 : 0))}
          >
            {pages.map((page) => (
              <SidebarPage
                key={page.id}
                profileId={page.id}
                slot={page.slot}
                width={width}
                current={page.id === current}
                docked={docked}
                glowRoom={glowRoom}
                ghost={ghost}
                // The pages beside the window's only draw the rows that fit.
                rows={page.id === current ? undefined : Math.ceil(available / ROW_PITCH) + 1}
                onListHeight={setListHeight}
                onScrollView={(v) => {
                  scroll.current = v;
                  controller.scroll = v;
                }}
                onScrollY={(y) => {
                  scrollY.current = y;
                  controller.scrollY = y;
                }}
              />
            ))}
          </View>

          {playerTab ? (
            <View style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, bottom: (docked ? ROW_PITCH + 10 : 8) + footer }}>
              <SidebarPlayer tabId={playerTab} />
            </View>
          ) : null}

          {docked ? (
            <View style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, bottom: 6 + footer }}>
              <NewTabRow windowId={windowId} />
            </View>
          ) : null}

          {footer ? (
            <View style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
              <ProfileDots windowId={windowId} />
            </View>
          ) : null}

          {/* Traffic lights sit in this header (positioned natively); the rest drags the window. */}
          <View style={{ height: header }}>
            <WindowDragRegion style={StyleSheet.absoluteFill} />
            {/* Dia's header stack: window controls, 6 pt, the profile name, then (2 pt apart, 7 pt from the
                edge) Downloads while any are listed. */}
            <View style={{ height: layout.sidebarHeader, flexDirection: "row", alignItems: "flex-start", paddingLeft: PROFILE_INDICATOR_X, paddingRight: 7, paddingTop: 27 - 17 }}>
              {addressBar ? (
                <>
                  {/* Back / forward / reload take Downloads' place (it moves beside the URL field). */}
                  <ProfileIndicator room={width - PROFILE_INDICATOR_X - SIDEBAR_NAV_WIDTH - 7 - 2} />
                  <View style={{ flex: 1 }} />
                  <View style={{ marginTop: 2 }}>
                    <SidebarNavigation />
                  </View>
                </>
              ) : (
                <>
                  <ProfileIndicator room={width - PROFILE_INDICATOR_X - 7 - (hasDownloads ? 34 + 2 : 0)} />
                  <View style={{ flex: 1 }} />
                  {hasDownloads ? (
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
                  ) : null}
                </>
              )}
            </View>
            {addressBar ? <SidebarAddressRow /> : null}
          </View>

          <ResizeHandle windowId={windowId} width={width} />
          {ghost ? <DragGhost ghost={ghost} /> : null}
        </View>
      )}
    </DragProvider>
  );
}

type PageProps = {
  profileId: string;
  slot: number;
  width: number;
  /** The window's profile: the page you use. The others are drawn beside it during a swipe. */
  current: boolean;
  docked: boolean;
  /** Room above the list's first row for the selected row's glow. */
  glowRoom: number;
  ghost: Ghost | null;
  /** How many list entries to draw (pages beside the window's). */
  rows: number | undefined;
  onListHeight: (height: number) => void;
  onScrollView: (view: ScrollView | null) => void;
  onScrollY: (y: number) => void;
};

/** A profile's pinned tiles, groups, live folders and tabs: the scrolling part of the sidebar. */
function SidebarPage({ profileId, slot, width, current, docked, glowRoom, ghost, rows, onListHeight, onScrollView, onScrollY }: PageProps) {
  const windowId = useWindowId();
  const { tiles, pinnedGroups, list: all } = useSidebarEntries(windowId, profileId);
  const list = rows === undefined ? all : all.slice(0, rows);
  const newTabsAtTop = useSettings((s) => s.newTabPosition === "top");
  const innerWidth = width - layout.sidebarInset * 2;
  const translateX = usePageOffset(windowId, slot, width);
  // Docking follows the window's page; one beside it keeps its New Tab row inline.
  const inlineNewTab = !current || !docked;
  const measured = useRef(0);
  useEffect(() => {
    if (current && measured.current) onListHeight(measured.current);
  }, [current]);

  return (
    <Animated.View
      pointerEvents={current ? "auto" : "none"}
      style={{ position: "absolute", top: 0, bottom: 0, left: 0, width, transform: [{ translateX }] }}
    >
      <PageProfileContext.Provider value={profileId}>
        <DragScope enabled={current}>
          <PageContent>
            {(controller) => (
              <ScrollView
                ref={current ? onScrollView : undefined}
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={current ? (e) => onScrollY(e.nativeEvent.contentOffset.y) : undefined}
                contentContainerStyle={{ flexGrow: 1, width, paddingHorizontal: layout.sidebarInset, paddingTop: glowRoom }}
              >
                <View
                  // Measured without the inline New Tab row, so docking doesn't flip back and forth.
                  onLayout={(e) => {
                    measured.current = e.nativeEvent.layout.height + glowRoom - (inlineNewTab ? ROW_PITCH : 0);
                    if (current) onListHeight(measured.current);
                  }}
                  style={{ paddingBottom: inlineNewTab ? 0 : 8 }}
                >
                  <PinnedGrid tabs={tiles} innerWidth={innerWidth} dragging={current && !!ghost} />
                  <View
                    ref={(v) => {
                      controller?.regions.set("pinnedGroups", v);
                    }}
                    // The tiles' 6 pt spacing (Dia's dock layout) down to the first row.
                    style={{ marginTop: tiles.length || (current && ghost) ? 6 : layout.pinnedTop - layout.sidebarHeader, gap: layout.rowGap }}
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
                      controller?.regions.set("list", v);
                    }}
                    style={{ marginTop: pinnedGroups.length ? 7 : 0, gap: layout.rowGap }}
                  >
                    {newTabsAtTop && inlineNewTab ? <NewTabRow windowId={windowId} /> : null}
                    {list.map((entry) => (
                      <ListEntry key={entry} entry={entry} />
                    ))}
                    <Tail id="tail:list" section="list" />
                    {!newTabsAtTop && inlineNewTab ? <NewTabRow windowId={windowId} /> : null}
                  </View>
                  {current ? <CleanUpUpsell windowId={windowId} /> : null}
                </View>
                {/* Empty space: double-click opens a new tab; right-click has the sidebar menu. */}
                <ContextMenuArea style={{ flexGrow: 1, minHeight: 24 }} onContextMenu={() => void openSidebarMenu(windowId)}>
                  <View style={{ flex: 1 }} onDoubleClick={() => useBrowser.getState().newTab(windowId)} />
                </ContextMenuArea>
              </ScrollView>
            )}
          </PageContent>
        </DragScope>
      </PageProfileContext.Provider>
    </Animated.View>
  );
}

/** Hands the page its drag controller (none for a page beside the window's). */
function PageContent({ children }: { children: (controller: ReturnType<typeof useDragController>) => ReactNode }) {
  return <>{children(useDragController())}</>;
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
function useRevealTabs(windowId: string, scroll: RefObject<ScrollView | null>, scrollY: RefObject<number>, glowRoom: number) {
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
        const top = viewport.y + glowRoom;
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
  }, [windowId, glowRoom]);
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
    <Pressable onPress={onPress}>
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
      {/* Dia's buttons sit in a row in its 316pt-wide upsell; the sidebar card (160–400pt) stacks them
          so each title fits whole at any sidebar width. */}
      <View style={{ gap: 6 }}>
        {button("Clean Up Once", () => {
          useBrowser.getState().cleanUpTabs(windowId);
          dismiss();
        }, true)}
        {button("Clean Up Daily", () => {
          useBrowser.getState().updateSettings({ cleanUpInactiveTabsAfterHours: 24 });
          useBrowser.getState().cleanUpTabs(windowId);
        })}
        {button("Not Now", dismiss)}
      </View>
    </View>
  );
}
