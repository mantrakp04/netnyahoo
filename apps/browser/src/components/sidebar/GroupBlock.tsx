import { ContextMenuArea, FadeLabel, Surface, Symbol } from "@arcadia/shell";
import { memo } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { usePageProfileId, useWindowId } from "../../store/hooks";
import { groupLabel } from "../../store/organize";
import { MeetingTimeLabel, useMeetingCountdown } from "../live/MeetingCountdown";
import { HoverSlot } from "../HoverSlot";
import { IconButton } from "../primitives";
import { commitRename, endRename, startRename } from "./actions";
import { useDragItem, useDropInto } from "./dnd";
import { Fold, useFold } from "./Fold";
import { GROUP_BORDER, GROUP_PAD, keptEntry } from "./geometry";
import { useGroupEntries } from "./entries";
import { dismissHover, useRowHover } from "./hover";
import { openGroupMenu } from "./menus";
import { registerRow, useSidebarUi } from "./state";
import { TabIcon } from "./TabIcon";
import { RenameField, SplitRowItem, TabRowItem } from "./TabRow";
import { GROUP_COLORS, useSidebarTokens, withAlpha } from "./tokens";

const PAD = GROUP_PAD;

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
  const activeEntry = useBrowser((s) => keptEntry(s, windowId, profileId, entries));
  const { wrapper, handle, headerRef } = useDragItem(`g:${groupId}`, { kind: "group", tabIds: tabIds.split(",").filter(Boolean), section, groupId, collapsed });
  const tail = useDragItem(`tail:group:${groupId}`, { kind: "tail", tabIds: [], section, parentGroup: groupId });

  const fold = useFold(collapsed);

  const spec = color ? GROUP_COLORS[color] : null;
  const fill = spec ? withAlpha(spec.hex, 0.16) : tokens.groupFill;
  const stroke = spec ? withAlpha(spec.hex, 0.3) : tokens.groupStroke;

  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style}>
      <View style={{ borderRadius: 12, backgroundColor: fill, borderWidth: GROUP_BORDER, borderColor: stroke, paddingHorizontal: PAD }}>
        <View ref={headerRef} {...handle}>
          <GroupHeader groupId={groupId} windowId={windowId} collapsed={collapsed} open={fold.open} />
        </View>
        {/* A collapsed group's members aren't mounted (a big group would otherwise cost as much as if it were open); they
            mount for the animation. Selected members stay mounted: a multi-tab drag gathers its rows from the mounted
            ones (sidebar/dnd.tsx). The active tab stays out while the group is collapsed, as in Arc and Dia. */}
        <Fold
          fold={fold}
          collapsed={collapsed}
          entries={entries.map((entry) => ({ key: entry, node: <Entry entry={entry} section={section} groupId={groupId} /> }))}
          keep={activeEntry}
          gap={layout.rowGap}
          rowHeight={layout.rowHeight}
          padBottom={PAD}
          mountClosed={selectedInside}
          footer={<Animated.View ref={tail.wrapper.ref} style={tail.wrapper.style} />}
        />
      </View>
    </Animated.View>
  );
});

const Entry = memo(function Entry({ entry, section, groupId }: { entry: string; section: "list" | "pinnedGroups"; groupId: string }) {
  return entry.startsWith("s:") ? (
    <SplitRowItem splitId={entry.slice(2)} section={section} parentGroup={groupId} />
  ) : (
    <TabRowItem tabId={entry.slice(2)} section={section} parentGroup={groupId} />
  );
});

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
                  {/* The name is as wide as its (transparent) text, laid out in the same pass: the chevron follows it
                      from the first frame. The label draws over it with 8 pt more for its fade. */}
                  <View style={{ flexShrink: 1, height: 18, paddingRight: 8, justifyContent: "center" }}>
                    <Text numberOfLines={1} style={{ opacity: 0, fontSize: 13, fontWeight: "500" }}>
                      {label}
                    </Text>
                    <FadeLabel text={label} fontSize={13} weight="medium" color={tokens.groupTitle} style={{ position: "absolute", left: 0, right: 0, top: 0, height: 18 }} />
                  </View>
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
              <HoverSlot
                hovered={hovered && !renaming}
                width={22}
                hover={<IconButton icon="xmark" size={10} weight="semibold" box={22} radius={6} onPress={() => useBrowser.getState().closeGroup(groupId)} tooltip="Close Group" />}
              >
                {countdown.label && !renaming ? <MeetingTimeLabel label={countdown.label} urgent={countdown.urgent} /> : null}
              </HoverSlot>
            </Surface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
