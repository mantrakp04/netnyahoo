import { ContextMenuArea, FadeLabel, setTrafficLightsCenter, Surface, Symbol, WindowDragRegion } from "@netnyahoo/shell";
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { closeTab, toggleMute } from "../../lib/actions";
import { hex, layout, ThemeScope, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { PageProfileContext, useIsActiveTab, usePageProfileId, useSettings, useTab, useTabLive, useWindowId, useWindowProfileId } from "../../store/hooks";
import { viewTabIds } from "../../store/model";
import type { TabGroup } from "../../store/types";
import { ProfileIndicator } from "../ProfileIndicator";
import { IconButton, useHover } from "../primitives";
import { clickTab } from "../sidebar/actions";
import { openTabMenu } from "../sidebar/menus";
import { TabIcon } from "../sidebar/TabIcon";
import { TabBadges } from "../media/TabBadges";
import { GROUP_COLORS, withAlpha } from "../sidebar/tokens";
import { modifiersOf } from "./controls";
import { usePageOffset, usePagerPages } from "./profilePager";
import { ProfileSwipeArea } from "./ProfileSwipe";
import { openNewTabInSplit } from "./splitActions";
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

type Entry =
  | { kind: "dock"; ids: string[] }
  | { kind: "group"; id: string }
  | { kind: "tab"; id: string; group: string | null }
  | { kind: "split"; id: string; tabIds: string[]; group: string | null };

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
  const entries = useBrowser(
    useShallow((s): string[] => {
      const view = viewTabIds(s, windowId, profileId);
      const seen = new Set<string>();
      const out: string[] = [];
      for (const id of view) {
        const t = s.tabs[id]!;
        if (t.pinned) {
          out.push(`pinned:${id}`);
          continue;
        }
        const group = Object.values(s.groups).find((g) => g.tabIds.includes(id));
        if (group && !seen.has(group.id)) {
          seen.add(group.id);
          out.push(`group:${group.id}`);
        }
        if (group?.collapsed && s.windows[windowId]?.activeTabIds[profileId] !== id) continue;
        const split = Object.values(s.splits).find((v) => v.tabIds.includes(id));
        if (split) {
          if (!seen.has(split.id)) out.push(`split:${split.id}:${split.tabIds.join(",")}:${group?.id ?? ""}`);
          seen.add(split.id);
          continue;
        }
        out.push(`tab:${id}:${group?.id ?? ""}`);
      }
      return out;
    }),
  );
  const parsed = useMemo(() => parseEntries(entries), [entries]);
  const tabCount = parsed.filter((e) => e.kind === "tab" || e.kind === "split").length;
  const pinnedCount = parsed.reduce((n, e) => n + (e.kind === "dock" ? e.ids.length : 0), 0);
  const groupCount = parsed.filter((e) => e.kind === "group").length;
  const dockWidth = pinnedCount ? pinnedCount * (PINNED_CELL + PINNED_SPACING) - PINNED_SPACING + DOCK_GAP : 0;
  const room = pageWidth - dockWidth - groupCount * (110 + GAP) - (ITEM_HEIGHT + GAP);
  // Half-point widths keep every tab edge on the 2x pixel grid, so the attached tab shows no seam against the card.
  const chip = Math.round(Math.max(MIN_CHIP, Math.min(MAX_CHIP, tabCount ? room / tabCount - GAP : MAX_CHIP)) * 2) / 2;
  const regular = parsed.filter((e) => e.kind === "tab").map((e) => e.id);

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
              if (e.kind === "group") return <GroupLabel key={e.id} groupId={e.id} />;
              if (e.kind === "split") return <SplitChip key={e.id} tabIds={e.tabIds} width={chip * Math.min(e.tabIds.length, 2)} group={e.group} />;
              return <DraggableChip key={e.id} tabId={e.id} width={chip} index={regular.indexOf(e.id)} count={regular.length} group={e.group} />;
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
  for (const key of keys) {
    const [kind, id, a, b] = key.split(":");
    if (kind === "pinned") {
      const last = out[out.length - 1];
      if (last?.kind === "dock") last.ids.push(id!);
      else out.push({ kind: "dock", ids: [id!] });
    } else if (kind === "group") out.push({ kind, id: id! });
    else if (kind === "split") out.push({ kind, id: id!, tabIds: a!.split(","), group: b || null });
    else out.push({ kind: "tab", id: id!, group: a || null });
  }
  return out;
}

