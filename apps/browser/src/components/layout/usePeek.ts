import { useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";

const SLIDE_MS = 180;
const HIDE_DELAY_MS = 120;

/**
 * A hidden sidebar or tab strip peeking out while the pointer is at the window's edge. The peek stays mounted, so a
 * reveal only slides it in: it never re-measures, remounts its rows or loses its scroll. `live`: it takes the pointer,
 * from the moment it starts showing until it has slid all the way out (coming back mid-slide keeps it).
 */
export function usePeek(enabled: boolean) {
  const slide = useRef(new Animated.Value(0)).current;
  const [live, setLive] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const animate = (to: number, done?: () => void) =>
    Animated.timing(slide, { toValue: to, duration: SLIDE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(
      ({ finished }) => finished && done?.(),
    );
  const slideOut = () => animate(0, () => setLive(false));
  const show = () => {
    clearTimeout(hideTimer.current);
    if (!enabled) return;
    setLive(true);
    animate(1);
  };
  const hide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(slideOut, HIDE_DELAY_MS);
  };
  useEffect(() => {
    if (enabled) return;
    clearTimeout(hideTimer.current);
    // Nothing out (a window mounting with its sidebar shown): no animation to run, no state to set.
    if (live) slideOut();
  }, [enabled]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  return { slide, live, show, hide };
}
