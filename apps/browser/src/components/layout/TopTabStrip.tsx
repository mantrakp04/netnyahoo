import { ContextMenuArea, FadeLabel, Surface, Symbol, WindowDragRegion } from "@netnyahoo/shell";
import { useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { closeTab, toggleMute } from "../../lib/actions";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsActiveTab, useTab, useTabLive, useWindowId } from "../../store/hooks";
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
import { openNewTabInSplit } from "./splitActions";
import { beginTabDrag, cancelTabDrag, endTabDrag, updateTabDrag } from "./tabDrag";

/** Height of the strip; the traffic lights sit in it, centred on its tabs. */
export const TOP_STRIP_HEIGHT = layout.sidebarHeader;
const CHIP_HEIGHT = 32;
const CHIP_TOP = 27 - CHIP_HEIGHT / 2;
const PINNED_WIDTH = 40;
const MIN_CHIP = 96;
const MAX_CHIP = 232;
const GAP = 4;

/** An entry in the strip: a pinned tile, a group's label, a tab, or a split (one chip for all its panes). */
type Entry =
  | { kind: "pinned"; id: string }
  | { kind: "group"; id: string }
  | { kind: "tab"; id: string; group: string | null }
  | { kind: "split"; id: string; tabIds: string[]; group: string | null };

/**
 * ⇧⌘S "Show Tabs in Sidebar" off: Dia's horizontal tab bar across the top of
 * the window. Pinned tabs come first as icon tiles, then tabs (groups get a
 * coloured label and underline, splits one combined chip), then the + button.
 * Tabs share the width between 96 and 232pt and scroll past that; drag to
 * reorder, or onto the page to split.
 */
export function TopTabStrip({ floating }: { floating?: boolean }) {
  const windowId = useWindowId();
  const [width, setWidth] = useState(0);
  const entries = useBrowser(
    useShallow((s): string[] => {
      const view = viewTabIds(s, windowId);
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
        if (group?.collapsed && s.windows[windowId]?.activeTabIds[s.windows[windowId]!.profileId] !== id) continue;
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
  const parsed = useMemo(() => entries.map(parseEntry), [entries]);
  const tabCount = parsed.filter((e) => e.kind === "tab" || e.kind === "split").length;
  const pinnedCount = parsed.filter((e) => e.kind === "pinned").length;
  const groupCount = parsed.filter((e) => e.kind === "group").length;
  // Room for tabs: after the traffic lights, pinned tiles, group labels and the + button.
  const room = width - layout.trafficLightsWidth - pinnedCount * (PINNED_WIDTH + GAP) - groupCount * (110 + GAP) - 40 - 90;
  const chip = Math.max(MIN_CHIP, Math.min(MAX_CHIP, tabCount ? room / tabCount - GAP : MAX_CHIP));
  const regular = parsed.filter((e) => e.kind === "tab").map((e) => e.id);

  return (
    <View style={{ height: TOP_STRIP_HEIGHT }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <WindowDragRegion style={StyleSheet.absoluteFill} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ position: "absolute", left: floating ? 8 : layout.trafficLightsWidth, right: 84, top: 0, bottom: 0 }}
        contentContainerStyle={{ alignItems: "flex-start", gap: GAP, paddingTop: CHIP_TOP, paddingRight: 6 }}
      >
        {parsed.map((e) => {
          if (e.kind === "pinned") return <PinnedChip key={e.id} tabId={e.id} />;
          if (e.kind === "group") return <GroupLabel key={e.id} groupId={e.id} />;
          if (e.kind === "split") return <SplitChip key={e.id} tabIds={e.tabIds} width={chip * Math.min(e.tabIds.length, 2)} group={e.group} />;
          return <DraggableChip key={e.id} tabId={e.id} width={chip} index={regular.indexOf(e.id)} count={regular.length} group={e.group} />;
        })}
        <NewTabButton windowId={windowId} />
      </ScrollView>
      <View style={{ position: "absolute", right: 8, top: CHIP_TOP - 1, flexDirection: "row", alignItems: "center", gap: 2 }}>
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
    </View>
  );
}

function parseEntry(key: string): Entry {
  const [kind, id, a, b] = key.split(":");
  if (kind === "pinned") return { kind, id: id! };
  if (kind === "group") return { kind, id: id! };
  if (kind === "split") return { kind, id: id!, tabIds: a!.split(","), group: b || null };
  return { kind: "tab", id: id!, group: a || null };
}

/** Horizontal drag to reorder; dragging onto the page offers Dia's split targets. */
function DraggableChip({ tabId, width, index, count, group }: { tabId: string; width: number; index: number; count: number; group: string | null }) {
  const dx = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
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
          // Dropped on a split target: that's handled; otherwise it's a reorder.
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
    <Animated.View {...responder.panHandlers} style={{ zIndex: dragging ? 10 : 0, opacity: dragging ? 0.92 : 1, transform: [{ translateX: dx }] }}>
      <TabChip tabId={tabId} width={width} group={group} />
    </Animated.View>
  );
}

/** Index among the tab's section (regular tabs of its profile), which moveTab expects. */
function sectionIndex(tabId: string, visibleIndex: number) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId]!;
  const w = s.windows[tab.windowId]!;
  const section = w.tabIds.filter((id) => s.tabs[id]?.profileId === tab.profileId && !s.tabs[id]?.pinned);
  // Collapsed groups hide tabs from the strip; map through the visible ones.
  const visible = section.filter((id) => !Object.values(s.groups).some((g) => g.collapsed && g.tabIds.includes(id) && id !== tabId));
  const target = visible[visibleIndex];
  return target ? section.indexOf(target) : section.length - 1;
}

