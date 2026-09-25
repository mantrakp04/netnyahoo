import { SwipeArea, swipeHaptic, type SwipeAreaHandle, type SwipeEvent } from "@netnyahoo/cef";
import { Surface, Symbol, VisualEffect } from "@netnyahoo/shell";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useTabLive } from "../../store/hooks";
import { Favicon, NewTabIcon } from "../primitives";
import { HistoryPopover } from "./HistoryPopover";
import { goBack, goForward, goToHistoryItem, historyItems, openHistoryMenu, useHistoryAvailability, useHistoryMenu, type HistoryItem } from "./history";
import type { ToolbarGeometry } from "./geometry";
import {
  CAPSULE_INSET,
  CAPSULE_SIZE,
  CAPSULE_SIZE_CONFIRMED,
  capsuleOffset,
  LIST_ROW,
  listSelection,
  springParams,
  swipeProgress,
} from "./swipeMotion";

/*
 * Dia 1.29's two-finger swipe back/forward (GesturalNavigation), numbers recovered from its
 * binary: a 72 pt frosted circle with a bold chevron slides in from the pane's edge as the
 * fingers move and rubber-bands past the point where it sits 14 pt in. There it grows to
 * 82 pt, the chevron brightens and grows, a white wash fills it (light mode) and the trackpad
 * clicks; letting go there navigates. Holding still past it for 0.3 s turns the circle into
 * the list of pages in that direction, picked by moving up and down.
 */

const SIZE = CAPSULE_SIZE;
const SIZE_CONFIRMED = CAPSULE_SIZE_CONFIRMED;
const ICON = 28;
const ICON_CONFIRMED = 34;
const LIST_WIDTH = 200;
const ROW = LIST_ROW;
const LIST_PAD = 8;
const LIST_RADIUS = 18;
const LIST_IDLE_MS = 300;
const EASE = Easing.bezier(0.25, 0.46, 0.45, 0.94);

/** An Animated spring given as response (s) and damping ratio, like CASpringAnimation / SwiftUI. */
export function spring(value: Animated.Value, toValue: number, response: number, dampingRatio: number) {
  return Animated.spring(value, { toValue, ...springParams(response, dampingRatio), useNativeDriver: false });
}

/** The pane-level navigation overlays: the swipe indicator and the back / forward list. */
export function NavigationOverlays({ tabId, windowId, geometry }: { tabId: string; windowId: string; geometry: ToolbarGeometry }) {
  return (
    <>
      <SwipeOverlay tabId={tabId} />
      <HistoryPopover tabId={tabId} windowId={windowId} anchors={{ back: geometry.back, forward: geometry.forward }} />
    </>
  );
}

type Shown = { direction: "back" | "forward"; confirmed: boolean; list: HistoryItem[] | null; selected: number };

