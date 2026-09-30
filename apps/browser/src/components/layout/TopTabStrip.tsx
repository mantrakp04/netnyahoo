import { ContextMenuArea, FadeLabel, setTrafficLightsCenter, Surface, Symbol, WindowDragRegion } from "@netnyahoo/shell";
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { closeTab, toggleMute } from "../../lib/actions";
import { hex, layout, ThemeScope, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { PageProfileContext, useIsActiveTab, usePageProfileId, useSettings, useTab, useTabLive, useWindowId, useWindowProfileId } from "../../store/hooks";
import { ProfileIndicator } from "../ProfileIndicator";
import { IconButton, useHover } from "../primitives";
import { clickTab } from "../sidebar/actions";
import { openGroupMenu, openTabMenu } from "../sidebar/menus";
import { TabIcon } from "../sidebar/TabIcon";
import { TabBadges } from "../media/TabBadges";
import { GROUP_COLORS, useSidebarTokens, withAlpha } from "../sidebar/tokens";
import { modifiersOf } from "./controls";
import { usePageOffset, usePagerPages } from "./profilePager";
import { ProfileSwipeArea } from "./ProfileSwipe";
import { openNewTabInSplit } from "./splitActions";
import {
  CHIP_WIDTH_GUESS,
  dragGeometry,
  dragRange,
  dropIndex,
  GROUP_MARGIN_LEFT,
  GROUP_MARGIN_RIGHT,
  GROUP_SPRING,
  groupLayout,
  MEMBERS_INSET,
  memberInteractive,
  moveIndex,
  stripEntries,
  stripTabWidth,
  TAIL_EXPANDED,
  TUCK_FADE_MS,
  tuckTarget,
  type DragGeometry,
  type DragSlot,
} from "./stripGroups";
import { beginTabDrag, cancelTabDrag, endTabDrag, updateTabDrag } from "./tabDrag";
import { toolbarPalette, useEasedColor, type ToolbarPalette } from "./toolbarColors";

// Dia's top strip, from a 2x capture of 1.50.1: the card starts 42 below the window top, and everything in the
// strip (window buttons, icons, titles) centres on y 21.
export const TOP_STRIP_HEIGHT = 42;
export const TOP_CARD_INSET = 6;
const MID = 21;
// Hover backgrounds, the pinned group and the + button: 32 tall, 5…37.
const ITEM_HEIGHT = 32;
const ITEM_TOP = MID - ITEM_HEIGHT / 2;
// The selected tab rises from the card: fill from y 3 with top corners of 10 and concave 15 pt flares at its foot,
// and a 0.5 pt rim just outside it that fades out down the sides.
const TAB_TOP = 3;
const TAB_RADIUS = 10;
const FLARE = 15;
const RIM_HEIGHT = 27.5;
const PEEK_PAD = 7;
const PEEK_HEIGHT = ITEM_HEIGHT + PEEK_PAD * 2;
// Pinned tabs share one container: 34 pt cells 2 apart, 16 pt icons.
const PINNED_CELL = 34;
const PINNED_SPACING = 2;
const DOCK_GAP = 4.5;
const MIN_CHIP = 96;
const MAX_CHIP = 173;
const GAP = 4;
// The first item starts at x 86, 12 pt after the zoom button.
const LIGHTS_GAP = 8;
const LIGHTS_CENTER: [number, number] = [20.75, 20.75];

// The drop-down strip (full screen, auto-hidden tabs) has no card to attach the selected tab to.
const FloatingStrip = createContext(false);

type Member = { kind: "tab"; id: string; group: string | null } | { kind: "split"; id: string; tabIds: string[]; group: string | null };
type GroupEntry = { kind: "group"; id: string; collapsed: boolean; members: Member[] };
type Entry = { kind: "dock"; ids: string[] } | GroupEntry | Member;

export function TopTabStrip({ floating = false }: { floating?: boolean }) {
  const windowId = useWindowId();
  const [width, setWidth] = useState(0);
  const current = useWindowProfileId();
  const { pages } = usePagerPages(windowId);
  const [controls, setControls] = useState(76);
  const left = floating ? 8 : layout.trafficLightsWidth + LIGHTS_GAP;
  const right = Math.max(84, controls + 8 + 6);
  const pageWidth = Math.max(0, width - left - right);
  const flare = floating ? 0 : FLARE;

  useEffect(() => {
    if (floating) return;
    void setTrafficLightsCenter(windowId, LIGHTS_CENTER);
    return () => void setTrafficLightsCenter(windowId, null);
  }, [floating, windowId]);

  return (
    <FloatingStrip.Provider value={floating}>
      <View style={{ height: TOP_STRIP_HEIGHT }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <WindowDragRegion style={StyleSheet.absoluteFill} />
        {/* The clip starts a flare's width early so the first tab's flare isn't cut. */}
        <View style={{ position: "absolute", left: left - flare, right: right - flare, top: 0, bottom: 0, overflow: "hidden" }}>
          {pages.map((page) => (
            <StripPage key={page.id} profileId={page.id} slot={page.slot} pageWidth={pageWidth} current={page.id === current} resting={!!page.resting} />
          ))}
        </View>
        <View
          onLayout={(e) => setControls(Math.ceil(e.nativeEvent.layout.width))}
          style={{ position: "absolute", right: 8, top: MID - 17, flexDirection: "row", alignItems: "center", gap: 2 }}
        >
          <ProfileIndicator room={140} />
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
        <ProfileSwipeArea surface="strip" style={StyleSheet.absoluteFill} pageWidth={pageWidth} />
      </View>
    </FloatingStrip.Provider>
  );
}

function StripPage({ profileId, slot, pageWidth, current, resting }: { profileId: string; slot: number; pageWidth: number; current: boolean; resting: boolean }) {
  const windowId = useWindowId();
  const flare = useContext(FloatingStrip) ? 0 : FLARE;
  const translateX = usePageOffset(windowId, slot, pageWidth);
  const entries = useBrowser((s) => stripEntries(s, windowId, profileId));
  const activeId = useBrowser((s) => s.windows[windowId]?.activeTabIds[profileId] ?? "");
  const parsed = useMemo(() => parseEntries(entries), [entries]);
  // Each group's chip as measured (its name's width), so the tabs' width leaves it room.
  const [chipWidths, setChipWidths] = useState<Record<string, number>>({});
  const chipOf = (groupId: string) => chipWidths[groupId] ?? CHIP_WIDTH_GUESS;
  // What's out in the strip: collapsed groups show only their active member.
  const visible = parsed.flatMap((e): Member[] => (e.kind === "group" ? (e.collapsed ? e.members.filter((m) => holds(m, activeId)) : e.members) : e.kind === "dock" ? [] : [e]));
  const pinnedCount = parsed.reduce((n, e) => n + (e.kind === "dock" ? e.ids.length : 0), 0);
  const chip = stripTabWidth({
    pageWidth,
    dockWidth: pinnedCount ? pinnedCount * (PINNED_CELL + PINNED_SPACING) - PINNED_SPACING + DOCK_GAP : 0,
    groups: parsed.flatMap((e) => (e.kind === "group" ? [{ chip: chipOf(e.id), expanded: !e.collapsed, shown: e.members.some((m) => holds(m, activeId)) }] : [])),
    tabUnits: visible.reduce((n, m) => n + units(m), 0),
    gap: GAP,
    plus: ITEM_HEIGHT,
    min: MIN_CHIP,
    max: MAX_CHIP,
  });
  // A tab dragged along the strip trades places with whole tabs, splits and groups.
  const top = dragGeometry(
    parsed.flatMap((e): DragSlot[] => {
      if (e.kind === "dock") return [];
      if (e.kind !== "group") return [{ tabIds: tabsOf(e), width: chip * units(e) }];
      const widths = e.members.map((m) => chip * units(m));
      const shown = e.members.findIndex((m) => holds(m, activeId));
      const width = groupLayout(chipOf(e.id), widths, GAP, !e.collapsed, shown).width;
      return [{ tabIds: e.members.flatMap(tabsOf), width, marginLeft: GROUP_MARGIN_LEFT, marginRight: GROUP_MARGIN_RIGHT }];
    }),
    GAP,
  );
  const slotOf = (id: string) => top.slots.findIndex((slot) => slot.tabIds[0] === id);

  return (
    <Animated.View
      pointerEvents={current ? "auto" : "none"}
      style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pageWidth + flare * 2, display: resting ? "none" : "flex", transform: [{ translateX }] }}
    >
      <PageProfileContext.Provider value={profileId}>
        <ThemeScope>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ alignItems: "flex-start", gap: GAP, paddingLeft: flare, paddingRight: flare }}
          >
            {parsed.map((e) => {
              if (e.kind === "dock") return <PinnedDock key="dock" tabIds={e.ids} />;
              if (e.kind === "group")
                return (
                  <StripGroup
                    key={e.id}
                    entry={e}
                    chip={chip}
                    activeId={activeId}
                    chipWidth={chipOf(e.id)}
                    onChipWidth={(width) => setChipWidths((all) => (all[e.id] === width ? all : { ...all, [e.id]: width }))}
                  />
                );
              if (e.kind === "split") return <SplitChip key={e.id} tabIds={e.tabIds} width={chip * Math.min(e.tabIds.length, 2)} />;
              return <DraggableChip key={e.id} tabId={e.id} width={chip} geometry={top} from={slotOf(e.id)} />;
            })}
            <NewTabButton windowId={windowId} />
          </ScrollView>
        </ThemeScope>
      </PageProfileContext.Provider>
    </Animated.View>
  );
}

