import { ContextMenuArea, FadeLabel, Surface } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { usePageProfileId, useWindowId } from "../../store/hooks";
import { activeTabId } from "../../store/model";
import { groupLabel } from "../../store/organize";
import { MeetingTimeLabel, useMeetingCountdown } from "../live/MeetingCountdown";
import { IconButton } from "../primitives";
import { commitRename, endRename, startRename } from "./actions";
import { useDragItem, useDropInto } from "./dnd";
import { useGroupEntries } from "./entries";
import { dismissHover, useRowHover } from "./hover";
import { openGroupMenu } from "./menus";
import { registerRow, useSidebarUi } from "./state";
import { TabIcon } from "./TabIcon";
import { RenameField, SplitRowItem, TabRowItem } from "./TabRow";
import { GROUP_COLORS, useSidebarTokens, withAlpha } from "./tokens";

const PAD = 2;

/**
 * A tab group in the sidebar (Dia ≥ 1.28: neutral container unless coloured):
 * a header (icon, name, count when collapsed, ✕ on hover) over its tabs, which
 * collapse with an animation. A collapsed group still shows its selected tab.
 */
export function GroupBlock({ groupId, section }: { groupId: string; section: "list" | "pinnedGroups" }) {
  const windowId = useWindowId();
  const tokens = useSidebarTokens();
  const collapsed = useBrowser((s) => !!s.groups[groupId]?.collapsed);
  const color = useBrowser((s) => s.groups[groupId]?.color ?? null);
  const tabIds = useBrowser((s) => s.groups[groupId]?.tabIds.join(",") ?? "");
  const entries = useGroupEntries(groupId);
  const profileId = usePageProfileId();
  // Collapsed, the selected tab (and so a split it's in) stays visible — Dia's peek at the active tab.
  const shownWhileCollapsed = useBrowser((s) => {
    if (!s.groups[groupId]?.collapsed) return null;
    const active = activeTabId(s, windowId, profileId);
    return entries.find((e) => e === `t:${active}` || (e.startsWith("s:") && !!active && !!s.splits[e.slice(2)]?.tabIds.includes(active))) ?? null;
  });
  const { wrapper, handle, headerRef } = useDragItem(`g:${groupId}`, { kind: "group", tabIds: tabIds.split(",").filter(Boolean), section, groupId, collapsed });
  const tail = useDragItem(`tail:group:${groupId}`, { kind: "tail", tabIds: [], section, parentGroup: groupId });

  const open = useRef(new Animated.Value(collapsed ? 0 : 1)).current;
  const [contentHeight, setContentHeight] = useState(0);
  // The state the last collapse/expand animation ended in; until it catches up, heights animate.
  const settled = useRef(collapsed);
  const [animating, setAnimating] = useState(false);
  const moving = animating || settled.current !== collapsed;
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    // A toggle mid-animation interrupts it (finished: false); the last one settles.
    setAnimating(true);
    Animated.timing(open, { toValue: collapsed ? 0 : 1, duration: 240, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: false }).start(
      ({ finished }) => {
        if (!finished) return;
        settled.current = collapsed;
        setAnimating(false);
      },
    );
  }, [collapsed]);

  const spec = color ? GROUP_COLORS[color] : null;
  const fill = spec ? withAlpha(spec.hex, 0.16) : tokens.groupFill;
  const stroke = spec ? withAlpha(spec.hex, 0.3) : tokens.groupStroke;
  const membersStyle = moving
    ? { height: open.interpolate({ inputRange: [0, 1], outputRange: [0, contentHeight] }), opacity: open, overflow: "hidden" as const }
    : collapsed
      ? { height: 0, opacity: 0, overflow: "hidden" as const }
      : null;

  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style}>
      <View style={{ borderRadius: 12, backgroundColor: fill, borderWidth: 0.5, borderColor: stroke, paddingHorizontal: PAD }}>
        <View ref={headerRef} {...handle}>
          <GroupHeader groupId={groupId} windowId={windowId} collapsed={collapsed} />
        </View>
        {shownWhileCollapsed && !moving ? (
          <View style={{ paddingBottom: PAD }}>
            <Entry entry={shownWhileCollapsed} section={section} groupId={groupId} />
          </View>
        ) : null}
        <Animated.View style={membersStyle} pointerEvents={collapsed ? "none" : "auto"}>
          <View onLayout={(e) => setContentHeight(e.nativeEvent.layout.height)} style={{ gap: layout.rowGap, paddingBottom: PAD }}>
            {entries.map((entry) =>
              collapsed && entry === shownWhileCollapsed && !moving ? null : <Entry key={entry} entry={entry} section={section} groupId={groupId} />,
            )}
            <Animated.View ref={tail.wrapper.ref} style={tail.wrapper.style} />
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function Entry({ entry, section, groupId }: { entry: string; section: "list" | "pinnedGroups"; groupId: string }) {
  return entry.startsWith("s:") ? (
    <SplitRowItem splitId={entry.slice(2)} section={section} parentGroup={groupId} />
  ) : (
    <TabRowItem tabId={entry.slice(2)} section={section} parentGroup={groupId} />
  );
}

