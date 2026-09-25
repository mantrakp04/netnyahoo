import { ActivitySpinner, ContextMenuArea, FadeLabel, Surface, Symbol } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, TextInput, View, type GestureResponderEvent } from "react-native";
import { closeTab, toggleMute } from "../../lib/actions";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsActiveTab, useTab, useTabLive, useWindowId } from "../../store/hooks";
import { IconButton } from "../primitives";
import { clickTab, commitRename, endRename, startRename, tabTitle } from "./actions";
import { useDragItem } from "./dnd";
import { dismissHover, useRowHover } from "./hover";
import { openTabMenu } from "./menus";
import { registerRow, useSidebarUi } from "./state";
import { TabIcon } from "./TabIcon";
import { TabBadges } from "../media/TabBadges";
import { useSidebarTokens } from "./tokens";

/** Modifier keys of a click (react-native-macos reports them on the press event). */
export const clickMods = (e: GestureResponderEvent) => {
  const n = e.nativeEvent as unknown as { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };
  return { metaKey: !!n.metaKey, shiftKey: !!n.shiftKey, altKey: !!n.altKey };
};

const useSelection = (windowId: string) => () => useBrowser.getState().selection[windowId] ?? [];

/** A tab in the list (or a group): draggable, with its context menu and hover card. */
export function TabRowItem({ tabId, section, parentGroup }: { tabId: string; section: "list" | "pinnedGroups"; parentGroup?: string }) {
  const windowId = useWindowId();
  const selection = useSelection(windowId);
  const { wrapper, handle } = useDragItem(`t:${tabId}`, { kind: "row", tabIds: [tabId], section, parentGroup }, selection);
  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style} {...handle}>
      <TabRow tabId={tabId} />
    </Animated.View>
  );
}

/** Dia's tab row: favicon, audio glyph, fading title, loading spinner, close button on hover. */
export function TabRow({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const selected = useBrowser((s) => (s.selection[windowId] ?? []).includes(tabId));
  const playingAudio = useTabLive(tabId, (l) => l.playingAudio);
  const loading = useTabLive(tabId, (l) => l.isLoading);
  const renaming = useSidebarUi((u) => u.renaming?.kind === "tab" && u.renaming.id === tabId);
  const { hovered, hoverProps } = useRowHover(windowId, renaming ? null : { kind: "tab", id: tabId });
  if (!tab) return null;
  const title = tabTitle(tab);
  const fill = active ? theme.tabSelected : selected ? tokens.multiSelected : hovered ? theme.tabHover : "rgba(0,0,0,0)";

  return (
    <View
      ref={(v) => registerRow(windowId, tabId, v)}
      {...hoverProps}
      onDoubleClick={() => void startRename(windowId, { kind: "tab", id: tabId })}
    >
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openTabMenu(windowId, tab);
        }}
      >
        <Pressable
          onPress={(e) => {
            dismissHover();
            clickTab(windowId, tabId, clickMods(e));
          }}
        >
          {({ pressed }) => (
            // Selected: dark fill + TabOutline hairline + TabSelectedShadow glow (white in dark mode).
            <Surface
              fill={hex(!active && pressed ? theme.tabPressed : fill)}
              cornerRadius={10}
              borderWidth={active ? 1 : selected ? 0.5 : 0}
              borderColor={selected && !active ? hex(tokens.multiSelectedStroke) : undefined}
              borderColors={active ? theme.tabSelectedBorder.map(hex) : undefined}
              shadowColor={active ? hex(theme.tabSelectedShadow) : undefined}
              shadowOpacity={active ? 1 : 0}
              shadowRadius={theme.tabSelectedShadowRadius}
              shadowOffset={[0, 0.5]}
              // TabContentView: favicon 16 at x 9, title 7 after it, close button 22 at 6 from the end.
              style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 6 }}
            >
              <View>
                <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                <TabBadges tabId={tab.id} />
              </View>
              {(playingAudio || tab.muted) && (
                <Pressable onPress={() => toggleMute(tab.id)} style={{ marginLeft: 6 }} tooltip={tab.muted ? "Unmute Site" : "Mute Site"}>
                  <Symbol name={tab.muted ? "speaker.slash" : "speaker.wave.2"} size={12} color={theme.textTab} style={{ width: 18, height: 16 }} />
                </Pressable>
              )}
              {renaming ? (
                <RenameField
                  initial={tab.customTitle ?? tab.title}
                  placeholder={tab.title || "Tab name"}
                  color={active ? theme.tabSelectedText : theme.textPrimary}
                  onDone={(text) => (text === null ? endRename({ kind: "tab", id: tabId }) : commitRename({ kind: "tab", id: tabId }, text))}
                />
              ) : (
                <FadeLabel text={title} fontSize={13} color={active ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 18, marginLeft: 5 }} />
              )}
              {hovered && !renaming ? (
                <IconButton icon="xmark" size={10} weight="semibold" box={22} radius={6} onPress={() => void closeTab(tab.id)} tooltip="Close Tab (⌘W)" />
              ) : (
                // TabContentView's trailing ActivitySpinnerView: 12pt, 8pt from the row's end.
                loading && <ActivitySpinner style={{ width: 12, height: 12, marginLeft: 6, marginRight: 2 }} />
              )}
            </Surface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

