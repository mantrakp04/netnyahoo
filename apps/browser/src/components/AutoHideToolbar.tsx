import { breadcrumb } from "@netnyahoo/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { layout, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { useSettings, useTabLive } from "../store/hooks";
import { useStoreWhile } from "../store/tabWatch";
import type { ToolbarGeometry } from "./layout/geometry";
import { toolbarPalette, useEasedColor } from "./layout/toolbarColors";
import { useHistoryMenu } from "./layout/history";
import { usePages } from "./layout/pageState";
import { needsBar, revealToolbar, setToolbarPeek, STRIP_HEIGHT, toolbarMode, useToolbarAutoHide, type ToolbarMode } from "./layout/toolbarAutoHide";
import { Toolbar } from "./Toolbar";

// The toolbar that hides while scrolling (layout/toolbarAutoHide.ts), drawn over the top of its pane, with the page
// placed under it by useToolbarMotion.
//
// Hiding and showing don't resize the page: a page that sizes things to the viewport (vh units, a canvas re-created
// on resize) would redraw, and a WebGL canvas cleared by its resize shows blank for a frame (netnyahoo.com's Big Yahu
// blinked on every hide and show in 0.2.23). So once a pane's bar has first hidden, its page keeps the strip's size
// until the next document: the bar shown slides it down and its bottom goes under the card's edge (the link status
// bubble stays above it). Each motion is one transform on the native driver, from where the layout moved the page (in the
// same commit, so they land in the same frame) to its place; a reversal carries on from where the page is.

// Dia (owner's clip, 60 fps): the page's top glides up over ~150 ms, eased out (17, 32, 49, 68, 76, 88, 93, 95,
// 100 % per frame); the controls are gone in ~5 frames (45, 25, 11, 3 % left). Showing mirrors it, a little longer and
// softer at the end so the page settles rather than snaps, the controls fading and growing back in.
const HIDE_MS = 150;
const HIDE_EASING = Easing.out(Easing.quad);
const SHOW_MS = 200;
const SHOW_EASING = Easing.out(Easing.cubic);
// Resting on the strip this long peeks the bar (crossing it on the way to the tab strip doesn't).
const PEEK_DELAY = 150;
const UNPEEK_DELAY = 250;
const SHRINK = 0.94;
// What the page gets back from the bar itself.
const BAR_ROOM = layout.toolbarHeight - STRIP_HEIGHT;

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then(
  (on) => (reduceMotion = on),
  () => {},
);
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

// Disabled (a pane not shown, or a toolbar that doesn't hide), the bar is shown whatever the stores say: nothing is
// subscribed until it's enabled, and the render that enables it reads them as they are.
export function useToolbarMode(tabId: string, windowId: string, enabled: boolean): ToolbarMode {
  const scrolledDown = useStoreWhile(useToolbarAutoHide, enabled, (s) => !!s.scrolledDown[tabId]);
  // The rest only matter while the page is scrolled down: until then the bar is shown whatever they say, and a tab
  // switched to (always shown) subscribes to one store, not six.
  const down = enabled && scrolledDown;
  const peek = useStoreWhile(useToolbarAutoHide, down, (s) => !!s.peek[tabId]);
  const hasPage = useStoreWhile(useBrowser, down, (s) => !!s.tabs[tabId]?.url);
  // So a closed panel or find bar elsewhere doesn't re-render every pane.
  const appNeedsBar = useStoreWhile(useBrowser, down, (s) => down && needsBar(s, tabId, windowId));
  const popover = useStoreWhile(usePages, down, (s) => down && !!s.popover[tabId]);
  const historyMenu = useStoreWhile(useHistoryMenu, down, (m) => down && m.menu?.tabId === tabId);
  return toolbarMode({ enabled, hasPage, scrolledDown, peek, needsBar: appNeedsBar || popover || historyMenu });
}

export type ToolbarMotion = {
  // 0: the full bar's band and controls, 1: the strip.
  bar: Animated.Value;
  // The controls' fade (0 shown), apart from the band so Reduce Motion can fade without moving anything.
  fade: Animated.Value;
  // The page group (a bookmarks bar under the toolbar, then the page): where its layout puts it, and the transform to
  // where it shows.
  groupStyle: Animated.WithAnimatedValue<ViewStyle>;
  pageHeight: number;
  // For what sits at the bottom of the page (the link status bubble): kept above the card's edge while part of the
  // page is under it.
  bottomStyle: Animated.WithAnimatedValue<ViewStyle>;
};

