import { ContextMenuArea, DockSelection, MouseArea, Surface, Symbol } from "@arcadia/shell";
import { memo, useEffect, useRef } from "react";
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
import { useDragController, useDragItem, useDropPins } from "./dnd";
import { dismissHover, useRowHover } from "./hover";
import { openTabMenu } from "./menus";
import { registerRow } from "./state";
import { TabIcon } from "./TabIcon";
import { TabBadges } from "../media/TabBadges";
import { clickMods } from "./TabRow";
import { useSidebarTokens } from "./tokens";

const GAP = 6;
const MIN_TILE = 50;
// Dia: 3pt stroke.
const SELECTION_STROKE = 3;
const GLASS_RIM = 1;

export const PinnedGrid = memo(function PinnedGrid({ tabs, innerWidth }: { tabs: string[]; innerWidth: number }) {
  const controller = useDragController();
  const columns = Math.max(1, Math.min(tabs.length || 1, Math.floor((innerWidth + GAP) / (MIN_TILE + GAP))));
  const width = Math.floor(((innerWidth - GAP * (columns - 1)) / columns) * 2) / 2;
  const tail = useDragItem("tail:tiles", { kind: "tail", tabIds: [], section: "tiles" });
  const topGap = listTopGap(useAddressBarInSidebar());
  // With no pinned tabs a drag's pin target is an overlay that takes no room (PinDropZone): nothing here.
  if (!tabs.length) return null;
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
      <Animated.View ref={tail.wrapper.ref} style={{ position: "absolute", right: 0, bottom: 0, width: 0, height: 0 }} />
    </View>
  );
});

/**
 * The pin target while a tab is dragged and nothing is pinned yet: laid over the sidebar in room it already has (the
 * address field, or the band between the header and the first row), so no row moves as a drag starts or ends.
 * It lights up while the drop would pin.
 */
export function PinDropZone({ top, height, cover }: { top: number; height: number; cover: boolean }) {
  const tokens = useSidebarTokens();
  const theme = useTheme();
  const controller = useDragController();
  const active = useDropPins();
  return (
    <View
      ref={(v) => {
        controller?.regions.set("tiles", v);
      }}
      onLayout={() => void controller?.tilesLaidOut()}
      pointerEvents="none"
      style={{
        position: "absolute",
        left: layout.sidebarInset,
        right: layout.sidebarInset,
        top,
        height,
        borderRadius: 10,
        borderWidth: active ? 1.5 : 1,
        borderStyle: "dashed",
        borderColor: active ? theme.accent : tokens.dragBorder,
        // Over the address field it hides it (the drag's silhouette fill); in the empty band it needs none.
        backgroundColor: cover ? tokens.dragSilhouette : active ? (theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)") : undefined,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Symbol name="pin" size={13} color={active ? theme.accent : theme.textSecondary} style={{ width: 16, height: 16 }} />
    </View>
  );
}

const PinnedTile = memo(function PinnedTile({ tabId, width }: { tabId: string; width: number }) {
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
  const badge = useRef(new Animated.Value(away ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(badge, { toValue: away ? 1 : 0, speed: 18, bounciness: 8, useNativeDriver: true }).start();
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
                        <View style={{ width: 16, height: 16 }} />
                      ) : (
                        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                      )}
                      <TabBadges tabId={tabId} />
                    </View>
                  </DockSelection>
                ) : active ? (
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
});

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
