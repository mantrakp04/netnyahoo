import { breadcrumb } from "@netnyahoo/core";
import { WindowBackdrop } from "@netnyahoo/shaders";
import { ContextMenuArea, FadeLabel, setTrafficLightsCenter, Symbol, WindowDragRegion } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useActiveTab, useTabLive, useWindowId, useWindowUi } from "../../store/hooks";
import type { Tab } from "../../store/types";
import { CommandPanel } from "../CommandPanel";
import { ContentCard } from "../ContentCard";
import { DownloadsPopover } from "../Downloads";
import { usePage } from "../layout/pageState";
import { setUrlAnchor } from "../layout/windowLayout";
import { showUrlBarMenu } from "../omnibox/paste";
import { Favicon, IconButton, useHover } from "../primitives";
import { copyPageUrl } from "../site/selection";
import { openInMainWindow } from "./actions";

// Arc's Little Arc as a Netnyahoo window: a thin bar in the profile's colour (window buttons, the page's favicon, host
// and title, Copy Link, Open in Netnyahoo) over one page card. Dia's card styling, the top strip's 6 pt inset.
export const SMALL_BAR_HEIGHT = 38;
const MID = SMALL_BAR_HEIGHT / 2;
const INSET = 6;
const LIGHTS_CENTER: [number, number] = [20, MID];
const FIELD_LEFT = 84;
const FIELD_HEIGHT = 28;
const BUTTON = 28;

export function SmallYahuWindow() {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <WindowBackdrop vibrancy {...theme.backdrop} colors={theme.windowTint} grainOpacity={theme.grain} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, flexDirection: "row", paddingTop: SMALL_BAR_HEIGHT, paddingLeft: INSET, paddingRight: INSET, paddingBottom: INSET }}>
        <ContentCard />
      </View>
      <View style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
        <SmallYahuBar />
      </View>
      <CommandPanel windowWidth={width} />
      <DownloadsPopover />
    </View>
  );
}

function SmallYahuBar() {
  const windowId = useWindowId();
  const tab = useActiveTab();
  const panelOpen = useWindowUi().panel.open;
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    void setTrafficLightsCenter(windowId, LIGHTS_CENTER);
  }, [windowId]);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const copy = () => {
    if (!tab?.url) return;
    void copyPageUrl(tab.id);
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1400);
  };

  return (
    <View style={{ height: SMALL_BAR_HEIGHT }}>
      <WindowDragRegion style={StyleSheet.absoluteFill} />
      <View style={{ position: "absolute", left: FIELD_LEFT, right: INSET + 2 * BUTTON + 8, top: MID - FIELD_HEIGHT / 2, height: FIELD_HEIGHT }}>
        {tab ? <PageField tab={tab} windowId={windowId} hidden={panelOpen} /> : null}
      </View>
      <View style={{ position: "absolute", right: INSET, top: MID - BUTTON / 2, flexDirection: "row", gap: 2 }}>
        <IconButton icon={copied ? "checkmark" : "link"} size={14} box={BUTTON} radius={7} disabled={!tab?.url} tooltip="Copy Link (⇧⌘C)" onPress={copy} />
        <IconButton icon="arrow.up.left.and.arrow.down.right" size={13} box={BUTTON} radius={7} tooltip="Open in Netnyahoo (⌘O)" onPress={() => openInMainWindow(windowId)} />
      </View>
    </View>
  );
}

function PageField({ tab, windowId, hidden }: { tab: Tab; windowId: string; hidden: boolean }) {
  const theme = useTheme();
  const live = useTabLive(tab.id);
  const insecure = usePage(tab.id, (p) => !!p.security && (p.security.level === "insecure" || p.security.level === "certificateError"));
  const { hovered, hoverProps } = useHover();
  const field = useRef<View>(null);
  const anchor = () =>
    field.current?.measureInWindow((x, y, width, height) => {
      if (width) setUrlAnchor(windowId, { left: x, top: y, width, sidebar: { height } });
    });
  const isFile = tab.url.startsWith("file:");
  const host = !tab.url ? "" : isFile ? "File" : breadcrumb(tab.url).host;
  const title = tab.customTitle || tab.title;

  return (
    <View ref={field} onLayout={anchor} {...hoverProps} style={{ flex: 1, opacity: hidden ? 0 : 1 }}>
      <ContextMenuArea style={{ flex: 1 }} onContextMenu={() => tab.url && void showUrlBarMenu(tab)}>
        <Pressable
          onPress={() => useBrowser.getState().openPanel(windowId, tab.url)}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: 8,
            backgroundColor: hovered ? theme.toolbarHover : undefined,
          }}
        >
          {insecure ? (
            <Symbol name="lock.open.trianglebadge.exclamationmark.fill" size={12} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
          ) : tab.url ? (
            <Favicon url={tab.url} favicon={tab.favicon} profileId={tab.profileId} />
          ) : (
            <Symbol name="magnifyingglass" size={12} color={theme.placeholder} style={{ width: 16, height: 16 }} />
          )}
          {tab.url ? (
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
              <Text numberOfLines={1} style={{ flexShrink: 0, maxWidth: "60%", fontSize: 13, fontWeight: "500", color: theme.textPrimary }}>
                {host}
              </Text>
              {title && title !== host ? (
                <FadeLabel text={`  ${title}`} fontSize={13} color={theme.textSecondary} fadeWidth={14} style={{ flex: 1, height: 18 }} />
              ) : null}
            </View>
          ) : (
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.placeholder }}>
              Search or enter address
            </Text>
          )}
        </Pressable>
      </ContextMenuArea>
      {live.isLoading ? <Progress progress={live.progress} color={theme.accent} /> : null}
    </View>
  );
}

function Progress({ progress, color }: { progress: number; color: string }) {
  const width = useRef(new Animated.Value(Math.max(progress, 0.08))).current;
  useEffect(() => {
    Animated.timing(width, { toValue: Math.max(progress, 0.08), duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [progress]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 8,
        bottom: 0,
        height: 1.5,
        borderRadius: 1,
        width: width.interpolate({ inputRange: [0, 1], outputRange: ["0%", "96%"] }),
        backgroundColor: color,
        opacity: 0.85,
      }}
    />
  );
}
