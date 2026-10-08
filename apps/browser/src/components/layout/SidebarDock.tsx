import { setTrafficLightsCenter, Surface } from "@netnyahoo/shell";
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchOn } from "../../lib/killSwitches";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { Sidebar } from "../Sidebar";
import { useSidebarUi } from "../sidebar/state";
import { ProfileSwipe } from "./ProfileSwipe";
import {
  ARC_HIDE_MS,
  devPeeks,
  DOCK_SPRING,
  lightsCenter,
  PEEK_ORIGIN,
  peekShown,
  setDockMoving,
  setPeekShown,
  springConfig,
  useDockMotion,
} from "./dockMotion";
import { usePeek } from "./usePeek";

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then(
  (on) => (reduceMotion = on),
  () => {},
);
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

const SPRING = springConfig(DOCK_SPRING);
/** The hover strip at the window's left edge that brings the peek out. */
const STRIP_WIDTH = 8;

/**
 * The window's dock position: 1 with the sidebar shown, 0 with it hidden, springing between them as Dia's does when
 * `open` changes (never on mount: a window restored with its sidebar hidden starts hidden). JS-driven, because the
 * card's left edge is layout: the page is laid out at every step, its right edge never moves. `arc` (the address bar in
 * the sidebar): Arc's hide (a 100 ms ease-out), and docking from the peek panel is instant (dockMotion.ts).
 */
function useSidebarDock(open: boolean, animate: boolean, arc: boolean): Animated.Value {
  const windowId = useWindowId();
  const dock = useRef(new Animated.Value(open ? 1 : 0)).current;
  const was = useRef(open);
  useEffect(() => {
    if (was.current === open) return;
    was.current = open;
    if (!animate || reduceMotion || !switchOn("sidebarSlide")) {
      dock.stopAnimation();
      dock.setValue(open ? 1 : 0);
      setDockMoving(windowId, false);
      return;
    }
    if (arc && open && peekShown(windowId)) {
      // Arc: the peek panel becomes the sidebar where it is, and the page is laid out narrower at once.
      dock.stopAnimation();
      dock.setValue(1);
      setDockMoving(windowId, false);
      return;
    }
    setDockMoving(windowId, true);
    // Reversing mid-way starts from where it is, with the velocity it had (React Native's spring carries it over).
    (arc && !open
      ? Animated.timing(dock, { toValue: 0, duration: ARC_HIDE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false })
      : Animated.spring(dock, {
          toValue: open ? 1 : 0,
          ...SPRING,
          restDisplacementThreshold: 0.001,
          restSpeedThreshold: 0.01,
          useNativeDriver: false,
        })
    ).start(({ finished }) => finished && setDockMoving(windowId, false));
  }, [open]);
  useEffect(() => () => setDockMoving(windowId, false), []);
  return dock;
}

type Inset = { top: number; right: number; bottom: number; left: number };

/**
 * The card's area and, with the sidebar layout, the sidebar beside it. The only part of the window that reads whether
 * the sidebar is shown, so hiding or showing it re-renders this and the sidebar's frame, not the card (`children` is
 * the window's element, unchanged). Docked, the card's left edge follows the sidebar's slide.
 */
export function DockedLayout({
  fullscreen,
  topTabs,
  inset,
  children,
}: {
  fullscreen: boolean;
  topTabs: boolean;
  inset: Inset;
  children: ReactNode;
}) {
  const windowId = useWindowId();
  // One subscription to the store for both (each store update asks every subscriber; the window had two before).
  const [open, savedWidth, addressBar] = useBrowser(
    useShallow(
      (s) =>
        [
          s.windows[windowId]?.sidebarOpen ?? true,
          s.settings.sidebarWidth ?? layout.sidebarWidth,
          s.settings.addressBar === "sidebar",
        ] as const,
    ),
  );
  const width = useSidebarUi((u) => u.dragWidth[windowId]) ?? savedWidth;
  // Arc's layout (the address bar in the sidebar): Arc's hide and peek (dockMotion.ts). Off with the slide's switch.
  const arc = addressBar && !topTabs && switchOn("sidebarSlide");
  const dock = useSidebarDock(open, !topTabs && !fullscreen, arc);
  const left = useMemo(
    () =>
      dock.interpolate({
        inputRange: [0, 1],
        outputRange: [inset.left, width],
      }),
    [dock, width, inset.left],
  );
  return (
    <>
      <Animated.View
        style={
          fullscreen
            ? { flex: 1 }
            : {
                flex: 1,
                flexDirection: "row",
                paddingTop: inset.top,
                paddingRight: inset.right,
                paddingBottom: inset.bottom,
                paddingLeft: topTabs ? inset.left : left,
              }
        }
      >
        {children}
      </Animated.View>
      {/* After the card: the peek panel goes over the page. Docked, it ends where the card starts. */}
      {!topTabs && <SidebarDock dock={dock} open={open} width={width} fullscreen={fullscreen} arc={arc} />}
    </>
  );
}