function parseEntries(keys: string[]): Entry[] {
  const out: Entry[] = [];
  const groups = new Map<string, GroupEntry>();
  for (const key of keys) {
    const [kind, id, a, b] = key.split(":");
    if (kind === "pinned") {
      const last = out[out.length - 1];
      if (last?.kind === "dock") last.ids.push(id!);
      else out.push({ kind: "dock", ids: [id!] });
      continue;
    }
    if (kind === "group") {
      const group: GroupEntry = { kind, id: id!, collapsed: a === "1", members: [] };
      groups.set(group.id, group);
      out.push(group);
      continue;
    }
    const member: Member = kind === "split" ? { kind, id: id!, tabIds: a!.split(","), group: b || null } : { kind: "tab", id: id!, group: a || null };
    const group = member.group ? groups.get(member.group) : undefined;
    if (group) group.members.push(member);
    else out.push(member);
  }
  return out;
}

const holds = (m: Member, tabId: string) => (m.kind === "split" ? m.tabIds.includes(tabId) : m.id === tabId);
const tabsOf = (m: Member) => (m.kind === "split" ? m.tabIds : [m.id]);
// A split shows at most two panes' width.
const units = (m: Member) => (m.kind === "split" ? Math.min(m.tabIds.length, 2) : 1);

function DraggableChip({ tabId, width, geometry, from, tuck }: { tabId: string; width: number; geometry: DragGeometry; from: number; tuck?: () => void }) {
  const dx = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const active = useIsActiveTab(tabId);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          setDragging(true);
          beginTabDrag(tabId);
        },
        onPanResponderMove: (_, g) => {
          const [min, max] = from < 0 ? [0, 0] : dragRange(geometry, from);
          dx.setValue(Math.max(min, Math.min(max, g.dx)));
          updateTabDrag(g.moveX, g.moveY);
        },
        onPanResponderRelease: (_, g) => {
          dx.setValue(0);
          setDragging(false);
          if (endTabDrag() || from < 0) return;
          const s = useBrowser.getState();
          const tab = s.tabs[tabId];
          if (!tab) return;
          const section = s.windows[tab.windowId]?.tabIds.filter((id) => s.tabs[id]?.profileId === tab.profileId && !s.tabs[id]?.pinned) ?? [];
          const index = moveIndex(section, tabId, geometry.slots, from, dropIndex(geometry, from, g.dx));
          if (index !== null) s.moveTab(tabId, index);
        },
        onPanResponderTerminate: () => {
          dx.setValue(0);
          setDragging(false);
          cancelTabDrag();
        },
      }),
    [tabId, geometry, from],
  );
  return (
    <Animated.View {...responder.panHandlers} style={{ zIndex: dragging ? 10 : active ? 1 : 0, opacity: dragging ? 0.92 : 1, transform: [{ translateX: dx }] }}>
      <TabChip tabId={tabId} width={width} tuck={tuck} />
    </Animated.View>
  );
}

