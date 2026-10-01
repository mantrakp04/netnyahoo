import { ContextMenuArea, FadeLabel, Symbol, WindowDragRegion } from "@netnyahoo/shell";
import { memo, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { layout, ThemeScope, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { PageProfileContext, useSettings, useWindowId, useWindowProfileId } from "../store/hooks";
import { activeTabId } from "../store/model";
import { downloadsIn } from "../store/ui";
import { cleanedTabsFor, cleanUpCandidates } from "../store/organize";
import { openNewTabInSplit } from "./layout/splitActions";
import { listTopGap, SIDEBAR_FOOTER_DOWNLOADS, SIDEBAR_HEADER_WITH_FIELD, useAddressBarInSidebar } from "./layout/windowLayout";
import { SIDEBAR_PLAYER_HEIGHT, SidebarPlayer, useSidebarPlayerTab } from "./media/SidebarPlayer";
import { IconButton, useHover } from "./primitives";
import { PROFILE_INDICATOR_X, ProfileIndicator } from "./ProfileIndicator";
import { usePageStyle, usePagerPages } from "./layout/profilePager";
import { PROFILE_DOTS_HEIGHT, ProfileDots, useProfileDotsShown } from "./profiles/ProfileDots";
import { SidebarAddressRow, SidebarHeaderTools } from "./sidebar/AddressBar";
import { DragGhost } from "./sidebar/DragGhost";
import { DragProvider, DragScope, useDragController, useDragItem, type Ghost } from "./sidebar/dnd";
import { useSidebarEntries } from "./sidebar/entries";
import { GroupBlock } from "./sidebar/GroupBlock";
import { LiveFolders } from "./sidebar/LiveFolderBlock";
import { openOverflowMenu, openSidebarMenu } from "./sidebar/menus";
import { PinnedGrid } from "./sidebar/PinnedGrid";
import { ResizeHandle } from "./sidebar/ResizeHandle";
import { measureRow } from "./sidebar/state";
import { SplitRowItem, TabRowItem } from "./sidebar/TabRow";
import { useSidebarTokens, useSidebarWidth } from "./sidebar/tokens";

const GLOW_ROOM = 24;
const ROW_PITCH = layout.rowHeight + layout.rowGap;
const DOCKED_BOTTOM = 6;
// Room the docked New Tab row takes from the list: the row plus one row gap above it.
const DOCK = DOCKED_BOTTOM + ROW_PITCH;
// Rows in 2400 pt, more than the tallest sidebar.
const FIRST_PAINT_ROWS = 64;
const ROWS_PER_FRAME = 32;

export function Sidebar() {
  const windowId = useWindowId();
  const width = useSidebarWidth(windowId);
  const current = useWindowProfileId();
  const { pages, paging } = usePagerPages(windowId);
  const [available, setAvailable] = useState(0);
  const [listHeight, setListHeight] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const docked = available > 0 && listHeight + ROW_PITCH + 12 > available;
  const playerTab = useSidebarPlayerTab(windowId);
  const playerHeight = playerTab ? SIDEBAR_PLAYER_HEIGHT : 0;
  const addressBar = useAddressBarInSidebar();
  const header = addressBar ? SIDEBAR_HEADER_WITH_FIELD : layout.sidebarHeader;
  const glowRoom = addressBar ? 0 : GLOW_ROOM;
  const hasDownloads = useBrowser((s) => downloadsIn(s, windowId).length > 0);
  const dots = useProfileDotsShown();
  const footerDownloads = addressBar && hasDownloads;
  const footer = dots || footerDownloads ? PROFILE_DOTS_HEIGHT : 0;

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
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: header - glowRoom,
              bottom: (docked ? DOCK : 0) + playerHeight + footer,
              overflow: paging ? "hidden" : "visible",
            }}
            onLayout={(e) => setAvailable(e.nativeEvent.layout.height + (docked ? DOCK : 0))}
          >
            {pages.map((page) => (
              <SidebarPage
                key={page.id}
                profileId={page.id}
                slot={page.slot}
                width={width}
                current={page.id === current}
                resting={!!page.resting}
                docked={docked}
                glowRoom={glowRoom}
                ghost={ghost}
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
            <View style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, bottom: (docked ? DOCK : 8) + footer }}>
              <SidebarPlayer tabId={playerTab} />
            </View>
          ) : null}

          {docked ? (
            <View style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, bottom: DOCKED_BOTTOM + footer }}>
              <NewTabRow windowId={windowId} />
            </View>
          ) : null}

          {footer ? (
            <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: footer }}>
              {dots ? <ProfileDots windowId={windowId} /> : null}
              {footerDownloads ? (
                <View style={{ position: "absolute", left: layout.sidebarInset, bottom: SIDEBAR_FOOTER_DOWNLOADS.bottom }}>
                  <DownloadsButton windowId={windowId} />
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={{ height: header }}>
            <WindowDragRegion style={StyleSheet.absoluteFill} />
            {addressBar ? (
              <>
                <SidebarHeaderTools width={width} />
                <SidebarAddressRow />
              </>
            ) : (
              <View style={{ height: layout.sidebarHeader, flexDirection: "row", alignItems: "flex-start", paddingLeft: PROFILE_INDICATOR_X, paddingRight: 7, paddingTop: 27 - 17 }}>
                <ProfileIndicator room={width - PROFILE_INDICATOR_X - 7 - (hasDownloads ? 34 + 2 : 0)} />
                <View style={{ flex: 1 }} />
                {hasDownloads ? <DownloadsButton windowId={windowId} /> : null}
              </View>
            )}
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
  current: boolean;
  resting: boolean;
  docked: boolean;
  glowRoom: number;
  ghost: Ghost | null;
  rows: number | undefined;
  onListHeight: (height: number) => void;
  onScrollView: (view: ScrollView | null) => void;
  onScrollY: (y: number) => void;
};

function SidebarPage({ profileId, slot, width, current, resting, docked, glowRoom, ghost, rows, onListHeight, onScrollView, onScrollY }: PageProps) {
  const windowId = useWindowId();
  const { tiles, pinnedGroups, list: all } = useSidebarEntries(windowId, profileId);
  // A page's first render mounts only the rows a screen can show; the rest follow in chunks, one per frame, so a
  // long sidebar neither holds up the window's first frame nor mounts in one long task after it.
  const [mountedRows, setMountedRows] = useState(FIRST_PAINT_ROWS);
  const growing = rows === undefined && mountedRows < all.length;
  useEffect(() => {
    if (!growing) return;
    // Once caught up, every row mounts with the list (a tab opened later never waits for a chunk).
    const frame = requestAnimationFrame(() => setMountedRows((n) => (n + ROWS_PER_FRAME >= all.length ? Infinity : n + ROWS_PER_FRAME)));
    return () => cancelAnimationFrame(frame);
  }, [growing, mountedRows, all.length]);
  const limit = rows ?? (growing ? mountedRows : undefined);
  const list = limit === undefined ? all : all.slice(0, limit);
  const topGap = listTopGap(useAddressBarInSidebar());
  const newTabsAtTop = useSettings((s) => s.newTabPosition === "top");
  const innerWidth = width - layout.sidebarInset * 2;
  const pageStyle = usePageStyle(windowId, slot, width);
  const inlineNewTab = !current || !docked;
  const measured = useRef(0);
  useEffect(() => {
    if (current && measured.current) onListHeight(measured.current);
  }, [current]);
  // The viewport starts glowRoom above the header's foot so the first row's glow isn't cut, but scrolled rows
  // must never show there, under the traffic lights and the profile name. The viewport's top edge follows the
  // first row down to the header's foot as the list scrolls (outer view moves the clip, inner one cancels it).
  const scrollY = useRef(new Animated.Value(0)).current;
  const [onScroll] = useState(() =>
    Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: true,
      listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => onScrollY(e.nativeEvent.contentOffset.y),
    }),
  );
  const edge = scrollY.interpolate({ inputRange: [0, Math.max(1, topGap)], outputRange: [0, glowRoom], extrapolate: "clamp" });

  return (
    <Animated.View
      pointerEvents={current ? "auto" : "none"}
      style={{ position: "absolute", top: 0, bottom: 0, left: 0, width, display: resting ? "none" : "flex", ...pageStyle }}
    >
      <PageProfileContext.Provider value={profileId}>
        <ThemeScope>
          <DragScope enabled={current}>
            <PageContent>
              {(controller) => (
                <Animated.View style={{ flex: 1, overflow: "hidden", transform: [{ translateY: edge }] }}>
                  <Animated.View style={{ flex: 1, transform: [{ translateY: Animated.multiply(edge, -1) }] }}>
                    <Animated.ScrollView
                      ref={current ? onScrollView : undefined}
                      style={{ flex: 1 }}
                      showsVerticalScrollIndicator={false}
                      scrollEventThrottle={16}
                      onScroll={current ? onScroll : undefined}
                      contentContainerStyle={{ flexGrow: 1, width, paddingHorizontal: layout.sidebarInset, paddingTop: glowRoom }}
                    >
                      <View
                        onLayout={(e) => {
                          measured.current = e.nativeEvent.layout.height + glowRoom - (inlineNewTab ? ROW_PITCH : 0);
                          if (current) onListHeight(measured.current);
                        }}
                      >
                        <PinnedGrid tabs={tiles} innerWidth={innerWidth} dragging={current && !!ghost} />
                        <View
                          ref={(v) => {
                            controller?.regions.set("pinnedGroups", v);
                          }}
                          style={{ marginTop: tiles.length || (current && ghost) ? 6 : topGap, gap: layout.rowGap }}
                        >
                          {pinnedGroups.map((id) => (
                            <GroupBlock key={id} groupId={id} section="pinnedGroups" />
                          ))}
                          <Tail id="tail:pinnedGroups" section="pinnedGroups" />
                        </View>
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
                      <ContextMenuArea style={{ flexGrow: 1, minHeight: inlineNewTab ? 24 : 0 }} onContextMenu={() => void openSidebarMenu(windowId)}>
                        <View style={{ flex: 1 }} onDoubleClick={() => useBrowser.getState().newTab(windowId)} />
                      </ContextMenuArea>
                    </Animated.ScrollView>
                  </Animated.View>
                </Animated.View>
              )}
            </PageContent>
          </DragScope>
        </ThemeScope>
      </PageProfileContext.Provider>
    </Animated.View>
  );
}

