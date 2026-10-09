import { OutsidePressArea, Surface } from "@arcadia/shell";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, View, type LayoutChangeEvent } from "react-native";
import { hex, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { useWindowId, useWindowUi } from "../store/hooks";
import { activeTabId } from "../store/model";
import { usePage } from "./layout/pageState";
import { useUrlAnchors } from "./layout/windowLayout";
import { Omnibox, PANEL_TEXT_LEFT } from "./Omnibox";
import { insecureLevel, URL_FIELD, urlTextLeft } from "./Toolbar";

// Dia: 5.5pt rise, 12pt margin/radius. Dia 1.52 puts the panel's text exactly where the field had it, and its right
// edge 40pt past the field's end (an 810pt field, 888pt panel): our pill is drawn at rest, so all of it stays covered.
const RIGHT_OF_URL = 40;
const ABOVE_PANE = 5.5;
const PANEL_RADIUS = 17;
const MIN_WIDTH = 420;
const WINDOW_MARGIN = 12;
const DROPDOWN_MIN_WIDTH = 350;
const DROPDOWN_PAST_FIELD = 137;
const DROPDOWN_RADIUS = 12;
// The panel's height as it opens (its field row and bottom row, no suggestions yet): the grow's first frame, before
// its layout is known.
const PANEL_OPEN_HEIGHT = 107;

// Dia 1.52 grows the panel out of the URL field: its edges cover 63%, 82%, 92%, 95%, 99% of the way in successive
// 60 fps frames (a 2x capture), an exponential ease-out of about 130 ms. The content doesn't move; the panel's shape
// uncovers it.
const GROW_MS = 130;
const GROW_EASING = Easing.out(Easing.exp);

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then(
  (on) => (reduceMotion = on),
  () => {},
);
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

type Box = { left: number; top: number; width: number; height: number };

export function CommandPanel({ windowWidth }: { windowWidth: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const { panel } = useWindowUi();
  // The active tab's id, and only while the panel is open: a closed panel doesn't re-render on tab switches.
  const activeId = useBrowser((s) => (panel.open ? activeTabId(s, windowId) : undefined));
  const hasField = useBrowser((s) => !!(activeId && s.tabs[activeId]?.url));
  const insecure = usePage(activeId, (p) => !!insecureLevel(p));
  const anchor = useUrlAnchors((s) => (panel.open ? s[windowId] : undefined));
  if (!panel.open || !activeId || !anchor) return null;

  const room = (left: number, fallback: number) => (windowWidth > 0 ? windowWidth - left - WINDOW_MARGIN : fallback);
  // A click anywhere outside the bar closes it, as Esc does (its field's blur alone misses clicks on the sidebar).
  const onCancel = () => useBrowser.getState().closePanel(windowId);
  const surface = (radius: number) => ({
    fill: hex(theme.panel),
    cornerRadius: radius,
    borderColor: hex(theme.panelBorder),
    borderWidth: 0.5,
    shadowColor: "#000000",
    shadowOpacity: theme.panelShadowOpacity,
    shadowRadius: 24,
    shadowOffset: [0, 10] as [number, number],
  });

  if (anchor.sidebar) {
    // A hidden sidebar (Arc's layout keeps the bar in it) is out of the window: the bar drops from the window's corner.
    // Shown, the bar covers the field from its own edge (the field sits closer to the window's edge than the margin).
    const shown = anchor.left >= 0;
    const left = shown ? anchor.left : WINDOW_MARGIN;
    const width = Math.min(Math.max(DROPDOWN_MIN_WIDTH, anchor.width + DROPDOWN_PAST_FIELD), room(left, DROPDOWN_MIN_WIDTH));
    const from = shown ? { left, top: anchor.top, width: anchor.width, height: anchor.sidebar.height } : null;
    return (
      <Grow from={from} frame={{ left, top: anchor.top, width }} openHeight={anchor.sidebar.height} radius={DROPDOWN_RADIUS} surface={surface(DROPDOWN_RADIUS)}>
        <OutsidePressArea onOutsidePress={onCancel}>
          <Omnibox key={activeId} variant="sidebar" tabId={activeId} initialText={panel.initialText} onCancel={onCancel} />
        </OutsidePressArea>
      </Grow>
    );
  }

  // The panel's text starts where the field's did, so opening it doesn't move the address.
  const left = Math.max(WINDOW_MARGIN, anchor.left + urlTextLeft(insecure) - PANEL_TEXT_LEFT);
  const top = Math.max(0.5, anchor.top - ABOVE_PANE);
  const covering = anchor.left + anchor.width + RIGHT_OF_URL - left;
  const width = Math.min(Math.max(covering, MIN_WIDTH), room(left, covering));
  const from = hasField ? { left: anchor.left, top: anchor.top + URL_FIELD.top, width: anchor.width, height: URL_FIELD.height } : null;
  return (
    <Grow from={from} frame={{ left, top, width }} openHeight={PANEL_OPEN_HEIGHT} radius={PANEL_RADIUS} surface={surface(PANEL_RADIUS)}>
      <OutsidePressArea onOutsidePress={onCancel}>
        <Omnibox key={activeId} variant="panel" tabId={activeId} initialText={panel.initialText} onCancel={onCancel} />
      </OutsidePressArea>
    </Grow>
  );
}

// The panel, grown out of the field's box on the native driver: the panel and a clip of its shape scale from the
// field's box to their own, and the content inside is scaled back, so it stays put while the shape uncovers it. No
// box (the field isn't on screen) shows it at once; Reduce Motion fades it in.
function Grow({
  from,
  frame,
  openHeight,
  radius,
  surface,
  children,
}: {
  from: Box | null;
  frame: { left: number; top: number; width: number };
  openHeight: number;
  radius: number;
  surface: Omit<ComponentProps<typeof Surface>, "style">;
  children: ReactNode;
}) {
  const fade = !!from && reduceMotion;
  const [progress] = useState(() => new Animated.Value(from ? 0 : 1));
  // The box it grows from and its own height, as they were when it opened: later moves don't restart it.
  const start = useRef(fade ? null : from);
  const [height, setHeight] = useState<number | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    if (height === null) setHeight(e.nativeEvent.layout.height);
  };
  useEffect(() => {
    if (!from || height === null) return;
    Animated.timing(progress, { toValue: 1, duration: GROW_MS, easing: GROW_EASING, useNativeDriver: true }).start();
  }, [height === null]);

  const box = start.current;
  let outer: object = fade ? { opacity: progress } : {};
  let inner: object = {};
  if (box) {
    const h = height ?? openHeight;
    const at = (v: number) => progress.interpolate({ inputRange: [0, 1], outputRange: [v, 1] });
    const shift = (v: number) => progress.interpolate({ inputRange: [0, 1], outputRange: [v, 0] });
    const scaleX = at(box.width / frame.width);
    const scaleY = at(box.height / h);
    const x = shift(box.left + box.width / 2 - (frame.left + frame.width / 2));
    const y = shift(box.top + box.height / 2 - (frame.top + h / 2));
    outer = { transform: [{ translateX: x }, { translateY: y }, { scaleX }, { scaleY }] };
    inner = {
      transform: [
        { scaleX: Animated.divide(1, scaleX) },
        { scaleY: Animated.divide(1, scaleY) },
        { translateX: Animated.multiply(x, -1) },
        { translateY: Animated.multiply(y, -1) },
      ],
    };
  }
  return (
    <Animated.View onLayout={onLayout} style={[{ position: "absolute", ...frame }, outer]}>
      <Surface {...surface} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={box ? { overflow: "hidden", borderRadius: radius } : undefined}>
        <Animated.View style={inner}>{children}</Animated.View>
      </View>
    </Animated.View>
  );
}
