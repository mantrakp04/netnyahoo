import { ContextMenuArea, DockSelection, MouseArea, Surface, Symbol } from "@netnyahoo/shell";
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { closeTab } from "../../lib/actions";
import { hex, layout, useTheme } from "../../lib/theme";
import { useTileTheme, type TileTheme } from "../../lib/tileTheme";
import { GlassFill, liquidGlass } from "../glass";
import { listTopGap, useAddressBarInSidebar } from "../layout/windowLayout";
import { useBrowser } from "../../store/browser";
import { useIsActiveTab, useTab, useTabLive, useWindowId } from "../../store/hooks";
import { awayFromPin } from "../../store/organize";
import { NextMeetingBadge } from "../live/NextMeetingBadge";
import { clickTab, startRename } from "./actions";
import { useDragController, useDragItem } from "./dnd";
import { dismissHover, useRowHover } from "./hover";
import { openTabMenu } from "./menus";
import { registerRow } from "./state";
import { TabIcon } from "./TabIcon";
import { TabBadges } from "../media/TabBadges";
import { clickMods } from "./TabRow";
import { useSidebarTokens } from "./tokens";

const GAP = 6;
const MIN_TILE = 50;
/** TabDockView's itemStrokeWidth: the selected tile's ring. */
const SELECTION_STROKE = 3;
/** The selected glass tile's rim: a hairline of light, not Dia's ring. */
const GLASS_RIM = 1;

/** Pinned tabs as tiles (Dia's tab dock), as many per row as fit. */
export function PinnedGrid({ tabs, innerWidth, dragging }: { tabs: string[]; innerWidth: number; dragging: boolean }) {
  const controller = useDragController();
  const columns = Math.max(1, Math.min(tabs.length || 1, Math.floor((innerWidth + GAP) / (MIN_TILE + GAP))));
  const width = Math.floor(((innerWidth - GAP * (columns - 1)) / columns) * 2) / 2;
  const tail = useDragItem("tail:tiles", { kind: "tail", tabIds: [], section: "tiles" });
  const topGap = listTopGap(useAddressBarInSidebar());
  const empty = tabs.length === 0;
  // With no pinned tabs, a drop zone shows while dragging so tabs can still be pinned.
  if (empty && !dragging) return null;
  return (
    <View
      ref={(v) => {
        controller?.regions.set("tiles", v);
      }}
      style={{ marginTop: topGap, flexDirection: "row", flexWrap: "wrap", rowGap: GAP, columnGap: GAP }}
    >
      {tabs.map((id) => (
        <PinnedTile key={id} tabId={id} width={width} />
      ))}
      {empty ? <PinDropZone width={innerWidth} /> : null}
      {/* Appending needs no gap; the tail only marks "after the last tile". */}
      <Animated.View ref={tail.wrapper.ref} style={{ position: "absolute", right: 0, bottom: 0, width: 0, height: 0 }} />
    </View>
  );
}

