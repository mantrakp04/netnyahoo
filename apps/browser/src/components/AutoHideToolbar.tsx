import { breadcrumb } from "@netnyahoo/core";
import { useEffect, useLayoutEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
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
// its room in the pane's column, so the page gets the space back when the bar collapses to the strip.
//
// One motion on one clock, all on the native driver: the page view is resized once, in the same commit that starts
// the animation, and a transform holds it where it was and then glides it up with the bar's band, while the controls
// fade and shrink toward the top centre. Nothing lays out per frame and Chrome renders the new size once (the rows it
// adds come in at the bottom, under the card's edge, before they show). Showing is instant, as in Dia.

// Dia (owner's clip, 60 fps): the page's top glides up over ~150 ms, eased out (17, 32, 49, 68, 76, 88, 93, 95,
// 100 % per frame); the controls are gone in ~5 frames (45, 25, 11, 3 % left); showing takes one frame.
const HIDE_MS = 150;
const HIDE_EASING = Easing.out(Easing.quad);
// Resting on the strip this long peeks the bar (crossing it on the way to the tab strip doesn't).
const PEEK_DELAY = 150;
const UNPEEK_DELAY = 250;
const SHRINK = 0.94;
// What the page gets back.
const ROOM = layout.toolbarHeight - STRIP_HEIGHT;

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

export type ToolbarMotion = {
  // 0: the page where the full bar leaves it, 1: where the strip does.
  page: Animated.Value;
  // 0: the full bar's band and controls, 1: the strip.
  bar: Animated.Value;
  // The controls' fade (0 shown), apart from the band so Reduce Motion can fade without moving anything.
  fade: Animated.Value;
  // The page container's style: a transform from where its layout puts it to where it shows.
  pageStyle: Animated.WithAnimatedValue<ViewStyle>;
};

// The pane's motion, started in the commit that changes the layout (a layout effect: its native ops go with that
// commit's mount, so the resize and the transform holding the page in place land in the same frame).
export function useToolbarMotion(mode: ToolbarMode): ToolbarMotion {
  const collapsed = mode !== "shown";
  const hidden = mode === "collapsed";
  const motion = useRef<ToolbarMotion & { room: Animated.Value }>(null as never);
  const initial = useRef({ page: collapsed ? 1 : 0, bar: hidden ? 1 : 0, room: collapsed ? 0 : 1 }).current;
  if (!motion.current) {
    const page = new Animated.Value(initial.page);
    const bar = new Animated.Value(initial.bar);
    const fade = new Animated.Value(initial.bar);
    // 1 while the layout gives the full bar's room, 0 the strip's.
    const room = new Animated.Value(initial.room);
    // Where the page shows, less where its layout puts it: ROOM × (1 − page − room).
    const translateY = Animated.multiply(Animated.subtract(Animated.subtract(1, page), room), ROOM);
    motion.current = { page, bar, fade, room, pageStyle: { transform: [{ translateY }] } };
  }
  const m = motion.current;
  // Native from the start, so the instant changes below (setValue) go with the commit's mount, not through JS.
  useEffect(() => {
    const keep = (v: Animated.Value, value: number) => Animated.timing(v, { toValue: value, duration: 0, useNativeDriver: true });
    Animated.parallel([keep(m.page, initial.page), keep(m.bar, initial.bar), keep(m.fade, initial.bar), keep(m.room, initial.room)]).start();
  }, []);
  const was = useRef({ collapsed, hidden });
  useLayoutEffect(() => {
    const before = was.current;
    was.current = { collapsed, hidden };
    if (before.collapsed === collapsed && before.hidden === hidden) return;
    const to = (v: Animated.Value, value: number) => Animated.timing(v, { toValue: value, duration: HIDE_MS, easing: HIDE_EASING, useNativeDriver: true });
    if (!collapsed) {
      // Showing: everything at once, with the layout (setValue also stops a hide still running).
      m.room.setValue(1);
      m.page.setValue(0);
      m.bar.setValue(0);
      m.fade.setValue(0);
    } else if (!before.collapsed) {
      // Hiding: the layout gives the page the room now and the transform keeps it in place; then it glides up with the
      // band. Reduce Motion: the page and the band move at once, the controls fade.
      m.room.setValue(0);
      if (reduceMotion) {
        m.page.setValue(1);
        m.bar.setValue(1);
        to(m.fade, 1).start();
      } else Animated.parallel([to(m.page, 1), to(m.bar, 1), to(m.fade, 1)]).start();
    } else if (!hidden) {
      // Peeking: the bar over the page, at once.
      m.bar.setValue(0);
      m.fade.setValue(0);
    } else if (reduceMotion) {
      m.bar.setValue(1);
      to(m.fade, 1).start();
    } else Animated.parallel([to(m.bar, 1), to(m.fade, 1)]).start();
  }, [collapsed, hidden]);
  return m;
}

export function AutoHideToolbar({
  tabId,
  windowId,
  geometry,
  inSplit,
  focused,
  mode,
  motion,
}: {
  tabId: string;
  windowId: string;
  geometry: ToolbarGeometry;
  inSplit: boolean;
  focused: boolean;
  mode: ToolbarMode;
  motion: ToolbarMotion;
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

  const peekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(peekTimer.current), []);
  const peekLater = (on: boolean, ms: number) => {
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setToolbarPeek(tabId, on), ms);
  };

  const { bar, fade } = motion;
  const H = layout.toolbarHeight;
  // The band: the bar's height down to the strip's, its top edge fixed (scaled about its middle, then lifted).
  const bandScale = bar.interpolate({ inputRange: [0, 1], outputRange: [1, STRIP_HEIGHT / H] });
  const bandLift = bar.interpolate({ inputRange: [0, 1], outputRange: [0, -ROOM / 2] });
  const dividerTop = bar.interpolate({ inputRange: [0, 1], outputRange: [0, -ROOM] });
  const controls = fade.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 1], outputRange: [1, 0.45, 0.15, 0, 0] });
  const label = fade.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const shrink = [
    // Toward the top centre: scaled about its middle, then lifted so its top edge stays put, and a little more.
    { translateY: bar.interpolate({ inputRange: [0, 1], outputRange: [0, -((1 - SHRINK) * H) / 2 - 3] }) },
    { scale: bar.interpolate({ inputRange: [0, 1], outputRange: [1, SHRINK] }) },
  ];
  const host = url.startsWith("file:") ? "File" : breadcrumb(url).host;

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: H }}>
      {/* The band, the card under it first: a peeking bar covers the page, and a website colour never fades out. */}
      <Animated.View
        pointerEvents="none"
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: H, backgroundColor: theme.card, transform: [{ translateY: bandLift }, { scaleY: bandScale }] }}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: band }]} />
      </Animated.View>
      {url ? (
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: H - StyleSheet.hairlineWidth, height: StyleSheet.hairlineWidth, backgroundColor: palette.divider, transform: [{ translateY: dividerTop }] }}
        />
      ) : null}
      <Animated.View
        pointerEvents={collapsed ? "none" : "box-none"}
        onMouseEnter={() => modeNow.current === "peek" && clearTimeout(peekTimer.current)}
        onMouseLeave={() => modeNow.current === "peek" && peekLater(false, UNPEEK_DELAY)}
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: H, opacity: controls, transform: shrink }}
      >
        <Toolbar tabId={tabId} geometry={geometry} windowId={windowId} inSplit={inSplit} focused={focused} bare />
      </Animated.View>
      <Animated.View pointerEvents={collapsed ? "auto" : "none"} style={{ position: "absolute", left: 0, right: 0, top: 0, height: STRIP_HEIGHT, opacity: label }}>
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
      </Animated.View>
    </View>
  );
}