/**
 * The window's one sidebar, mounted for as long as the window has the sidebar layout: docked at the left edge, sliding
 * out with the dock, and peeking over the page from the left edge while hidden. Showing or hiding it never mounts or
 * unmounts its rows (it did: 2282 views made per toggle, 1.2–2.3 s of main thread).
 */
function SidebarDock({
  dock,
  open,
  width,
  fullscreen,
  arc,
}: {
  dock: Animated.Value;
  open: boolean;
  width: number;
  fullscreen: boolean;
  arc: boolean;
}) {
  const theme = useTheme();
  const windowId = useWindowId();
  const moving = useDockMotion((m) => !!m.moving[windowId]);
  const peek = usePeek(!open && !moving && !fullscreen, arc);
  const peeking = !open && !fullscreen && peek.live;
  useEffect(() => setPeekShown(windowId, peek.live), [windowId, peek.live]);
  // Development: the dev harness opens and closes the peek without a pointer (nnLayout.peek[windowId].show()).
  if (__DEV__) devPeeks[windowId] = peek;
  useEffect(() => () => setPeekShown(windowId, false), [windowId]);
  const panel = useRef(false);
  if (peeking) panel.current = true;
  // Hit testing and hover tracking go by frames, not transforms: at rest a hidden sidebar is moved out of the window,
  // and while it slides it takes no pointer.
  const away = fullscreen || (!open && !moving && !peek.live);
  const slideOut = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }), [dock, width]);
  // The peek panel slides in from just past the left edge, the dock's own offset cancelled (it is at -width).
  const peekIn = useMemo(
    () => peek.slide.interpolate({ inputRange: [0, 1], outputRange: [-12, width] }),
    [peek.slide, width],
  );
  useTrafficLights(windowId, dock, peek.slide, { width, peeking, fullscreen });
  // The same element while the width holds: hiding, showing or peeking re-renders none of the sidebar.
  const sidebar = useMemo(
    () => (
      <ProfileSwipe>
        <Sidebar width={width} />
      </ProfileSwipe>
    ),
    [width],
  );

  // The strip and the panel overlap (x 6–8), and AppKit sends no enter for a view that appears under the pointer, only
  // a leave once it goes. So a leave asks where the pointer went: into the other one keeps the peek out.
  const leaveStrip = (e: { nativeEvent: { clientX: number } }) => {
    if (peek.live && e.nativeEvent.clientX < STRIP_WIDTH) peek.hide();
  };
  const leavePanel = (e: { nativeEvent: { clientX: number; clientY: number } }) => {
    const x = e.nativeEvent.clientX + PEEK_ORIGIN[0];
    const y = e.nativeEvent.clientY + PEEK_ORIGIN[1];
    if (!(x >= 0 && x < STRIP_WIDTH && y >= layout.sidebarHeader)) peek.hide();
  };

  // The hover strip (from the first hide) and the panel's fill and shadow (from the first peek) are made once and kept:
  // adding a view re-adds its siblings to their superview (the card with its pages, or the sidebar).
  const strip = useRef(false);
  if (!open) strip.current = true;
  // Dia's panel fades as it slides; Arc's only slides.
  const fade = peeking && !arc;
  // The panel's fill and shadow show only while peeking, through one animated opacity for good: a prop the native
  // driver let go of goes back to its default on the native side (1), not to the plain 0 given instead, which left the
  // fill and its shadow under the docked sidebar once Dia's fading peek had been out.
  const panelOn = useRef(new Animated.Value(0)).current;
  useLayoutEffect(() => panelOn.setValue(peeking ? 1 : 0), [panelOn, peeking]);
  const panelOpacity = useMemo(
    () => (arc ? panelOn : Animated.multiply(panelOn, peek.slide)),
    [arc, panelOn, peek.slide],
  );
  const peekStyle = {
    opacity: fade ? peek.slide : 1,
    transform: [{ translateX: peeking ? peekIn : 0 }],
  };

  return (
    <>
      {strip.current && (
        <View
          pointerEvents={!open && !fullscreen ? "auto" : "none"}
          onMouseEnter={peek.show}
          onMouseLeave={leaveStrip}
          style={{
            position: "absolute",
            left: 0,
            top: layout.sidebarHeader,
            // No lower than the panel: a leave to the right is into it.
            bottom: layout.cardInset,
            width: !open && !fullscreen ? STRIP_WIDTH : 0,
          }}
        />
      )}
      <Animated.View
        pointerEvents={fullscreen || moving || (!open && !peeking) ? "none" : "auto"}
        onMouseEnter={peeking ? peek.show : undefined}
        onMouseLeave={peeking ? leavePanel : undefined}
        style={{
          position: "absolute",
          left: away ? -10_000 : peeking ? PEEK_ORIGIN[0] : 0,
          top: peeking ? PEEK_ORIGIN[1] : 0,
          bottom: peeking ? layout.cardInset : 0,
          width,
          transform: [{ translateX: slideOut }],
        }}
      >
        {panel.current && (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, peekStyle, { opacity: panelOpacity }]}
          >
            <Surface
              fill={hex(theme.windowTint[0])}
              cornerRadius={12}
              borderColor={hex(theme.panelBorder)}
              borderWidth={0.5}
              shadowColor="#000000"
              shadowOpacity={theme.panelShadowOpacity}
              shadowRadius={20}
              shadowOffset={[0, 6]}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        )}
        <Animated.View style={[{ flex: 1 }, peekStyle, peeking ? { borderRadius: 12, overflow: "hidden" } : null]}>
          {sidebar}
        </Animated.View>
      </Animated.View>
    </>
  );
}