function PinDropZone({ width }: { width: number }) {
  const tokens = useSidebarTokens();
  const theme = useTheme();
  return (
    <View
      style={{
        width,
        height: layout.pinnedHeight,
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: tokens.dragBorder,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Symbol name="pin" size={13} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
    </View>
  );
}

function PinnedTile({ tabId, width }: { tabId: string; width: number }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const selected = useBrowser((s) => (s.selection[windowId] ?? []).includes(tabId));
  const playing = useTabLive(tabId, (l) => l.playingAudio);
  const { hovered, hoverProps } = useRowHover(windowId, { kind: "tab", id: tabId });
  const { wrapper, handle } = useDragItem(`t:${tabId}`, { kind: "tile", tabIds: [tabId], section: "tiles" }, () => useBrowser.getState().selection[windowId] ?? []);
  const away = !!tab && awayFromPin(tab);
  const tileTheme = useTileTheme(tab?.url ?? "", tab?.favicon, tab?.customIcon, tab?.profileId ?? "");
  // Dia animates its pinned-tab badge in and out.
  const badge = useRef(new Animated.Value(away ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(badge, { toValue: away ? 1 : 0, speed: 18, bounciness: 8, useNativeDriver: false }).start();
  }, [away]);
  if (!tab) return null;
  const radius = 10;

  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style} {...handle}>
      <View
        ref={(v) => registerRow(windowId, tabId, v)}
        {...hoverProps}
        onDoubleClick={() => void startRename(windowId, { kind: "tab", id: tabId })}
      >
        {/* Middle-click closes like ⌘W: the page unloads and the tile stays. */}
        <MouseArea onMiddleClick={() => void closeTab(tabId)}>
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
              {({ pressed }) =>
                liquidGlass ? (
                  <GlassTile tabId={tabId} width={width} active={active} selected={selected} hovered={hovered} pressed={pressed} tileTheme={tileTheme} />
                ) : active && tileTheme ? (
                  // Selected, themed by its icon (lib/tileTheme): the icon's colours in the fill and ring.
                  <DockSelection
                    image={tileTheme.image}
                    emoji={tileTheme.emoji}
                    theme={tileTheme.theme.kind}
                    fill={tileTheme.theme.kind === "template" ? tileTheme.theme.fill : undefined}
                    stroke={tileTheme.theme.kind === "template" ? tileTheme.theme.stroke : undefined}
                    cornerRadius={radius}
                    strokeWidth={SELECTION_STROKE}
                    dark={theme.dark}
                    style={{ width, height: layout.pinnedHeight, alignItems: "center", justifyContent: "center" }}
                  >
                    <View>
                      {tileTheme.theme.kind === "template" ? (
                        // DockSelection draws a one-colour icon itself, white on its colour.
                        <View style={{ width: 16, height: 16 }} />
                      ) : (
                        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                      )}
                      <TabBadges tabId={tabId} />
                    </View>
                  </DockSelection>
                ) : active ? (
                  // Selected, no icon theme: black rim (SelectedPrimary) → white fill (SelectedSecondary) → top bevel (TabOutline).
                  <Surface
                    fill={hex(theme.pinnedSelectedRim)}
                    cornerRadius={radius}
                    shadowColor={theme.dark ? "#FFFFFF" : "#000000"}
                    shadowOpacity={theme.dark ? 0.15 : 0.12}
                    shadowRadius={1.5}
                    shadowOffset={[0, 0.5]}
                    style={{ width, height: layout.pinnedHeight, padding: 1 }}
                  >
                    <View
                      style={{
                        flex: 1,
                        borderRadius: radius - 1,
                        backgroundColor: theme.pinnedSelectedFill,
                        borderTopWidth: 1,
                        borderColor: theme.pinnedSelectedOutline,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <View>
                        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                        <TabBadges tabId={tabId} />
                      </View>
                    </View>
                  </Surface>
                ) : (
                  <View
                    style={{
                      width,
                      height: layout.pinnedHeight,
                      borderRadius: radius,
                      borderWidth: selected ? 1 : 0.5,
                      borderColor: selected ? tokens.dragBorder : theme.pinnedRestingStroke,
                      backgroundColor: pressed ? theme.tabPressed : hovered || selected ? theme.tabHover : theme.pinnedResting,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <View>
                      <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                      <TabBadges tabId={tabId} />
                    </View>
                  </View>
                )
              }
            </Pressable>
          </ContextMenuArea>
        </MouseArea>
        {/* Navigated away from the pinned page: click the badge to go back (⌘↩). */}
        <Animated.View
          pointerEvents={away ? "auto" : "none"}
          style={{ position: "absolute", top: 3, right: 3, opacity: badge, transform: [{ scale: badge.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }}
        >
          <Pressable onPress={() => useBrowser.getState().returnToPinnedUrl(tabId)} tooltip="Back to Pinned URL (⌘↩)">
            <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: tokens.badge, alignItems: "center", justifyContent: "center" }}>
              <Symbol name="arrow.uturn.backward" size={7} weight="bold" color={tokens.badgeGlyph} style={{ width: 10, height: 10 }} />
            </View>
          </Pressable>
        </Animated.View>
        <NextMeetingBadge tabId={tabId} />
        {playing || tab.muted ? (
          <View pointerEvents="none" style={{ position: "absolute", bottom: 3, right: 4 }}>
            <Symbol name={tab.muted ? "speaker.slash.fill" : "speaker.wave.2.fill"} size={8} color={theme.textSecondary} style={{ width: 12, height: 10 }} />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

/**
 * A tile on Liquid Glass (components/glass): Dia's states as the glass's tint (resting, hover or
 * multi-selected, pressed, selected), in the same box as the flat tile. The glass stays mounted
 * across states (it's the first child whatever the state), so hovering only retints it. Selected,
 * the glass is raised rather than ringed (DockSelection `glass`): brighter, with a shadow, a sheen,
 * a thin light rim and a hint of the icon's hue; pressed, it sinks back a little.
 */
function GlassTile({
  tabId,
  width,
  active,
  selected,
  hovered,
  pressed,
  tileTheme,
}: {
  tabId: string;
  width: number;
  active: boolean;
  selected: boolean;
  hovered: boolean;
  pressed: boolean;
  tileTheme: TileTheme | null;
}) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const tab = useTab(tabId);
  if (!tab) return null;
  const radius = 10;
  const fill = active ? theme.pinnedSelectedFill : pressed ? theme.tabPressed : hovered || selected ? theme.tabHover : theme.pinnedResting;
  return (
    <View style={{ width, height: layout.pinnedHeight, alignItems: "center", justifyContent: "center" }}>
      <GlassFill radius={radius} fill={fill} raised={active && !pressed} />
      {active ? (
        <DockSelection
          image={tileTheme?.image}
          emoji={tileTheme?.emoji}
          theme={tileTheme?.theme.kind}
          fill={tileTheme?.theme.kind === "template" ? tileTheme.theme.fill : undefined}
          cornerRadius={radius}
          strokeWidth={GLASS_RIM}
          dark={theme.dark}
          glass
          style={StyleSheet.absoluteFill}
        />
      ) : selected ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: tokens.dragBorder }]} />
      ) : null}
      <View>
        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
        <TabBadges tabId={tabId} />
      </View>
    </View>
  );
}