// The toolbar's website colour, eased the same way, so the selected tab and the toolbar read as one surface.
function useWebsiteBand(tabId: string) {
  const theme = useTheme();
  const extend = useSettings((s) => s.extendWebsiteColor);
  const url = useTab(tabId)?.url;
  const themeColor = useTabLive(tabId, (l) => l.themeColor);
  const palette = toolbarPalette(theme, extend && url ? themeColor : null);
  return { palette, band: useEasedColor(palette.background) };
}

// `tuck`: the active tab of a collapsed group shows Dia's "–" instead of ✕, tucking it back into the group.
function TabChip({ tabId, width, tuck }: { tabId: string; width: number; tuck?: () => void }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const floating = useContext(FloatingStrip);
  const playing = useTabLive(tabId, (l) => l.playingAudio);
  const { palette, band } = useWebsiteBand(tabId);
  const { hovered, hoverProps } = useHover();
  if (!tab) return null;
  const title = tab.customTitle || tab.title || tab.url || "New Tab";
  const onBand = active && !floating && !!palette.background;
  return (
    <View {...hoverProps} tooltip={tab.url ? `${title}\n${tab.url}` : title} style={{ width, height: TOP_STRIP_HEIGHT }}>
      {active && <SelectedTab width={width} band={band} />}
      <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)} style={StyleSheet.absoluteFill}>
        <Pressable onPress={(e) => clickTab(windowId, tab.id, modifiersOf(e))} style={{ flex: 1 }}>
          {({ pressed }) => (
            <ItemRow hovered={hovered && !active} pressed={pressed && !active}>
              <View>
                <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                <TabBadges tabId={tab.id} pip={false} />
              </View>
              {(playing || tab.muted) && (
                <Pressable onPress={() => toggleMute(tab.id)} style={{ marginLeft: 5 }} tooltip={tab.muted ? "Unmute" : "Mute"}>
                  <Symbol name={tab.muted ? "speaker.slash" : "speaker.wave.2"} size={11} color={onBand ? palette.icon : theme.textTab} style={{ width: 16, height: 16 }} />
                </Pressable>
              )}
              <FadeLabel
                text={title}
                fontSize={12}
                color={onBand ? palette.text : active ? theme.tabSelectedText : theme.textTab}
                // The label draws 2 pt in, so the text starts 7 after the favicon.
                style={{ flex: 1, height: 16, marginLeft: 5 }}
              />
              {hovered ? (
                <IconButton
                  icon={tuck ? "minus" : "xmark"}
                  size={9}
                  weight="semibold"
                  box={20}
                  radius={5}
                  color={onBand ? palette.icon : undefined}
                  onPress={tuck ?? (() => void closeTab(tab.id))}
                  tooltip={tuck ? "Hide in Group" : "Close Tab"}
                />
              ) : (
                <View style={{ width: 20 }} />
              )}
            </ItemRow>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

// A tab's content row, 5…37, with Dia's hover and pressed fills for a tab that isn't selected.
function ItemRow({ hovered, pressed, children }: { hovered: boolean; pressed: boolean; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: ITEM_TOP,
        height: ITEM_HEIGHT,
        borderRadius: TAB_RADIUS,
        backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 9.5,
        paddingRight: 6,
      }}
    >
      {children}
    </View>
  );
}