/**
 * The traffic lights ride with the sidebar's top row (Dia): out of the window with it, back with it, and in with the
 * peek panel. Moved by AppKit's own button layout (setTrafficLightsCenter), once per frame the offset changes.
 */
function useTrafficLights(
  windowId: string,
  dock: Animated.Value,
  slide: Animated.Value,
  o: { width: number; peeking: boolean; fullscreen: boolean },
) {
  const values = useRef({ dock: 1, slide: 0 });
  const apply = useRef<() => void>(() => {});
  const sent = useRef<string | undefined>(undefined);
  apply.current = () => {
    const v = values.current;
    // Peeking, they ride in the panel, which comes in from past the edge to its inset (left: PEEK_ORIGIN, peekIn).
    const offset = o.fullscreen ? 0 : o.peeking ? (o.width + 12) * (1 - v.slide) - PEEK_ORIGIN[0] : o.width * (1 - v.dock);
    const center = lightsCenter(offset, o.peeking && !o.fullscreen ? PEEK_ORIGIN[1] : 0);
    const key = center ? center.join(",") : "";
    if (key === sent.current) return;
    sent.current = key;
    void setTrafficLightsCenter(windowId, center);
  };
  useEffect(() => {
    // The dock's value as the window mounted: listeners only hear changes.
    values.current.dock = (dock as unknown as { __getValue(): number }).__getValue();
    const a = dock.addListener(({ value }) => {
      values.current.dock = value;
      apply.current();
    });
    apply.current();
    return () => {
      dock.removeListener(a);
      sent.current = undefined;
      void setTrafficLightsCenter(windowId, null);
    };
  }, [windowId, dock]);
  // The peek's slide runs on the native driver: a listener makes it send every frame to JS, so it listens only while a
  // peek is up.
  useEffect(() => {
    if (!o.peeking) return;
    const b = slide.addListener(({ value }) => {
      values.current.slide = value;
      apply.current();
    });
    return () => slide.removeListener(b);
  }, [slide, o.peeking]);
  useEffect(() => apply.current(), [o.width, o.peeking, o.fullscreen]);
}
