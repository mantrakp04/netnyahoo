import { SwipeArea, type SwipeAreaHandle, type SwipeEvent } from "@netnyahoo/nncore";
import { WindowBackdrop } from "@netnyahoo/shaders";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { themeFor } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { pagerFor, usePagerNativeConfig, usePagerPages, usePagerSurface } from "./profilePager";


export function ProfileSwipe({ children }: { children: ReactNode }) {
  return (
    <View style={{ height: "100%" }}>
      {children}
      <ProfileSwipeArea surface="sidebar" style={StyleSheet.absoluteFill} />
    </View>
  );
}

export function ProfileSwipeArea({ surface, style, pageWidth }: { surface: "sidebar" | "strip"; style: StyleProp<ViewStyle>; pageWidth?: number }) {
  const windowId = useWindowId();
  usePagerSurface(windowId);
  const [previous, next, multiple] = useBrowser(
    useShallow((s) => {
      const w = s.windows[windowId];
      const i = w && !w.incognito ? s.profileOrder.indexOf(w.profileId) : -1;
      return i < 0 ? [false, false, false] : [i > 0, i < s.profileOrder.length - 1, s.profileOrder.length > 1];
    }),
  );
  const area = useRef<SwipeAreaHandle>(null);
  const pager = pagerFor(windowId);
  const nativePager = usePagerNativeConfig(windowId, pageWidth);
  // One event per area: Animated attaches an event object to a single view.
  const onPagerPosition = useMemo(() => Animated.event([{ nativeEvent: { position: pager.pos } }], { useNativeDriver: true }), [pager]);

  const onSwipe = (event: SwipeEvent) => {
    if (__DEV__) {
      if (received.length >= 4096) received.shift();
      received.push({ at: performance.now(), surface, profile: useBrowser.getState().windows[windowId]?.profileId, ...event });
    }
    const e = pageWidth ? { ...event, width: pageWidth } : event;
    if (e.phase === "swipe") return pager.step(e.direction === "back" ? -1 : 1);
    // Drags never need JS: the native pager tracks and settles them.
    if (e.phase === "wheel") pager.wheel(e);
  };

  useEffect(() => {
    if (!__DEV__) return;
    const key = `${surface}:${windowId}`;
    devAreas.set(key, area);
    return () => void (devAreas.get(key) === area && devAreas.delete(key));
  }, [windowId, surface]);

  // Keep the native controller configured when the last extra profile is removed, so its absolute
  // position returns to zero. The area stays transparent and recognizes no single-profile drags.
  if (!multiple && !nativePager) return null;
  return (
    <SwipeArea
      ref={area}
      style={style}
      canSwipeBack={previous}
      canSwipeForward={next}
      tracksUnavailableDirections={multiple}
      isPager={multiple}
      onSwipe={onSwipe}
      nativePager={nativePager}
      onPagerPosition={nativePager && onPagerPosition}
      onPagerState={nativePager && pager.onNativeState}
    />
  );
}

export function ProfileTint() {
  const windowId = useWindowId();
  const { pages, paging, pager } = usePagerPages(windowId);
  const keys = useBrowser(useShallow((s) => pages.map((p) => `${s.profiles[p.id]?.color ?? "plum"}:${s.ui.appDark ? "dark" : "light"}`)));
  if (!paging) return null;
  return (
    <>
      {pages.map((page, k) => {
        const theme = themeFor(keys[k]!);
        const opacity = k === 0 ? 1 : pager.pos.interpolate({ inputRange: [pages[k - 1]!.slot, page.slot], outputRange: [0, 1], extrapolate: "clamp" });
        return (
          <Animated.View key={page.id} pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
            <WindowBackdrop vibrancy {...theme.backdrop} colors={theme.windowTint} grainOpacity={theme.grain} style={StyleSheet.absoluteFill} />
          </Animated.View>
        );
      })}
    </>
  );
}

const devAreas = new Map<string, React.RefObject<SwipeAreaHandle | null>>();
// DEV: every onSwipe JS received, to compare with the native emits.
const received: object[] = [];
if (__DEV__) {
  const g = globalThis as { nnSwipe?: Record<string, unknown> };
  g.nnSwipe = {
    ...g.nnSwipe,
    received: () => received.splice(0),
    sidebar: (windowId: string) => devAreas.get(`sidebar:${windowId}`)?.current ?? null,
    strip: (windowId: string) => devAreas.get(`strip:${windowId}`)?.current ?? null,
  };
}