type Fill = string | ReturnType<typeof useEasedColor>;

// The selected tab: the card's own fill (and the toolbar's website colour over it) rising out of the card.
function SelectedTab({ width, band }: { width: number; band: Fill | null }) {
  const theme = useTheme();
  const floating = useContext(FloatingStrip);
  if (floating) {
    return (
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top: ITEM_TOP,
          width,
          height: ITEM_HEIGHT,
          borderRadius: TAB_RADIUS,
          borderWidth: 0.5,
          borderColor: theme.dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)",
          backgroundColor: theme.card,
        }}
      />
    );
  }
  const body = width - 1;
  const fills: Fill[] = band ? [theme.card, band] : [theme.card];
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height: TOP_STRIP_HEIGHT }}>
      {fills.map((fill, i) => (
        <Fragment key={i}>
          <Animated.View
            style={{
              position: "absolute",
              left: 0.5,
              top: TAB_TOP,
              width: body,
              height: TOP_STRIP_HEIGHT - TAB_TOP,
              borderTopLeftRadius: TAB_RADIUS,
              borderTopRightRadius: TAB_RADIUS,
              backgroundColor: fill,
            }}
          />
          <Flare x={0.5 - FLARE} side="left" color={fill} />
          <Flare x={0.5 + body} side="right" color={fill} />
        </Fragment>
      ))}
      <Surface
        cornerRadius={TAB_RADIUS + 0.5}
        borderWidth={0.5}
        borderColors={[theme.dark ? "#FFFFFF3B" : "#FFFFFFFA", "#FFFFFF00"]}
        style={{ position: "absolute", left: 0, top: TAB_TOP - 0.5, width, height: RIM_HEIGHT }}
      />
    </View>
  );
}