/** Inline rename: ↩ saves, ⎋ cancels, clicking away saves. `onDone(null)` = cancelled. */
export function RenameField({
  initial,
  placeholder,
  color,
  fontSize = 13,
  weight,
  onDone,
}: {
  initial: string;
  placeholder: string;
  color: string;
  fontSize?: number;
  weight?: "500" | "600";
  onDone(text: string | null): void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const input = useRef<TextInput>(null);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  // Focus after mount: the row's own click may still be in flight.
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <TextInput
      ref={input}
      value={text}
      onChangeText={setText}
      placeholder={placeholder}
      placeholderTextColor={theme.placeholder}
      selectionColor={theme.selection}
      selectTextOnFocus
      enableFocusRing={false}
      onSubmitEditing={() => finish(text)}
      onBlur={() => finish(text)}
      keyDownEvents={[{ key: "Escape" }]}
      onKeyDown={(e) => e.nativeEvent.key === "Escape" && finish(null)}
      style={{ flex: 1, height: 18, marginLeft: 5, fontSize, fontWeight: weight, color, paddingVertical: 0, paddingHorizontal: 0 }}
    />
  );
}

/** A split view in the list: one row, a segment per pane. */
export function SplitRowItem({ splitId, section, parentGroup }: { splitId: string; section: "list" | "pinnedGroups"; parentGroup?: string }) {
  const windowId = useWindowId();
  const tabIds = useBrowser((s) => s.splits[splitId]?.tabIds.filter((id) => s.tabs[id] && !s.tabs[id]!.pinned).join(",") ?? "").split(",").filter(Boolean);
  const { wrapper, handle } = useDragItem(`s:${splitId}`, { kind: "split", tabIds, section, parentGroup });
  const theme = useTheme();
  const active = useBrowser((s) => {
    const w = s.windows[windowId];
    return !!w && tabIds.includes(w.activeTabIds[w.profileId] ?? "");
  });
  const { hovered, hoverProps } = useRowHover(windowId, null);
  if (tabIds.length < 2) return null;
  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style} {...handle}>
      <View ref={(v) => registerRow(windowId, `s:${splitId}`, v)} {...hoverProps}>
        <Surface
          fill={hex(active ? theme.tabSelected : hovered ? theme.tabHover : "rgba(0,0,0,0)")}
          cornerRadius={10}
          borderWidth={active ? 1 : 0}
          borderColors={active ? theme.tabSelectedBorder.map(hex) : undefined}
          shadowColor={active ? hex(theme.tabSelectedShadow) : undefined}
          shadowOpacity={active ? 1 : 0}
          shadowRadius={theme.tabSelectedShadowRadius}
          shadowOffset={[0, 0.5]}
          style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingHorizontal: 3 }}
        >
          {tabIds.map((id, i) => (
            <View key={id} style={{ flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 }}>
              {i > 0 && <View style={{ width: 1, height: 16, backgroundColor: theme.divider, marginRight: 2 }} />}
              <SplitPane tabId={id} windowId={windowId} />
            </View>
          ))}
        </Surface>
      </View>
    </Animated.View>
  );
}

function SplitPane({ tabId, windowId }: { tabId: string; windowId: string }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const { hovered, hoverProps } = useRowHover(windowId, { kind: "tab", id: tabId });
  if (!tab) return null;
  return (
    <View {...hoverProps} style={{ flex: 1, minWidth: 0 }}>
      <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)}>
        <Pressable onPress={(e) => clickTab(windowId, tabId, clickMods(e))}>
          <View
            style={{
              height: layout.rowHeight - 6,
              borderRadius: 7,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 6,
              backgroundColor: hovered && !active ? theme.rowHover : undefined,
            }}
          >
            <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} />
            <FadeLabel text={tabTitle(tab)} fontSize={12} color={active ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 16, marginLeft: 5 }} />
          </View>
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
