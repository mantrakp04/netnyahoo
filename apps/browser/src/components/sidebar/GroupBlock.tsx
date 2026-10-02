import { ContextMenuArea, FadeLabel, Surface, Symbol } from "@netnyahoo/shell";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
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
// Dia 1.50.1 (owner recording, 60 fps): a group opens or closes in about 150 ms, fast at first.
const TOGGLE_MS = 150;
const TOGGLE_EASING = Easing.bezier(0.2, 0.9, 0.3, 1);

export const GroupBlock = memo(function GroupBlock({ groupId, section }: { groupId: string; section: "list" | "pinnedGroups" }) {
  const windowId = useWindowId();
  const tokens = useSidebarTokens();
  const collapsed = useBrowser((s) => !!s.groups[groupId]?.collapsed);
  const color = useBrowser((s) => s.groups[groupId]?.color ?? null);
  const tabIds = useBrowser((s) => s.groups[groupId]?.tabIds.join(",") ?? "");
  const entries = useGroupEntries(groupId);
  const selectedInside = useBrowser((s) => {
    const selection = s.selection[windowId];
    return !!selection?.length && !!s.groups[groupId]?.tabIds.some((id) => selection.includes(id));
  });
  const profileId = usePageProfileId();
  // The window's active tab, when it's a member: it stays out while the group is collapsed, as in Arc and Dia.
  const activeEntry = useBrowser((s) => {
    const active = activeTabId(s, windowId, profileId);
    if (!active) return null;
    return entries.find((e) => e === `t:${active}` || (e.startsWith("s:") && !!s.splits[e.slice(2)]?.tabIds.includes(active))) ?? null;
  });
  const { wrapper, handle, headerRef } = useDragItem(`g:${groupId}`, { kind: "group", tabIds: tabIds.split(",").filter(Boolean), section, groupId, collapsed });
  const tail = useDragItem(`tail:group:${groupId}`, { kind: "tail", tabIds: [], section, parentGroup: groupId });

  const open = useRef(new Animated.Value(collapsed ? 0 : 1)).current;
  const [measured, setMeasured] = useState({ height: 0, count: -1 });
  const settled = useRef(collapsed);
  const [animating, setAnimating] = useState(false);
  const moving = animating || settled.current !== collapsed;
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setAnimating(true);
    // JS driver: the height reflows the rows below.
    Animated.timing(open, { toValue: collapsed ? 0 : 1, duration: TOGGLE_MS, easing: TOGGLE_EASING, useNativeDriver: false }).start(
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
  // A collapsed group's members aren't mounted (a big group would otherwise cost as much as if it were open); they
  // mount for the animation. Rows are fixed-height, so their height is known before they're measured.
  // Selected members stay mounted: a multi-tab drag gathers its rows from the mounted ones (sidebar/dnd.tsx).
  const membersShown = !collapsed || moving || selectedInside;
  // With the active tab inside, the group folds around it: that row stays put at full opacity while the others slide
  // away or back (it used to fade out with them and pop back in, a flicker on every click). Each folded row cancels
  // the list's gap after it.
  const folding = !!activeEntry && (collapsed || moving);
  const fold = useMemo(
    () => ({
      moving: {
        height: open.interpolate({ inputRange: [0, 1], outputRange: [0, layout.rowHeight] }),
        marginBottom: open.interpolate({ inputRange: [0, 1], outputRange: [-layout.rowGap, 0] }),
        opacity: open,
        overflow: "hidden" as const,
      },
      closed: { height: 0, marginBottom: -layout.rowGap, opacity: 0, overflow: "hidden" as const },
    }),
    [open],
  );
  const contentHeight =
    measured.count === entries.length ? measured.height : entries.length * layout.rowHeight + Math.max(0, entries.length - 1) * layout.rowGap + PAD;
  const membersStyle = folding
    ? null
    : moving
      ? { height: open.interpolate({ inputRange: [0, 1], outputRange: [0, contentHeight] }), opacity: open, overflow: "hidden" as const }
      : collapsed
        ? { height: 0, opacity: 0, overflow: "hidden" as const }
        : null;

  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style}>
      <View style={{ borderRadius: 12, backgroundColor: fill, borderWidth: 0.5, borderColor: stroke, paddingHorizontal: PAD }}>
        <View ref={headerRef} {...handle}>
          <GroupHeader groupId={groupId} windowId={windowId} collapsed={collapsed} open={open} />
        </View>
        <Animated.View style={membersStyle} pointerEvents={collapsed ? "box-none" : "auto"}>
          <View
            onLayout={(e) => (!collapsed || moving) && !folding && setMeasured({ height: e.nativeEvent.layout.height, count: entries.length })}
            style={{ gap: layout.rowGap, paddingBottom: PAD }}
          >
            {entries.map((entry) => {
              const stays = entry === activeEntry;
              if (!stays && !membersShown) return null;
              // One wrapper per entry in every state, so the active row never remounts as the group opens or closes.
              return (
                <Animated.View key={entry} style={folding && !stays ? (moving ? fold.moving : fold.closed) : null} pointerEvents={collapsed && !stays ? "none" : "auto"}>
                  <Entry entry={entry} section={section} groupId={groupId} />
                </Animated.View>
              );
            })}
            <Animated.View ref={tail.wrapper.ref} style={tail.wrapper.style} />
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
});