// The tab's concave foot: an r×r square filled outside a circle of radius r centred on its outer top corner.
function Flare({ x, side, color }: { x: number; side: "left" | "right"; color: Fill }) {
  const outer = FLARE * 2;
  return (
    <View style={{ position: "absolute", left: x, top: TOP_STRIP_HEIGHT - FLARE, width: FLARE, height: FLARE, overflow: "hidden" }}>
      <Animated.View
        style={{
          position: "absolute",
          left: side === "left" ? -outer : FLARE - outer,
          top: -outer,
          width: outer * 2,
          height: outer * 2,
          borderRadius: outer,
          borderWidth: FLARE,
          borderColor: color,
        }}
      />
    </View>
  );
}

// Dia keeps pinned tabs in one shared container (the TabDockItemResting fill and stroke), not a tile each.
function PinnedDock({ tabIds }: { tabIds: string[] }) {
  const theme = useTheme();
  return (
    <View
      style={{
        marginTop: ITEM_TOP,
        marginRight: DOCK_GAP - GAP,
        width: tabIds.length * (PINNED_CELL + PINNED_SPACING) - PINNED_SPACING,
        height: ITEM_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: TAB_RADIUS,
        borderWidth: 0.5,
        borderColor: theme.pinnedRestingStroke,
        backgroundColor: theme.pinnedResting,
      }}
    >
      {/* The stroke sits inside the container, over the cells' outer edges. */}
      <View style={{ flexDirection: "row", gap: PINNED_SPACING, marginHorizontal: -0.5 }}>
        {tabIds.map((id) => (
          <PinnedCell key={id} tabId={id} />
        ))}
      </View>
    </View>
  );
}