export function SwipeOverlay({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const live = useTabLive(tabId);
  const history = useHistoryAvailability(tabId, live);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [shown, setShown] = useState<Shown | null>(null);
  const area = useRef<SwipeAreaHandle>(null);

  // Everything the per-event handler needs, without re-rendering on every event.
  const g = useRef({
    active: false,
    direction: "back" as "back" | "forward",
    confirmed: false,
    width: SIZE, // the capsule's target width (its position is computed from it)
    items: null as Promise<HistoryItem[]> | null,
    list: null as HistoryItem[] | null,
    listY: 0, // dy when the list appeared
    selected: 0,
    idle: undefined as ReturnType<typeof setTimeout> | undefined,
  }).current;
  const v = useRef({
    x: new Animated.Value(-SIZE),
    w: new Animated.Value(SIZE),
    h: new Animated.Value(SIZE),
    top: new Animated.Value(0),
    nudge: new Animated.Value(0),
    radius: new Animated.Value(SIZE / 2),
    confirm: new Animated.Value(0),
    icon: new Animated.Value(1), // icon scale (28 → 34 pt)
    list: new Animated.Value(0),
    pill: new Animated.Value(0),
    fade: new Animated.Value(1),
    scale: new Animated.Value(1),
  }).current;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const resetValues = (direction: "back" | "forward") => {
    for (const value of Object.values(v)) value.stopAnimation();
    const { height } = sizeRef.current;
    v.x.setValue(-SIZE);
    v.w.setValue(SIZE);
    v.h.setValue(SIZE);
    v.top.setValue(height / 2 - SIZE / 2);
    v.nudge.setValue(0);
    v.radius.setValue(SIZE / 2);
    v.confirm.setValue(0);
    v.icon.setValue(1);
    v.list.setValue(0);
    v.pill.setValue(0);
    v.fade.setValue(1);
    v.scale.setValue(1);
    Object.assign(g, { active: true, direction, confirmed: false, width: SIZE, list: null, listY: 0, selected: 0 });
  };

  /** Resizes the capsule (threshold, list) with Dia's relayout spring. */
  const layoutTo = (width: number, height: number, top: number, radius: number, response: number, ratio: number) => {
    g.width = width;
    Animated.parallel([
      spring(v.w, width, response, ratio),
      spring(v.h, height, response, ratio),
      spring(v.top, top, response, ratio),
      spring(v.radius, radius, response, ratio),
    ]).start();
  };

  const setConfirmed = (confirmed: boolean) => {
    if (g.confirmed === confirmed) return;
    g.confirmed = confirmed;
    if (confirmed) swipeHaptic("levelChange");
    const { height } = sizeRef.current;
    if (!g.list) {
      const s = confirmed ? SIZE_CONFIRMED : SIZE;
      layoutTo(s, s, height / 2 - s / 2, s / 2, 0.18, 0.7);
      spring(v.icon, confirmed ? ICON_CONFIRMED / ICON : 1, 0.18, 0.7).start();
    }
    Animated.timing(v.confirm, { toValue: confirmed ? 1 : 0, duration: 180, easing: EASE, useNativeDriver: false }).start();
    setShown((s) => (s ? { ...s, confirmed } : s));
  };

  const presentList = async () => {
    const items = (await g.items) ?? [];
    if (!g.active || g.list || !g.confirmed || items.length < 2) return;
    const { height } = sizeRef.current;
    // The first row's centre sits at the pane's middle; rows that wouldn't fit below are left out.
    const fit = Math.max(2, Math.floor((height / 2 + ROW / 2 - LIST_PAD - 8) / ROW));
    const list = items.slice(0, fit);
    g.list = list;
    g.selected = 0;
    g.listY = lastDy.current;
    swipeHaptic("generic");
    layoutTo(LIST_WIDTH, list.length * ROW + LIST_PAD * 2, height / 2 - LIST_PAD - ROW / 2, LIST_RADIUS, 0.22, 0.77);
    Animated.timing(v.list, { toValue: 1, duration: 220, easing: EASE, useNativeDriver: false }).start();
    setShown((s) => (s ? { ...s, list, selected: 0 } : s));
  };

  const select = (dy: number) => {
    const { index, nudge } = listSelection(dy - g.listY, g.list!.length);
    v.nudge.setValue(nudge);
    if (index === g.selected) return;
    g.selected = index;
    swipeHaptic("alignment");
    spring(v.pill, index * ROW, 0.27, 0.9).start();
    setShown((s) => (s ? { ...s, selected: index } : s));
  };

  const dismiss = () => {
    clearTimeout(g.idle);
    g.active = false;
    Animated.parallel([
      Animated.timing(v.fade, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: false }),
      Animated.timing(v.scale, { toValue: 0.01, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: false }),
    ]).start(({ finished }) => finished && !g.active && setShown(null));
  };

  const lastDy = useRef(0);
  const onSwipe = (e: SwipeEvent) => {
    lastDy.current = e.dy;
    if (e.phase === "began" || e.phase === "swipe") {
      resetValues(e.direction);
      g.items = historyItems(tabId, e.direction === "back" ? -1 : 1);
      setShown({ direction: e.direction, confirmed: false, list: null, selected: 0 });
    }
    if (!g.active) return;
    if (e.phase === "swipe") {
      // A three-finger swipe arrives whole: show the confirmed circle, go, dismiss.
      v.x.setValue(CAPSULE_INSET);
      setConfirmed(true);
      navigate(e.direction, null);
      setTimeout(dismiss, 120);
      return;
    }
    if (e.phase === "cancelled") return dismiss();
    if (e.phase === "ended") {
      const target = g.list ? (g.list[g.selected] ?? null) : null;
      if (target || g.confirmed) navigate(e.direction, target);
      return dismiss();
    }

    const progress = swipeProgress(e.distance);
    if (g.list) select(e.dy);
    else setConfirmed(progress >= 1);
    v.x.setValue(capsuleOffset(progress, g.width));

    // Holding still past the threshold opens the list of destinations.
    clearTimeout(g.idle);
    if (g.confirmed && !g.list) g.idle = setTimeout(() => void presentList(), LIST_IDLE_MS);
  };

  const navigate = (direction: "back" | "forward", item: HistoryItem | null) => {
    if (item) return void goToHistoryItem(tabId, item);
    if (direction === "back") goBack(tabId);
    else goForward(tabId);
  };

  useEffect(() => () => clearTimeout(g.idle), []);
  useSwipeDevHandle(tabId, area);

  const back = shown?.direction !== "forward";
  const iconOpacity = Animated.multiply(v.confirm.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }), v.list.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }));

  return (
    <>
      <SwipeArea
        ref={area}
        style={StyleSheet.absoluteFill}
        canSwipeBack={history.back}
        canSwipeForward={history.forward}
        allowsVerticalMotion={!!shown?.list}
        onSwipe={onSwipe}
        onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      />
      {shown && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            [back ? "left" : "right"]: v.x,
            top: Animated.add(v.top, v.nudge),
            width: v.w,
            height: v.h,
            opacity: v.fade,
            transform: [{ scale: v.scale }],
          }}
        >
          <Surface
            style={StyleSheet.absoluteFill}
            cornerRadius={shown.list ? LIST_RADIUS : (shown.confirmed ? SIZE_CONFIRMED : SIZE) / 2}
            shadowColor="#000000"
            shadowOpacity={theme.dark ? 0.25 : 0.2}
            shadowRadius={8}
            shadowOffset={[0, 2]}
          />
          <Animated.View style={{ ...StyleSheet.absoluteFillObject, borderRadius: v.radius, overflow: "hidden" }}>
            <VisualEffect material="popover" style={StyleSheet.absoluteFill} />
            {/* ConfirmationWash: white 40% in light mode, clear in dark. */}
            {!theme.dark && <Animated.View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.4)", opacity: v.confirm }} />}
            <Animated.View style={{ ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", opacity: iconOpacity }}>
              <Animated.View style={{ transform: [{ scale: v.icon }] }}>
                <Symbol name={back ? "chevron.left" : "chevron.right"} size={ICON} weight="bold" color={theme.dark ? "#FFFFFFD9" : "#000000D9"} style={{ width: ICON + 6, height: ICON + 6 }} />
              </Animated.View>
            </Animated.View>
            {shown.list && <DestinationList tabId={tabId} items={shown.list} selected={shown.selected} appear={v.list} pill={v.pill} />}
          </Animated.View>
          <Animated.View
            style={{
              ...StyleSheet.absoluteFillObject,
              borderRadius: v.radius,
              borderWidth: 1,
              borderColor: theme.dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.125)",
            }}
          />
        </Animated.View>
      )}
    </>
  );
}