// The pane's layout and motion with a toolbar that hides (`enabled`: the pane places its page with it, shown or not).
// `extra`: a bookmarks bar under the toolbar, which goes with the bar. `doc`: the page's document (its URL without the
// fragment); a new one gets the shown bar's size again.
export function useToolbarMotion({
  enabled,
  mode,
  height,
  extra,
  doc,
}: {
  enabled: boolean;
  mode: ToolbarMode;
  height: number;
  extra: number;
  doc: string;
}): ToolbarMotion {
  const collapsed = mode !== "shown";
  const hidden = mode === "collapsed";
  const shownTop = layout.toolbarHeight + extra;
  const room = shownTop - STRIP_HEIGHT;
  // The strip's size from the first hide (the one resize, held in place by the transform like any other move) until
  // the next document. A page that never scrolls far enough to hide the bar keeps all of it in view. Set while
  // rendering, so the layout changes in the commit that starts the motion.
  const [tallState, setTall] = useState({ on: collapsed, doc });
  let tall = tallState;
  if (tall.doc !== doc || (!enabled && tall.on)) tall = { on: false, doc };
  if (enabled && collapsed && !tall.on) tall = { on: true, doc };
  if (tall !== tallState) setTall(tall);

  const values = useRef<{ page: Animated.Value; laid: Animated.Value; bar: Animated.Value; fade: Animated.Value }>(null as never);
  const initial = useRef({ page: collapsed ? 1 : 0, bar: hidden ? 1 : 0 }).current;
  if (!values.current) {
    values.current = {
      // Where the page shows (0: under the full bar, 1: under the strip) and where its layout puts it (same scale).
      page: new Animated.Value(initial.page),
      laid: new Animated.Value(initial.page),
      bar: new Animated.Value(initial.bar),
      fade: new Animated.Value(initial.bar),
    };
    // Animated writes its JS-side values into the view's props when the pane re-renders: listening has the native
    // driver report each frame's value back, so a re-render mid-motion puts things where they are, not where the
    // motion started.
    const { page, bar, fade } = values.current;
    for (const a of [page, bar, fade]) a.addListener(() => {});
  }
  const v = values.current;
  const translateY = useMemo(() => Animated.multiply(Animated.subtract(v.laid, v.page), room), [room]);
  // The page's bottom is room × (1 − page) under the card's edge while it keeps the strip's size.
  const bottomShift = useMemo(() => (tall.on ? Animated.multiply(Animated.subtract(v.page, 1), room) : 0), [tall.on, room]);
  // Driven natively from the first commit's effects on, so the setValue calls below reach the native side with the
  // commit's mount rather than through a JS frame.
  useEffect(() => {
    const keep = (a: Animated.Value, value: number) => Animated.timing(a, { toValue: value, duration: 0, useNativeDriver: true });
    Animated.parallel([keep(v.page, initial.page), keep(v.laid, initial.page), keep(v.bar, initial.bar), keep(v.fade, initial.bar)]).start();
  }, []);
  const was = useRef({ collapsed, hidden });
  // A layout effect: its native ops go with this commit's mount, so the layout's move and the transform holding the
  // page where it was land in the same frame. Starting a value's animation stops the one running and carries on from
  // where it got to, so a reversal mid-motion never jumps.
  useLayoutEffect(() => {
    const before = was.current;
    was.current = { collapsed, hidden };
    if (before.collapsed === collapsed && before.hidden === hidden) return;
    const glide = (a: Animated.Value, value: number, show: boolean) =>
      Animated.timing(a, { toValue: value, duration: show ? SHOW_MS : HIDE_MS, easing: show ? SHOW_EASING : HIDE_EASING, useNativeDriver: true });
    if (before.collapsed !== collapsed) {
      const to = collapsed ? 1 : 0;
      const barTo = hidden ? 1 : 0;
      v.laid.setValue(to);
      if (reduceMotion) {
        // The page and the band move at once, the controls fade.
        v.page.setValue(to);
        v.bar.setValue(barTo);
        glide(v.fade, barTo, !collapsed).start();
      } else Animated.parallel([glide(v.page, to, !collapsed), glide(v.bar, barTo, !collapsed), glide(v.fade, barTo, !collapsed)]).start();
    } else if (!hidden) {
      // Peeking: the bar over the page, at once.
      v.bar.setValue(0);
      v.fade.setValue(0);
    } else if (reduceMotion) {
      v.bar.setValue(1);
      glide(v.fade, 1, false).start();
    } else Animated.parallel([glide(v.bar, 1, false), glide(v.fade, 1, false)]).start();
  }, [collapsed, hidden]);

  return {
    bar: v.bar,
    fade: v.fade,
    groupStyle: {
      position: "absolute",
      left: 0,
      right: 0,
      top: (collapsed ? STRIP_HEIGHT : shownTop) - extra,
      transform: [{ translateY }],
    },
    pageHeight: height - (tall.on ? STRIP_HEIGHT : shownTop),
    bottomStyle: { transform: [{ translateY: bottomShift }] },
  };
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
  // Made once: a new interpolation is a new native node, detached and reattached on every render.
  const { bandScale, bandLift, dividerTop, controls, label, shrink } = useMemo(
    () => ({
      // The band: the bar's height down to the strip's, its top edge fixed (scaled about its middle, then lifted).
      bandScale: bar.interpolate({ inputRange: [0, 1], outputRange: [1, STRIP_HEIGHT / H] }),
      bandLift: bar.interpolate({ inputRange: [0, 1], outputRange: [0, -BAR_ROOM / 2] }),
      dividerTop: bar.interpolate({ inputRange: [0, 1], outputRange: [0, -BAR_ROOM] }),
      controls: fade.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 1], outputRange: [1, 0.45, 0.15, 0, 0] }),
      label: fade.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] }),
      shrink: [
        // Toward the top centre: scaled about its middle, then lifted so its top edge stays put, and a little more.
        { translateY: bar.interpolate({ inputRange: [0, 1], outputRange: [0, -((1 - SHRINK) * H) / 2 - 3] }) },
        { scale: bar.interpolate({ inputRange: [0, 1], outputRange: [1, SHRINK] }) },
      ],
    }),
    [bar, fade, H],
  );
  // The strip comes the first time the bar leaves (it fades in as the controls fade out) and stays for the fade back:
  // a tab switched to shows its bar, so a switch mounts none of it.
  const [strip, setStrip] = useState(mode !== "shown");
  if (!strip && mode !== "shown") setStrip(true);
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
      {strip && (
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
      )}
    </View>
  );
}
