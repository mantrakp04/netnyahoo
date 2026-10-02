import { breadcrumb } from "@netnyahoo/core";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { layout, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { useSettings, useTabLive } from "../store/hooks";
import type { ToolbarGeometry } from "./layout/geometry";
import { toolbarPalette, useEasedColor } from "./layout/toolbarColors";
import { useHistoryMenu } from "./layout/history";
import { usePages } from "./layout/pageState";
import { needsBar, revealToolbar, setToolbarPeek, STRIP_HEIGHT, toolbarMode, useToolbarAutoHide, type ToolbarMode } from "./layout/toolbarAutoHide";
import { Toolbar } from "./Toolbar";

// The toolbar that hides while scrolling (layout/toolbarAutoHide.ts), drawn over the top of its pane: ToolbarSpace holds
// its room in the pane's column, so the page moves up when it collapses to the strip (the page gets the space back),
// while the bar itself can fade out over the page, or peek over it without moving it.

// Dia's: the bar shows in about a frame and hides in ~120 ms, its controls fading and shrinking toward the top centre.
const HIDE_MS = 120;
const SHOW_MS = 70;
// Resting on the strip this long peeks the bar (crossing it on the way to the tab strip doesn't).
const PEEK_DELAY = 150;
const UNPEEK_DELAY = 250;
const SHRINK = 0.94;

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then(
  (on) => (reduceMotion = on),
  () => {},
);
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

export function useToolbarMode(tabId: string, windowId: string, enabled: boolean): ToolbarMode {
  const scrolledDown = useToolbarAutoHide((s) => !!s.scrolledDown[tabId]);
  const peek = useToolbarAutoHide((s) => !!s.peek[tabId]);
  const hasPage = useBrowser((s) => !!s.tabs[tabId]?.url);
  // Only asked while the bar is down, so a closed panel or find bar elsewhere doesn't re-render every pane.
  const appNeedsBar = useBrowser((s) => enabled && scrolledDown && needsBar(s, tabId, windowId));
  const popover = usePages((s) => enabled && scrolledDown && !!s.popover[tabId]);
  const historyMenu = useHistoryMenu((m) => enabled && scrolledDown && m.menu?.tabId === tabId);
  return toolbarMode({ enabled, hasPage, scrolledDown, peek, needsBar: appNeedsBar || popover || historyMenu });
}

export function ToolbarSpace({ mode }: { mode: ToolbarMode }) {
  // A peeking bar draws over the page: the page keeps the strip's room.
  return <View style={{ height: mode === "shown" ? layout.toolbarHeight : STRIP_HEIGHT }} />;
}

export function AutoHideToolbar({
  tabId,
  windowId,
  geometry,
  inSplit,
  focused,
  mode,
}: {
  tabId: string;
  windowId: string;
  geometry: ToolbarGeometry;
  inSplit: boolean;
  focused: boolean;
  mode: ToolbarMode;
}) {
  const theme = useTheme();
  const url = useBrowser((s) => s.tabs[tabId]?.url ?? "");
  const themeColor = useTabLive(tabId, (l) => l.themeColor);
  const extendColor = useSettings((s) => s.extendWebsiteColor);
  const palette = toolbarPalette(theme, extendColor && url ? themeColor : null);
  const band = useEasedColor(palette.background);

  const collapsed = mode === "collapsed";
  const modeNow = useRef(mode);
  modeNow.current = mode;
  // 0: the bar, 1: the strip.
  const progress = useRef(new Animated.Value(collapsed ? 1 : 0)).current;
  const [plain, setPlain] = useState(reduceMotion);
  // The overlay keeps the bar's height until the hide finishes, then shrinks to the strip so the page under it gets
  // its clicks and hover.
  const [settled, setSettled] = useState(collapsed);
  useEffect(() => {
    setPlain(reduceMotion);
    if (!collapsed) setSettled(false);
    Animated.timing(progress, {
      toValue: collapsed ? 1 : 0,
      duration: collapsed ? HIDE_MS : SHOW_MS,
      easing: collapsed ? Easing.out(Easing.quad) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => finished && collapsed && setSettled(true));
  }, [collapsed]);

  const peekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(peekTimer.current), []);
  const peekLater = (on: boolean, ms: number) => {
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setToolbarPeek(tabId, on), ms);
  };

  const barOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const stripOpacity = progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] });
  const shrink = plain
    ? []
    : [
        // Toward the top centre: scaled about its middle, then lifted so its top edge stays put, and a little more.
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -((1 - SHRINK) * layout.toolbarHeight) / 2 - 3] }) },
        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, SHRINK] }) },
      ];
  const host = url.startsWith("file:") ? "File" : breadcrumb(url).host;

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: collapsed && settled ? STRIP_HEIGHT : layout.toolbarHeight }}>
      <Animated.View
        pointerEvents={collapsed ? "none" : "box-none"}
        onMouseEnter={() => modeNow.current === "peek" && clearTimeout(peekTimer.current)}
        onMouseLeave={() => modeNow.current === "peek" && peekLater(false, UNPEEK_DELAY)}
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: layout.toolbarHeight, opacity: barOpacity, transform: shrink }}
      >
        {/* The card under the bar: a peeking or fading bar covers the page, not just its controls. */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.card }]} />
        <Toolbar tabId={tabId} geometry={geometry} windowId={windowId} inSplit={inSplit} focused={focused} />
      </Animated.View>
      <Animated.View
        pointerEvents={collapsed ? "auto" : "none"}
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: STRIP_HEIGHT, opacity: stripOpacity }}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: band }]} />
        <Pressable
          onPress={() => {
            clearTimeout(peekTimer.current);
            revealToolbar(tabId);
          }}
          onMouseEnter={() => modeNow.current === "collapsed" && peekLater(true, PEEK_DELAY)}
          onMouseLeave={() => modeNow.current === "collapsed" && clearTimeout(peekTimer.current)}
          tooltip="Show Toolbar"
          style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }}
        >
          <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "500", color: palette.secondary }}>
            {host}
          </Text>
        </Pressable>
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: palette.divider }} />
      </Animated.View>
    </View>
  );
}
