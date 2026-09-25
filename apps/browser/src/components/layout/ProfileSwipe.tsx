import { SwipeArea, swipeHaptic, type SwipeAreaHandle, type SwipeEvent } from "@netnyahoo/cef";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { adjacentProfile, switchProfile } from "../../lib/actions";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { spring } from "./SwipeOverlay";
import { pagingCommits, pagingOffset } from "./swipeMotion";

/*
 * Swipe between profiles (Dia 1.43): two fingers across the sidebar page through the
 * window's profiles, like Dia's PageSwipeController: the tab list follows at half the
 * finger's speed, clicks as it passes the halfway detent, rubber-bands past the first and
 * last profile (c = 0.15 over 255 pt) and settles with a critically damped spring: 0.25 s
 * since Dia 1.50 (`sidebar-space-swipe-animations`, on by default, settles on Core Animation
 * with the faster spring), 0.4 s before. The next profile's list slides in from the side it
 * came from.
 */

type Paging = { style: { opacity: Animated.AnimatedInterpolation<number>; transform: { translateX: Animated.Value }[] } };
const PagingContext = createContext<Paging | null>(null);

/** Style for the sidebar's tab list: it moves with a profile swipe. Empty outside ProfileSwipe. */
export function useProfilePagingStyle() {
  return useContext(PagingContext)?.style ?? null;
}

/** Wraps the sidebar: horizontal swipes over it switch the window's profile. */
export function ProfileSwipe({ children }: { children: ReactNode }) {
  const windowId = useWindowId();
  // [a previous profile, a next one, more than one] — incognito windows have none.
  const [previous, next, multiple] = useBrowser(
    useShallow((s) => {
      const w = s.windows[windowId];
      const i = w && !w.incognito ? s.profileOrder.indexOf(w.profileId) : -1;
      return i < 0 ? [false, false, false] : [i > 0, i < s.profileOrder.length - 1, s.profileOrder.length > 1];
    }),
  );
  const x = useRef(new Animated.Value(0)).current;
  const paging = useRef<Paging>({
    style: { opacity: x.interpolate({ inputRange: [-300, 0, 300], outputRange: [0.35, 1, 0.35], extrapolate: "clamp" }), transform: [{ translateX: x }] },
  }).current;
  const g = useRef({ detent: false }).current;
  // The list is clipped to the sidebar only while it's moving: tab drags leave the sidebar.
  const [clipped, setClipped] = useState(false);
  const settle = () => spring(x, 0, 0.25, 1).start(({ finished }) => finished && setClipped(false));
  const area = useRef<SwipeAreaHandle>(null);

  const offsetFor = (e: SwipeEvent) => pagingOffset(e.distance, e.direction, e.available, e.width);

  const commit = (e: SwipeEvent, from: number) => {
    const target = adjacentProfile(windowId, e.direction === "back" ? -1 : 1);
    if (!target) return settle();
    switchProfile(windowId, target);
    // The new profile's list continues the motion from the side the swipe came from.
    x.setValue(e.direction === "back" ? from - e.width : from + e.width);
    settle();
  };

  const onSwipe = (e: SwipeEvent) => {
    if (e.phase === "began" || e.phase === "swipe") setClipped(true);
    if (e.phase === "swipe") return commit(e, 0);
    if (e.phase === "began") {
      x.stopAnimation();
      g.detent = false;
    }
    const offset = offsetFor(e);
    if (e.phase === "changed" || e.phase === "began") {
      x.setValue(offset);
      const past = e.available && Math.abs(offset) > e.width / 2;
      if (past !== g.detent) {
        g.detent = past;
        swipeHaptic("alignment");
      }
      return;
    }
    if (e.phase !== "cancelled" && pagingCommits(offset, e.velocity, e.available, e.width)) commit(e, offset);
    else settle();
  };

  useEffect(() => {
    if (!__DEV__) return;
    devAreas.set(windowId, area);
    return () => void (devAreas.get(windowId) === area && devAreas.delete(windowId));
  }, [windowId]);

  return (
    <View style={{ height: "100%", overflow: clipped ? "hidden" : "visible" }}>
      <PagingContext.Provider value={paging}>{children}</PagingContext.Provider>
      <SwipeArea
        ref={area}
        style={StyleSheet.absoluteFill}
        canSwipeBack={previous}
        canSwipeForward={next}
        tracksUnavailableDirections={multiple}
        onSwipe={onSwipe}
      />
    </View>
  );
}

// DEV: `globalThis.nnSwipe.sidebar(windowId).devSimulate(steps)` (see SwipeOverlay).
const devAreas = new Map<string, React.RefObject<SwipeAreaHandle | null>>();
if (__DEV__) {
  const g = globalThis as { nnSwipe?: Record<string, unknown> };
  g.nnSwipe = { ...g.nnSwipe, sidebar: (windowId: string) => devAreas.get(windowId)?.current ?? null };
}