function TabChip({ tabId, width, group }: { tabId: string; width: number; group: string | null }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const playing = useTabLive(tabId, (l) => l.playingAudio);
  const groupColor = useBrowser((s) => (group ? s.groups[group]?.color : null));
  const { hovered, hoverProps } = useHover();
  if (!tab) return null;
  const title = tab.customTitle || tab.title || tab.url || "New Tab";
  return (
    <View {...hoverProps} tooltip={tab.url ? `${title}\n${tab.url}` : title}>
      <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)}>
        <Pressable onPress={(e) => clickTab(windowId, tab.id, modifiersOf(e))}>
          {({ pressed }) => (
            <ChipSurface active={active} hovered={hovered} pressed={pressed} width={width}>
              <View>
                <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                <TabBadges tabId={tab.id} />
              </View>
              {(playing || tab.muted) && (
                <Pressable onPress={() => toggleMute(tab.id)} style={{ marginLeft: 5 }} tooltip={tab.muted ? "Unmute" : "Mute"}>
                  <Symbol name={tab.muted ? "speaker.slash" : "speaker.wave.2"} size={11} color={theme.textTab} style={{ width: 16, height: 16 }} />
                </Pressable>
              )}
              <FadeLabel text={title} fontSize={12.5} color={active ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 17, marginLeft: 6 }} />
              {hovered ? (
                <IconButton icon="xmark" size={9} weight="semibold" box={20} radius={5} onPress={() => void closeTab(tab.id)} tooltip="Close Tab" />
              ) : (
                <View style={{ width: 20 }} />
              )}
              {groupColor !== undefined && group ? <GroupUnderline color={groupColor} /> : null}
            </ChipSurface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

/** The sidebar's row treatment, as a chip: selected dark fill + hairline + glow; hover / press fills. */
function ChipSurface({ active, hovered, pressed, width, children }: { active: boolean; hovered: boolean; pressed: boolean; width: number; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Surface
      fill={hex(active ? theme.tabSelected : pressed ? theme.tabPressed : hovered ? theme.tabHover : "rgba(0,0,0,0)")}
      cornerRadius={10}
      borderWidth={active ? 1 : 0}
      borderColors={active ? theme.tabSelectedBorder.map(hex) : undefined}
      shadowColor={active ? hex(theme.tabSelectedShadow) : undefined}
      shadowOpacity={active ? 1 : 0}
      shadowRadius={theme.tabSelectedShadowRadius}
      shadowOffset={[0, 0.5]}
      style={{ width, height: CHIP_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 5 }}
    >
      {children}
    </Surface>
  );
}

function GroupUnderline({ color }: { color: TabGroup["color"] }) {
  const theme = useTheme();
  const tint = color ? GROUP_COLORS[color].hex : theme.dark ? "#FFFFFF66" : "#00000040";
  return <View pointerEvents="none" style={{ position: "absolute", left: 10, right: 10, bottom: 1, height: 2, borderRadius: 1, backgroundColor: tint }} />;
}

function PinnedChip({ tabId }: { tabId: string }) {
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
          {({ pressed }) =>
            active ? (
              <Surface
                fill={hex(theme.pinnedSelectedRim)}
                cornerRadius={10}
                shadowColor={theme.dark ? "#FFFFFF" : "#000000"}
                shadowOpacity={theme.dark ? 0.15 : 0.12}
                shadowRadius={1.5}
                shadowOffset={[0, 0.5]}
                style={{ width: PINNED_WIDTH, height: CHIP_HEIGHT, padding: 1 }}
              >
                <View style={{ flex: 1, borderRadius: 9, backgroundColor: theme.pinnedSelectedFill, borderTopWidth: 1, borderColor: theme.pinnedSelectedOutline, alignItems: "center", justifyContent: "center" }}>
                  <View>
                    <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                    <TabBadges tabId={tab.id} />
                  </View>
                </View>
              </Surface>
            ) : (
              <View
                style={{
                  width: PINNED_WIDTH,
                  height: CHIP_HEIGHT,
                  borderRadius: 10,
                  borderWidth: 0.5,
                  borderColor: theme.pinnedRestingStroke,
                  backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : theme.pinnedResting,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View>
                  <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                  <TabBadges tabId={tab.id} />
                </View>
              </View>
            )
          }
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

/** A group's label chip: colour dot or icon + name; click collapses / expands the group. */
function GroupLabel({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const group = useBrowser((s) => s.groups[groupId]);
  const { hovered, hoverProps } = useHover();
  if (!group) return null;
  const tint = group.color ? GROUP_COLORS[group.color].hex : null;
  return (
    <View {...hoverProps} tooltip={group.collapsed ? "Expand Group" : "Collapse Group"}>
      <Pressable onPress={() => useBrowser.getState().updateGroup(groupId, { collapsed: !group.collapsed })}>
        {({ pressed }) => (
          <View
            style={{
              height: CHIP_HEIGHT,
              maxWidth: 140,
              paddingHorizontal: 10,
              borderRadius: 10,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: tint ? withAlpha(tint, pressed ? 0.34 : hovered ? 0.28 : 0.2) : pressed ? theme.tabPressed : hovered ? theme.tabHover : theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)",
            }}
          >
            {group.icon ? <Text style={{ fontSize: 13 }}>{group.icon}</Text> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tint ?? theme.textSecondary }} />}
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, fontWeight: "600", color: tint ?? theme.textPrimary }}>
              {group.name || (group.collapsed ? `${group.tabIds.length} Tabs` : "Group")}
            </Text>
            {group.collapsed && group.name ? <Text style={{ fontSize: 11, color: theme.textSecondary }}>{group.tabIds.length}</Text> : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

/** A split as one chip: each pane's icon and title, split by hairlines; the focused pane reads brightest. */
function SplitChip({ tabIds, width, group }: { tabIds: string[]; width: number; group: string | null }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const active = useBrowser((s) => {
    const w = s.windows[windowId];
    return !!w && tabIds.includes(w.activeTabIds[w.profileId] ?? "");
  });
  const groupColor = useBrowser((s) => (group ? s.groups[group]?.color : null));
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <ChipSurface active={active} hovered={hovered} pressed={false} width={width}>
        <Symbol name="rectangle.split.2x1" size={11} color={theme.textSecondary} style={{ width: 14, height: 16, marginRight: 4 }} />
        {tabIds.map((id, i) => (
          <SplitPart key={id} tabId={id} first={i === 0} />
        ))}
        {groupColor !== undefined && group ? <GroupUnderline color={groupColor} /> : null}
      </ChipSurface>
    </View>
  );
}

function SplitPart({ tabId, first }: { tabId: string; first: boolean }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const focused = useIsActiveTab(tabId);
  if (!tab) return null;
  return (
    <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)} style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
      {!first && <View style={{ width: StyleSheet.hairlineWidth, height: 16, marginHorizontal: 6, backgroundColor: theme.textTertiary }} />}
      <Pressable onPress={() => useBrowser.getState().activate(tab.id)} style={{ flex: 1, flexDirection: "row", alignItems: "center" }} tooltip={tab.title || tab.url}>
        <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} profileId={tab.profileId} />
        <FadeLabel text={tab.customTitle || tab.title || tab.url || "New Tab"} fontSize={12} color={focused ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 16, marginLeft: 5 }} />
      </Pressable>
    </ContextMenuArea>
  );
}

function NewTabButton({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip="New Tab (⌘T) — ⌥-click to open in Split View">
      <Pressable
        onPress={(e) => {
          if (modifiersOf(e).altKey) openNewTabInSplit(windowId);
          else useBrowser.getState().newTab(windowId);
        }}
      >
        {({ pressed }) => (
          <View style={{ width: CHIP_HEIGHT, height: CHIP_HEIGHT, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined }}>
            <Symbol name="plus" size={13} weight="medium" color={theme.textSecondary} style={{ width: 16, height: 16 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

/**
 * Focus Mode (⌘S) with tabs on top: hovering the window's top edge slides the
 * strip down over the page as a floating bar; it slides away when the pointer leaves.
 */
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
      {/* The traffic lights keep their corner. */}
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
            height: TOP_STRIP_HEIGHT,
            opacity: slide,
            transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-TOP_STRIP_HEIGHT - 8, 0] }) }],
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
            <View style={{ position: "absolute", left: 0, right: 0, top: -3, height: TOP_STRIP_HEIGHT }}>
              <TopTabStrip floating />
            </View>
          </Surface>
        </Animated.View>
      )}
    </>
  );
}