function Entry({ entry, section, groupId }: { entry: string; section: "list" | "pinnedGroups"; groupId: string }) {
  return entry.startsWith("s:") ? (
    <SplitRowItem splitId={entry.slice(2)} section={section} parentGroup={groupId} />
  ) : (
    <TabRowItem tabId={entry.slice(2)} section={section} parentGroup={groupId} />
  );
}

// `open` is the members' collapse animation: the chevron turns on its frames, so the two never drift apart.
function GroupHeader({ groupId, windowId, collapsed, open }: { groupId: string; windowId: string; collapsed: boolean; open: Animated.Value }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const group = useBrowser((s) => s.groups[groupId]);
  const label = useBrowser((s) => (s.groups[groupId] ? groupLabel(s, s.groups[groupId]!) : ""));
  // The first tab's icon fields only: its title, loading and bookkeeping changes don't re-render the header.
  const firstTab = useBrowser(
    useShallow((s) => {
      const t = s.tabs[s.groups[groupId]?.tabIds[0] ?? ""];
      return t && { url: t.url, favicon: t.favicon, customIcon: t.customIcon, profileId: t.profileId };
    }),
  );
  const renaming = useSidebarUi((u) => u.renaming?.kind === "group" && u.renaming.id === groupId);
  const dropInto = useDropInto() === groupId;
  const { hovered, hoverProps } = useRowHover(windowId, collapsed && !renaming ? { kind: "group", id: groupId } : null);
  const countdown = useMeetingCountdown(groupId);
  const [labelWidth, setLabelWidth] = useState(0);
  if (!group) return null;
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
                // Dia: the name, then a chevron right after it (∨ open, › closed), no count.
                <Animated.View style={{ flex: 1, height: 18, marginLeft: 5, flexDirection: "row", alignItems: "center", transform: [{ rotate: countdown.rotate }] }}>
                  <Text
                    numberOfLines={1}
                    onLayout={(e) => setLabelWidth(Math.ceil(e.nativeEvent.layout.width))}
                    style={{ position: "absolute", opacity: 0, fontSize: 13, fontWeight: "500" }}
                  >
                    {label}
                  </Text>
                  <FadeLabel text={label} fontSize={13} weight="medium" color={tokens.groupTitle} style={{ width: labelWidth + 8, flexShrink: 1, height: 18 }} />
                  <Animated.View
                    style={{
                      width: 10,
                      height: 10,
                      marginLeft: 0,
                      alignItems: "center",
                      justifyContent: "center",
                      transform: [{ rotate: open.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) }],
                    }}
                  >
                    <Symbol name="chevron.down" size={9} weight="semibold" color={withAlpha(tokens.groupTitle, 0.5)} style={{ width: 10, height: 10 }} />
                  </Animated.View>
                </Animated.View>
              )}
              {hovered && !renaming ? (
                <IconButton icon="xmark" size={10} weight="semibold" box={22} radius={6} onPress={() => useBrowser.getState().closeGroup(groupId)} tooltip="Close Group" />
              ) : countdown.label && !renaming ? (
                <MeetingTimeLabel label={countdown.label} urgent={countdown.urgent} />
              ) : null}
            </Surface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
