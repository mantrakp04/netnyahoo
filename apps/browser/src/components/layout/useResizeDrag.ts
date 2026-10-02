import { useMemo, useRef } from "react";
import { Animated, Easing, PanResponder, type GestureResponderHandlers } from "react-native";

// Past its range the edge follows the pointer less and less, never more than BAND pt.
const BAND = 36;
const BAND_SCALE = 90;

/**
 * Dragging a panel's edge to resize it (the sidebar; the extension side panel can take it too). Past `min` or `max`
 * the edge stretches on a rubber band, and let go there it springs back into range. The width on screen is the one
 * fact: a grab starts from it, and stops a spring still settling, so a second drag never fights the first one's spring.
 * `direction`: 1 when dragging right widens the panel, -1 for a panel on the right. `onLive(null)` hands the width back
 * to the saved one, right after `onCommit` saved it.
 */
export function useResizeDrag(o: {
  min: number;
  max: number;
  direction: 1 | -1;
  saved: () => number;
  onLive: (width: number | null) => void;
  onCommit: (width: number) => void;
}): GestureResponderHandlers {
  const latest = useRef(o);
  latest.current = o;
  return useMemo(() => {
    let live: number | null = null;
    let start = 0;
    let spring: Animated.CompositeAnimation | null = null;
    const show = (width: number) => {
      live = width;
      latest.current.onLive(width);
    };
    const commit = (width: number) => {
      live = null;
      latest.current.onCommit(width);
      latest.current.onLive(null);
    };
    const band = (over: number) => BAND * (1 - Math.exp(-over / BAND_SCALE));
    const unband = (stretch: number) => -BAND_SCALE * Math.log(1 - Math.min(stretch, BAND - 0.01) / BAND);
    const rubberBand = (width: number) => {
      const { min, max } = latest.current;
      if (width > max) return max + band(width - max);
      if (width < min) return min - band(min - width);
      return width;
    };
    // The pointer position a width on screen stands for, so a grab mid-spring starts where the edge is.
    const unstretch = (width: number) => {
      const { min, max } = latest.current;
      if (width > max) return max + unband(width - max);
      if (width < min) return min - unband(min - width);
      return width;
    };
    const clamp = (width: number) => Math.min(latest.current.max, Math.max(latest.current.min, width));
    const at = (dx: number) => rubberBand(start + latest.current.direction * dx);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // Stopped, a spring's callback sees `finished: false` and commits nothing.
        spring?.stop();
        spring = null;
        start = unstretch(live ?? latest.current.saved());
        show(rubberBand(start));
      },
      onPanResponderMove: (_, g) => show(at(g.dx)),
      onPanResponderRelease: (_, g) => {
        const raw = at(g.dx);
        const target = clamp(raw);
        if (raw === target) return commit(target);
        // JS driver: each frame sets the panel's width.
        const value = new Animated.Value(raw);
        value.addListener(({ value: v }) => show(v));
        const mine = Animated.timing(value, { toValue: target, duration: 260, easing: Easing.out(Easing.back(1.2)), useNativeDriver: false });
        spring = mine;
        mine.start(({ finished }) => {
          value.removeAllListeners();
          if (!finished) return;
          spring = null;
          commit(target);
        });
      },
      onPanResponderTerminate: () => commit(clamp(live ?? latest.current.saved())),
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  }, []);
}