function PinnedCell({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const { hovered, hoverProps } = useHover();
  if (!tab) return null;
  return (
    <View {...hoverProps} tooltip={`${tab.customTitle || tab.title || tab.url}${tab.url ? `\n${tab.url}` : ""}`}>
      <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)}>
        <Pressable onPress={(e) => clickTab(windowId, tab.id, modifiersOf(e))}>
          {({ pressed }) => (
            <View style={{ width: PINNED_CELL, height: ITEM_HEIGHT - 1, alignItems: "center", justifyContent: "center" }}>
              {(active || hovered || pressed) && (
                <View
                  style={{
                    position: "absolute",
                    left: 2,
                    right: 2,
                    top: 2,
                    bottom: 2,
                    borderRadius: 8,
                    backgroundColor: pressed ? theme.tabPressed : active ? theme.pinnedSelectedFill : theme.tabHover,
                  }}
                />
              )}
              <View>
                <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                <TabBadges tabId={tab.id} pip={false} />
              </View>
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

// A tab group (stripGroups.ts): one container with the chip and the members. Collapsed, the members wait under
// the first slot, faded out, except the window's active tab; expanding slides them out to their places and
// collapsing slides them back, on Dia's spring.
function StripGroup({
  entry,
  chip,
  activeId,
  chipWidth,
  onChipWidth,
}: {
  entry: GroupEntry;
  chip: number;
  activeId: string;
  chipWidth: number;
  onChipWidth: (width: number) => void;
}) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const windowId = useWindowId();
  const profileId = usePageProfileId();
  const group = useBrowser((s) => s.groups[entry.id]);
  const { hovered, hoverProps } = useHover();
  const expanded = !entry.collapsed;
  const widths = entry.members.map((m) => chip * units(m));
  const shown = entry.members.findIndex((m) => holds(m, activeId));
  const { offsets, width } = groupLayout(chipWidth, widths, GAP, expanded, shown);
  // Inside an open group, a member trades places with the other members only.
  const members = useMemo(() => dragGeometry(entry.members.map((m, i) => ({ tabIds: tabsOf(m), width: widths[i]! })), GAP), [entry.members, chip]);
  const tuckable = useBrowser((s) => !expanded && shown >= 0 && !!tuckTarget(s, windowId, profileId, entry.id));
  const open = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const size = useRef(new Animated.Value(width)).current;
  const state = `${expanded}:${shown >= 0 ? entry.members[shown]!.id : ""}`;
  const settled = useRef(state);
  // While the group springs, members that are still sliding (and fading) in take no clicks.
  const [moving, setMoving] = useState(false);
  const springs = useRef(0);
  useEffect(() => {
    const spring = (value: Animated.Value, toValue: number) => Animated.spring(value, { toValue, ...GROUP_SPRING, useNativeDriver: false });
    const run = (animation: Animated.CompositeAnimation) => {
      const id = ++springs.current;
      setMoving(true);
      animation.start(() => id === springs.current && setMoving(false));
    };
    if (settled.current !== state) {
      // Expanding, collapsing and a member coming out or going back spring.
      settled.current = state;
      run(Animated.parallel([spring(open, expanded ? 1 : 0), spring(size, width)]));
    } else if (moving) {
      // The width changed mid-spring (the chip measured, a member came or went): the spring takes the new target.
      run(spring(size, width));
    } else size.setValue(width);
  }, [state, width]);
  const fade = useMemo(() => open.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }), []);
  const tail = useMemo(() => Animated.add(size, -(TAIL_EXPANDED - 2.25)), []);
  if (!group) return null;
  const tint = group.color ? GROUP_COLORS[group.color].hex : null;
  const divider = theme.dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)";
  const tuck = () => {
    const s = useBrowser.getState();
    const target = tuckTarget(s, windowId, profileId, entry.id);
    if (target) s.activate(target);
  };
  return (
    <Animated.View style={{ width: size, height: TOP_STRIP_HEIGHT, marginLeft: GROUP_MARGIN_LEFT, marginRight: GROUP_MARGIN_RIGHT }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top: ITEM_TOP,
          width: size,
          height: ITEM_HEIGHT,
          borderRadius: TAB_RADIUS,
          borderWidth: 0.5,
          borderColor: theme.pinnedRestingStroke,
          // Dia lightens the whole container while the pointer is on the chip.
          backgroundColor: tint ? withAlpha(tint, hovered ? 0.24 : 0.18) : hovered ? tokens.groupHeaderHover : tokens.groupFill,
        }}
      />
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: chipWidth + 0.75, top: MID - 7.5, width: 0.5, height: 15, backgroundColor: divider, opacity: fade }} />
      {entry.members.map((m, i) => (
        <GroupMember
          key={m.id}
          member={m}
          width={widths[i]!}
          start={chipWidth + MEMBERS_INSET}
          offset={offsets[i]!}
          open={open}
          interactive={memberInteractive(i === shown, expanded, moving)}
          shown={i === shown}
          geometry={members}
          // A collapsed group's shown tab has no neighbours to trade places with.
          from={expanded ? i : -1}
          tuck={tuckable && i === shown ? tuck : undefined}
        />
      ))}
      <Animated.View pointerEvents={expanded ? "box-none" : "none"} style={{ position: "absolute", top: ITEM_TOP, height: ITEM_HEIGHT, left: tail, flexDirection: "row", alignItems: "center", opacity: fade }}>
        <View style={{ width: 0.5, height: 15, backgroundColor: divider }} />
        <IconButton icon="xmark" size={9} weight="semibold" box={24} radius={6} style={{ marginLeft: 1 }} onPress={() => useBrowser.getState().closeGroup(entry.id)} tooltip="Close Group" />
      </Animated.View>
      <View
        {...hoverProps}
        tooltip={expanded ? "Collapse Group" : "Expand Group"}
        onLayout={(e) => onChipWidth(Math.ceil(e.nativeEvent.layout.width * 2) / 2)}
        style={{ position: "absolute", left: 0, top: ITEM_TOP, height: ITEM_HEIGHT }}
      >
        <ContextMenuArea onContextMenu={() => void openGroupMenu(windowId, entry.id)}>
          <Pressable
            onPress={() => useBrowser.getState().updateGroup(entry.id, { collapsed: expanded })}
            style={{ height: ITEM_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 8.5, paddingRight: 7 }}
          >
            {group.icon ? <Text style={{ width: 13, fontSize: 12, textAlign: "center" }}>{group.icon}</Text> : <GroupGlyph color={tint ?? (theme.dark ? "#FFFFFF4D" : "#0000004D")} />}
            <Text numberOfLines={1} style={{ marginLeft: 12.5, maxWidth: 120, fontSize: 12, fontWeight: "600", color: tint ?? (shown >= 0 ? theme.tabSelectedText : theme.textTab) }}>
              {group.name || `${group.tabIds.length} Tabs`}
            </Text>
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}