function PageContent({ children }: { children: (controller: ReturnType<typeof useDragController>) => ReactNode }) {
  return <>{children(useDragController())}</>;
}

// Rows are memoized by id: the sidebar re-renders on layout and profile changes, and each row
// subscribes to its own tab.
const ListEntry = memo(function ListEntry({ entry }: { entry: string }) {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return <GroupBlock groupId={id} section="list" />;
  if (entry.startsWith("s:")) return <SplitRowItem splitId={id} section="list" />;
  return <TabRowItem tabId={id} section="list" />;
});

const Tail = memo(function Tail({ id, section }: { id: string; section: "list" | "pinnedGroups" }) {
  const { wrapper } = useDragItem(id, { kind: "tail", tabIds: [], section });
  return <Animated.View ref={wrapper.ref} style={wrapper.style} />;
});

function useRevealTabs(windowId: string, scroll: RefObject<ScrollView | null>, scrollY: RefObject<number>, glowRoom: number) {
  useEffect(() => {
    // A row not mounted yet (long lists mount a chunk per frame) is looked for again every 60 ms, for up to 3 s,
    // until the user switches tabs again: every reveal belongs to the switch it followed.
    let switches = 0;
    let stopped = false;
    const reveal = (tabId: string, tries = 50, switch_ = switches): ReturnType<typeof setTimeout> =>
      setTimeout(async () => {
        const current = () => !stopped && switch_ === switches;
        if (!current()) return;
        const row = await measureRow(windowId, tabId);
        if (!current()) return;
        if (!row) {
          if (tries > 1 && useBrowser.getState().tabs[tabId]?.windowId === windowId) reveal(tabId, tries - 1, switch_);
          return;
        }
        const view = scroll.current as unknown as View | null;
        const viewport = await new Promise<{ y: number; h: number } | null>((resolve) =>
          view ? view.measureInWindow((_x, y, _w, h) => resolve(h ? { y, h } : null)) : resolve(null),
        );
        if (!current() || !viewport || !scroll.current) return;
        const top = viewport.y + glowRoom;
        const bottom = viewport.y + viewport.h - 8;
        const y = scrollY.current ?? 0;
        if (row.y < top) scroll.current.scrollTo({ y: Math.max(0, y - (top - row.y)), animated: true });
        else if (row.y + row.height > bottom) scroll.current.scrollTo({ y: y + (row.y + row.height - bottom), animated: true });
      }, 60);
    const unsubscribe = useBrowser.subscribe((s, prev) => {
      if (s.windows === prev.windows && s.tabs === prev.tabs) return;
      const active = activeTabId(s, windowId);
      if (active && active !== activeTabId(prev, windowId)) {
        switches++;
        reveal(active);
      }
      const w = s.windows[windowId];
      const before = prev.windows[windowId];
      if (!w || !before || w.tabIds === before.tabIds) return;
      const had = new Set(before.tabIds);
      for (const id of w.tabIds) {
        if (!had.has(id) && s.tabs[id]?.openerId && id !== active) reveal(id);
      }
    });
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [windowId, glowRoom]);
}

function DownloadsButton({ windowId }: { windowId: string }) {
  return (
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
  );
}

const NewTabRow = memo(function NewTabRow({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const cleaned = useBrowser((s) => cleanedTabsFor(s, windowId).length);
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ flexDirection: "row", alignItems: "center" }}>
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
            <Symbol name="plus" size={13} weight="medium" color={tokens.newTabIcon} style={{ width: 16, height: 16 }} />
            <FadeLabel text="New Tab" fontSize={13} color={tokens.newTabLabel} style={{ flex: 1, height: 18, marginLeft: 5 }} />
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
});

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
