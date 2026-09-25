import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

/**
 * A horizontal trackpad swipe over a SwipeArea's parent (see ios/NNSwipe.h). The native
 * side decides whether the content (a scrolling page, a carousel) keeps the gesture;
 * once it reports "began", the gesture is the area's until "ended" / "cancelled".
 */
export type SwipeEvent = {
  /**
   * "swipe": a whole three-finger swipe (Swipe between pages › Swipe with three fingers).
   * "wheel": a wheel mouse's horizontal scroll over a pager (`distance`: this event's |ΔX|).
   */
  phase: "began" | "changed" | "ended" | "cancelled" | "swipe" | "wheel";
  /** "back": the content moves right (fingers right with natural scrolling). */
  direction: "back" | "forward";
  /** Points travelled along `direction` since the gesture began (negative when it comes back). */
  distance: number;
  dy: number;
  /** Points per second along `direction` (the release speed on "ended"). */
  velocity: number;
  /** The direction can commit (false while rubber-banding past the last profile). */
  available: boolean;
  /** The area's width. */
  width: number;
};

export type SwipeStep = {
  phase: "began" | "changed" | "ended" | "cancelled" | "momentum" | "momentumBegan" | "momentumEnded" | "mayBegin" | "swipe" | "wheel";
  dx?: number;
  dy?: number;
  /** "wheel": Shift held (macOS scrolls sideways). */
  shift?: boolean;
  delayMs?: number;
};

export type SwipeAreaProps = ViewProps & {
  canSwipeBack: boolean;
  canSwipeForward: boolean;
  /** Unavailable directions still track (rubber band) instead of passing through. */
  tracksUnavailableDirections?: boolean;
  /** Vertical motion doesn't cancel the swipe (while a destination list is picked from). */
  allowsVerticalMotion?: boolean;
  /**
   * A pager (profile paging): tracks whatever Swipe between pages is set to, and wheel mice
   * page it too ("wheel" events). Dia's PageSwipeController doesn't look at the setting.
   */
  isPager?: boolean;
  onSwipe: (event: SwipeEvent) => void;
};

export type SwipeAreaHandle = {
  /** DEV: plays a synthetic gesture at (x, y) inside the area through the real tracker. */
  devSimulate(steps: SwipeStep[], options?: { x?: number; y?: number; ignorePreference?: boolean }): Promise<unknown>;
};

type NativeProps = Omit<SwipeAreaProps, "onSwipe"> & { onSwipe: (e: NativeSyntheticEvent<SwipeEvent>) => void };
type NativeHandle = { devLocate(): Promise<{ windowNumber: number; x: number; y: number; width: number; height: number } | null> };

type SwipeModule = {
  haptic(pattern: string): void;
  devSimulate(x: number, y: number, windowNumber: number, steps: SwipeStep[], ignorePreference: boolean): Promise<unknown>;
};
type NativeComponent = React.ComponentType<NativeProps & { ref?: React.Ref<NativeHandle> }>;

// Builds without the swipe module have no gestures.
const Module = (() => {
  try {
    return requireNativeModule<SwipeModule>("NetnyahooSwipe");
  } catch {
    return null;
  }
})();
// Resolved on first render: a view manager lookup that warns during module init would open
// LogBox before index.js silences it (and LogBox crashes react-native-macos).
let Native: NativeComponent | null | undefined;
const native = () => (Native ??= Module ? (requireNativeViewManager<NativeProps>("NetnyahooSwipe") as unknown as NativeComponent) : null);

/** Trackpad haptic: "levelChange" (a threshold reached), "alignment" (detents, selection), "generic". */
export const swipeHaptic = (pattern: "levelChange" | "alignment" | "generic") => Module?.haptic(pattern);

/** Invisible, never hit-tested: lay it over the content whose swipes it should get. */
export const SwipeArea = forwardRef<SwipeAreaHandle, SwipeAreaProps>(function SwipeArea({ onSwipe, ...props }, ref) {
  const handle = useRef<NativeHandle>(null);
  useImperativeHandle(ref, () => ({
    async devSimulate(steps, options = {}) {
      const at = await handle.current?.devLocate();
      if (!at || !Module) return { error: "area not in a window" };
      const x = at.x + (options.x ?? at.width / 2);
      const y = at.y + (options.y ?? at.height / 2);
      return Module.devSimulate(x, y, at.windowNumber, steps, options.ignorePreference ?? false);
    },
  }));
  const View = native();
  if (!View) return null;
  return <View ref={handle} {...props} onSwipe={(e: NativeSyntheticEvent<SwipeEvent>) => onSwipe(e.nativeEvent)} />;
});