/** The pages in the swipe's direction, nearest first; the selected one gets a pill. */
function DestinationList({ tabId, items, selected, appear, pill }: { tabId: string; items: HistoryItem[]; selected: number; appear: Animated.Value; pill: Animated.Value }) {
  const theme = useTheme();
  const profileId = useBrowser((s) => s.tabs[tabId]?.profileId ?? "");
  const favicons = useMemo(() => {
    const urls = new Set(items.map((i) => i.url));
    return new Map((useBrowser.getState().history[profileId] ?? []).filter((h) => urls.has(h.url)).map((h) => [h.url, h.favicon]));
  }, [items, profileId]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: LIST_WIDTH,
        paddingVertical: LIST_PAD,
        opacity: appear,
        transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
      }}
    >
      <Animated.View
        style={{
          position: "absolute",
          left: 8,
          right: 8,
          top: LIST_PAD,
          height: ROW,
          borderRadius: 10,
          backgroundColor: theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
          transform: [{ translateY: pill }],
        }}
      />
      {items.map((item, i) => (
        <View key={item.key} style={{ height: ROW, flexDirection: "row", alignItems: "center", paddingHorizontal: 18, gap: 10 }}>
          <View style={{ width: 16, height: 16, borderRadius: 4, overflow: "hidden" }}>
            {item.offset === "newTab" ? <NewTabIcon size={16} /> : <Favicon url={item.url} favicon={favicons.get(item.url) ?? null} size={16} />}
          </View>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: i === selected ? theme.textPrimary : theme.textSecondary }}>
            {item.title}
          </Text>
        </View>
      ))}
    </Animated.View>
  );
}

// DEV: lib/devHarness scripts drive swipes with `globalThis.nnSwipe.pane(tabId).devSimulate(steps)`.
const devPanes = new Map<string, React.RefObject<SwipeAreaHandle | null>>();
function useSwipeDevHandle(tabId: string, area: React.RefObject<SwipeAreaHandle | null>) {
  useEffect(() => {
    if (!__DEV__) return;
    devPanes.set(tabId, area);
    return () => void (devPanes.get(tabId) === area && devPanes.delete(tabId));
  }, [tabId]);
}
if (__DEV__) {
  const g = globalThis as { nnSwipe?: Record<string, unknown> };
  g.nnSwipe = { ...g.nnSwipe, pane: (tabId: string) => devPanes.get(tabId)?.current ?? null, history: { items: historyItems, open: openHistoryMenu, menu: useHistoryMenu, go: goToHistoryItem } };
}