function DraggableChip({ tabId, width, index, count, group }: { tabId: string; width: number; index: number; count: number; group: string | null }) {
  const dx = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const active = useIsActiveTab(tabId);
  const pitch = width + GAP;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          setDragging(true);
          beginTabDrag(tabId);
        },
        onPanResponderMove: (_, g) => {
          dx.setValue(Math.max(-index * pitch, Math.min((count - 1 - index) * pitch, g.dx)));
          updateTabDrag(g.moveX, g.moveY);
        },
        onPanResponderRelease: (_, g) => {
          dx.setValue(0);
          setDragging(false);
          if (endTabDrag()) return;
          const to = Math.min(Math.max(index + Math.round(g.dx / pitch), 0), count - 1);
          if (to !== index) useBrowser.getState().moveTab(tabId, sectionIndex(tabId, to));
        },
        onPanResponderTerminate: () => {
          dx.setValue(0);
          setDragging(false);
          cancelTabDrag();
        },
      }),
    [index, count, tabId, pitch],
  );
  return (
    <Animated.View {...responder.panHandlers} style={{ zIndex: dragging ? 10 : active ? 1 : 0, opacity: dragging ? 0.92 : 1, transform: [{ translateX: dx }] }}>
      <TabChip tabId={tabId} width={width} group={group} />
    </Animated.View>
  );
}

function sectionIndex(tabId: string, visibleIndex: number) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId]!;
  const w = s.windows[tab.windowId]!;
  const section = w.tabIds.filter((id) => s.tabs[id]?.profileId === tab.profileId && !s.tabs[id]?.pinned);
  const visible = section.filter((id) => !Object.values(s.groups).some((g) => g.collapsed && g.tabIds.includes(id) && id !== tabId));
  const target = visible[visibleIndex];
  return target ? section.indexOf(target) : section.length - 1;
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

function TabChip({ tabId, width, group }: { tabId: string; width: number; group: string | null }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const floating = useContext(FloatingStrip);
  const playing = useTabLive(tabId, (l) => l.playingAudio);
  const groupColor = useBrowser((s) => (group ? s.groups[group]?.color : null));
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
                  icon="xmark"
                  size={9}
                  weight="semibold"
                  box={20}
                  radius={5}
                  color={onBand ? palette.icon : undefined}
                  onPress={() => void closeTab(tab.id)}
                  tooltip="Close Tab"
                />
              ) : (
                <View style={{ width: 20 }} />
              )}
              {groupColor !== undefined && group ? <GroupUnderline color={groupColor} /> : null}
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

function GroupUnderline({ color }: { color: TabGroup["color"] }) {
  const theme = useTheme();
  const tint = color ? GROUP_COLORS[color].hex : theme.dark ? "#FFFFFF66" : "#00000040";
  return <View pointerEvents="none" style={{ position: "absolute", left: 10, right: 10, bottom: 1, height: 2, borderRadius: 1, backgroundColor: tint }} />;
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

function GroupLabel({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const group = useBrowser((s) => s.groups[groupId]);
  const { hovered, hoverProps } = useHover();
  if (!group) return null;
  const tint = group.color ? GROUP_COLORS[group.color].hex : null;
  return (
    <View {...hoverProps} tooltip={group.collapsed ? "Expand Group" : "Collapse Group"} style={{ marginTop: ITEM_TOP }}>
      <Pressable onPress={() => useBrowser.getState().updateGroup(groupId, { collapsed: !group.collapsed })}>
        {({ pressed }) => (
          <View
            style={{
              height: ITEM_HEIGHT,
              maxWidth: 140,
              paddingHorizontal: 10,
              borderRadius: TAB_RADIUS,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: tint ? withAlpha(tint, pressed ? 0.34 : hovered ? 0.28 : 0.2) : pressed ? theme.tabPressed : hovered ? theme.tabHover : theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)",
            }}
          >
            {group.icon ? <Text style={{ fontSize: 13 }}>{group.icon}</Text> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tint ?? theme.textSecondary }} />}
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, fontWeight: "600", color: tint ?? theme.textPrimary }}>
              {group.name || (group.collapsed ? `${group.tabIds.length} Tabs` : "Group")}
            </Text>
            {group.collapsed && group.name ? <Text style={{ fontSize: 11, color: theme.textSecondary }}>{group.tabIds.length}</Text> : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

function SplitChip({ tabIds, width, group }: { tabIds: string[]; width: number; group: string | null }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const profileId = usePageProfileId();
  const focusedId = useBrowser((s) => s.windows[windowId]?.activeTabIds[profileId] ?? "");
  const active = tabIds.includes(focusedId);
  const groupColor = useBrowser((s) => (group ? s.groups[group]?.color : null));
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
        {groupColor !== undefined && group ? <GroupUnderline color={groupColor} /> : null}
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