function GroupMember({
  member,
  width,
  start,
  offset,
  open,
  interactive,
  shown,
  geometry,
  from,
  tuck,
}: {
  member: Member;
  width: number;
  start: number;
  offset: number;
  open: Animated.Value;
  interactive: boolean;
  shown: boolean;
  geometry: DragGeometry;
  from: number;
  tuck?: () => void;
}) {
  // The shown member (the window's active tab while collapsed) fades in and out on its own: Dia's "–" fades the
  // tab back into the group while the tabs after it close the gap.
  const shownValue = useRef(new Animated.Value(shown ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(shownValue, { toValue: shown ? 1 : 0, duration: TUCK_FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [shown]);
  const left = useMemo(() => open.interpolate({ inputRange: [0, 1], outputRange: [start, start + offset] }), [start, offset]);
  const opacity = useMemo(
    () =>
      Animated.add(shownValue, open.interpolate({ inputRange: [0, 0.5], outputRange: [0, 1], extrapolate: "clamp" })).interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolate: "clamp",
      }),
    [],
  );
  return (
    <Animated.View pointerEvents={interactive ? "box-none" : "none"} style={{ position: "absolute", top: 0, left, width, height: TOP_STRIP_HEIGHT, opacity, zIndex: shown ? 2 : 1 }}>
      {member.kind === "split" ? (
        <SplitChip tabIds={member.tabIds} width={width} />
      ) : (
        <DraggableChip tabId={member.id} width={width} geometry={geometry} from={from} tuck={tuck} />
      )}
    </Animated.View>
  );
}

// Dia's group glyph: a tab seen edge-on with two more behind it.
function GroupGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 13, height: 11, flexDirection: "row", alignItems: "center" }}>
      <View style={{ width: 1.25, height: 7, borderRadius: 0.625, backgroundColor: color, opacity: 0.5 }} />
      <View style={{ width: 1.25, height: 9, borderRadius: 0.625, marginLeft: 0.6, backgroundColor: color, opacity: 0.75 }} />
      <View style={{ width: 9.4, height: 10.6, borderRadius: 2.5, marginLeft: 0.5, backgroundColor: color }} />
    </View>
  );
}

