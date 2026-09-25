import { SwipeArea, type SwipeAreaHandle, type SwipeEvent } from "@netnyahoo/cef";
import { WindowBackdrop } from "@netnyahoo/shaders";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { themeFor } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { pagerFor, usePagerPages, usePagerSurface } from "./profilePager";

/*
 * Swipe between profiles (Dia 1.43): two fingers across the sidebar or the top tab strip (or one
 * on a Magic Mouse) page through the window's profiles, whatever System Settings › Swipe between
 * pages says; a wheel mouse's horizontal scroll (or Shift-scroll) pages one profile at a time.
 * layout/profilePager has the motion: Dia's PageSwipeController.
 */

/** Wraps the sidebar: horizontal swipes over it page between the window's profiles. */
export function ProfileSwipe({ children }: { children: ReactNode }) {
  return (
    <View style={{ height: "100%" }}>
      {children}
      <ProfileSwipeArea surface="sidebar" style={StyleSheet.absoluteFill} />
    </View>
  );
}

/** The swipe tracker for a view of the pages (lay it over the view; it's never hit-tested). */
/** `pageWidth`: how wide the pages are, when narrower than the area (the strip's tabs). */
export function ProfileSwipeArea({ surface, style, pageWidth }: { surface: "sidebar" | "strip"; style: StyleProp<ViewStyle>; pageWidth?: number }) {
  const windowId = useWindowId();
  usePagerSurface(windowId);
  // [a previous profile, a next one, more than one] — incognito windows have none.
  const [previous, next, multiple] = useBrowser(
    useShallow((s) => {
      const w = s.windows[windowId];
      const i = w && !w.incognito ? s.profileOrder.indexOf(w.profileId) : -1;
      return i < 0 ? [false, false, false] : [i > 0, i < s.profileOrder.length - 1, s.profileOrder.length > 1];
    }),
  );
  const area = useRef<SwipeAreaHandle>(null);

  const onSwipe = (event: SwipeEvent) => {
    const pager = pagerFor(windowId);
    // The pages move with the fingers at their own width.
    const e = pageWidth ? { ...event, width: pageWidth } : event;
    if (e.phase === "swipe") return pager.step(e.direction === "back" ? -1 : 1);
    if (e.phase === "wheel") return pager.wheel(e);
    if (e.phase === "began") pager.beginDrag();
    if (e.phase === "began" || e.phase === "changed") return pager.track(e);
    pager.release(e, e.phase === "cancelled");
  };

  useEffect(() => {
    if (!__DEV__) return;
    const key = `${surface}:${windowId}`;
    devAreas.set(key, area);
    return () => void (devAreas.get(key) === area && devAreas.delete(key));
  }, [windowId, surface]);

  if (!multiple) return null;
  return <SwipeArea ref={area} style={style} canSwipeBack={previous} canSwipeForward={next} tracksUnavailableDirections isPager onSwipe={onSwipe} />;
}

/**
 * The window tint while pages move: each page's profile tint as a layer, in page order, each
 * fading in as the view reaches its page, so the window cross-fades between the two profiles it's
 * between. Covers the window's own backdrop, which switches when the profile does.
 */
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
            <WindowBackdrop colors={theme.windowTint} inactiveColors={theme.windowTintInactive} grainOpacity={theme.grain} style={StyleSheet.absoluteFill} />
          </Animated.View>
        );
      })}
    </>
  );
}

// DEV: `globalThis.nnSwipe.sidebar(windowId).devSimulate(steps)` (and `.strip`), see SwipeOverlay;
// `globalThis.nnPager(windowId).debug()` has the pager's state.
const devAreas = new Map<string, React.RefObject<SwipeAreaHandle | null>>();
if (__DEV__) {
  const g = globalThis as { nnSwipe?: Record<string, unknown> };
  g.nnSwipe = {
    ...g.nnSwipe,
    sidebar: (windowId: string) => devAreas.get(`sidebar:${windowId}`)?.current ?? null,
    strip: (windowId: string) => devAreas.get(`strip:${windowId}`)?.current ?? null,
  };
}