function GroupHeader({ groupId, windowId, collapsed }: { groupId: string; windowId: string; collapsed: boolean }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const group = useBrowser((s) => s.groups[groupId]);
  const label = useBrowser((s) => (s.groups[groupId] ? groupLabel(s, s.groups[groupId]!) : ""));
  const firstTab = useBrowser((s) => s.tabs[s.groups[groupId]?.tabIds[0] ?? ""]);
  const renaming = useSidebarUi((u) => u.renaming?.kind === "group" && u.renaming.id === groupId);
  const dropInto = useDropInto() === groupId;
  // Hovering a collapsed group peeks at its tabs.
  const { hovered, hoverProps } = useRowHover(windowId, collapsed && !renaming ? { kind: "group", id: groupId } : null);
  // Meeting groups (src/live): "5 min left" near the end, and the title wiggles at 5 and 2 minutes.
  const countdown = useMeetingCountdown(groupId);
  if (!group) return null;
  const count = group.tabIds.length;
  const target = { kind: "group" as const, id: groupId };

  return (
    <View ref={(v) => registerRow(windowId, groupId, v)} {...hoverProps} onDoubleClick={() => void startRename(windowId, target)}>
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openGroupMenu(windowId, groupId);
        }}
      >
        <Pressable
          onPress={() => {
            dismissHover();
            if (!renaming) useBrowser.getState().updateGroup(groupId, { collapsed: !collapsed });
          }}
        >
          {({ pressed }) => (
            <Surface
              fill={hex(dropInto || pressed ? theme.tabPressed : hovered ? tokens.groupHeaderHover : "rgba(0,0,0,0)")}
              cornerRadius={10}
              // Icon and title line up with the member rows' favicons and titles.
              style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 6 - PAD }}
            >
              {group.icon || firstTab ? (
                <TabIcon url={firstTab?.url ?? ""} favicon={firstTab?.favicon} icon={group.icon ?? firstTab?.customIcon} profileId={firstTab?.profileId} />
              ) : (
                <View style={{ width: 16 }} />
              )}
              {renaming ? (
                <RenameField
                  initial={group.name}
                  placeholder={label}
                  color={tokens.groupTitle}
                  weight="500"
                  onDone={(text) => (text === null ? endRename(target) : commitRename(target, text))}
                />
              ) : (
                <Animated.View style={{ flex: 1, height: 18, marginLeft: 5, transform: [{ rotate: countdown.rotate }] }}>
                  <FadeLabel text={label} fontSize={13} weight="medium" color={tokens.groupTitle} style={{ flex: 1, height: 18 }} />
                </Animated.View>
              )}
              {hovered && !renaming ? (
                <IconButton icon="xmark" size={10} weight="semibold" box={22} radius={6} onPress={() => useBrowser.getState().closeGroup(groupId)} tooltip="Close Group" />
              ) : countdown.label && !renaming ? (
                <MeetingTimeLabel label={countdown.label} urgent={countdown.urgent} />
              ) : collapsed && !renaming ? (
                <View style={{ minWidth: 20, height: 18, borderRadius: 9, paddingHorizontal: 6, backgroundColor: tokens.countPill, alignItems: "center", justifyContent: "center", marginRight: 2 }}>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textTab, fontVariant: ["tabular-nums"] }}>{count}</Text>
                </View>
              ) : null}
            </Surface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