function SplitChip({ tabIds, width }: { tabIds: string[]; width: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const profileId = usePageProfileId();
  const focusedId = useBrowser((s) => s.windows[windowId]?.activeTabIds[profileId] ?? "");
  const active = tabIds.includes(focusedId);
  // Each pane has its own card and toolbar; the tab takes the focused pane's colour.
  const { band, palette } = useWebsiteBand(active ? focusedId : tabIds[0]!);
  const floating = useContext(FloatingStrip);
  const ink = active && !floating && palette.background ? palette : null;
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ width, height: TOP_STRIP_HEIGHT, zIndex: active ? 1 : 0 }}>
      {active && <SelectedTab width={width} band={band} />}
      <ItemRow hovered={hovered && !active} pressed={false}>
        <Symbol name="rectangle.split.2x1" size={11} color={ink?.secondary ?? theme.textSecondary} style={{ width: 14, height: 16, marginRight: 4 }} />
        {tabIds.map((id, i) => (
          <SplitPart key={id} tabId={id} first={i === 0} ink={ink} />
        ))}
      </ItemRow>
    </View>
  );
}

function SplitPart({ tabId, first, ink }: { tabId: string; first: boolean; ink: ToolbarPalette | null }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const focused = useIsActiveTab(tabId);
  if (!tab) return null;
  return (
    <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)} style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
      {!first && <View style={{ width: StyleSheet.hairlineWidth, height: 16, marginHorizontal: 6, backgroundColor: ink?.divider ?? theme.textTertiary }} />}
      <Pressable onPress={() => useBrowser.getState().activate(tab.id)} style={{ flex: 1, flexDirection: "row", alignItems: "center" }} tooltip={tab.title || tab.url}>
        <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} profileId={tab.profileId} />
        <FadeLabel text={tab.customTitle || tab.title || tab.url || "New Tab"} fontSize={12} color={ink ? (focused ? ink.text : ink.secondary) : focused ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 16, marginLeft: 5 }} />
      </Pressable>
    </ContextMenuArea>
  );
}

function NewTabButton({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip="New Tab (⌘T) — ⌥-click to open in Split View" style={{ marginTop: ITEM_TOP, marginLeft: 0.5 }}>
      <Pressable
        onPress={(e) => {
          if (modifiersOf(e).altKey) openNewTabInSplit(windowId);
          else useBrowser.getState().newTab(windowId);
        }}
      >
        {({ pressed }) => (
          <View style={{ width: ITEM_HEIGHT, height: ITEM_HEIGHT, borderRadius: TAB_RADIUS, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined }}>
            <Symbol name="plus" size={13} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function TopStripPeek() {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const animate = (to: number, then?: () => void) =>
    Animated.timing(slide, { toValue: to, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(then);
  const show = () => {
    clearTimeout(hideTimer.current);
    setVisible(true);
    animate(1);
  };
  const hide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => animate(0, () => setVisible(false)), 120);
  };
  return (
    <>
      <View onMouseEnter={show} style={{ position: "absolute", left: layout.trafficLightsWidth, right: 0, top: 0, height: 6 }} />
      {visible && (
        <Animated.View
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{
            position: "absolute",
            left: 6,
            right: 6,
            top: 4,
            height: PEEK_HEIGHT,
            opacity: slide,
            transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-PEEK_HEIGHT - 8, 0] }) }],
          }}
        >
          <Surface
            fill={hex(theme.windowTint[0])}
            cornerRadius={12}
            borderColor={hex(theme.panelBorder)}
            borderWidth={0.5}
            shadowColor="#000000"
            shadowOpacity={theme.panelShadowOpacity}
            shadowRadius={20}
            shadowOffset={[0, 6]}
            style={{ flex: 1 }}
          >
            <View style={{ position: "absolute", left: 0, right: 0, top: PEEK_PAD - ITEM_TOP, height: TOP_STRIP_HEIGHT }}>
              <TopTabStrip floating />
            </View>
          </Surface>
        </Animated.View>
      )}
    </>
  );
}
