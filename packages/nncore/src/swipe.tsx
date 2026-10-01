import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { Animated, type NativeSyntheticEvent, type ViewProps } from "react-native";

export type SwipeEvent = {
  phase: "began" | "changed" | "ended" | "cancelled" | "swipe" | "wheel";
  direction: "back" | "forward";
  distance: number;
  dy: number;
  velocity: number;
  available: boolean;
  width: number;
};

export type SwipeStep = {
  phase: "began" | "changed" | "ended" | "cancelled" | "momentum" | "momentumBegan" | "momentumEnded" | "mayBegin" | "swipe" | "wheel";
  dx?: number;
  dy?: number;
  shift?: boolean;
  delayMs?: number;
};

// The native profile pager a SwipeArea drives. Indexes are absolute; ack is the newest pager
// sequence JS has handled, and order changes whenever the indexes start meaning other pages.
export type NativePagerConfig = { key: string; selected: number; count: number; width?: number; ack?: number; order?: string };

export type PagerStateEvent = {
  phase: "began" | "selected" | "settled";
  sequence: number;
  position: number;
  selected: number;
  // The selected profile in the controller's own order; absent when React never sent an order.
  profileId?: string | null;
  velocity: number;
};

export type PagerSnapshot = {
  sequence: number;
  selectionSequence: number;
  position: number;
  selected: number;
  phase: "idle" | "tracking" | "holding" | "settling";
  profileId?: string | null;
  velocity: number;
  count: number;
};

export type SwipeAreaProps = ViewProps & {
  canSwipeBack: boolean;
  canSwipeForward: boolean;
  tracksUnavailableDirections?: boolean;
  allowsVerticalMotion?: boolean;
  isPager?: boolean;
  onSwipe: (event: SwipeEvent) => void;
  nativePager?: NativePagerConfig;
  // A native-driver Animated.event on { nativeEvent: { position } }, passed through as is.
  onPagerPosition?: (...args: never[]) => void;
  onPagerState?: (event: PagerStateEvent) => void;
};

export type SwipeAreaHandle = {
  devSimulate(steps: SwipeStep[], options?: { x?: number; y?: number; ignorePreference?: boolean }): Promise<unknown>;
};

type NativeProps = Omit<SwipeAreaProps, "onSwipe" | "onPagerState"> & {
  onSwipe: (e: NativeSyntheticEvent<SwipeEvent>) => void;
  onPagerState?: (e: NativeSyntheticEvent<PagerStateEvent>) => void;
};
type NativeHandle = { devLocate(): Promise<{ windowNumber: number; x: number; y: number; width: number; height: number } | null> };

type SwipeModule = {
  haptic(pattern: string): void;
  switchPager(key: string, index: number, order?: string): Promise<boolean>;
  stepPager(key: string, delta: number, wrap: boolean, order?: string): Promise<boolean>;
  selectPager(key: string, profileId: string, order: string): Promise<boolean>;
  pagerState(key: string): PagerSnapshot | null;
  devPagerState(key: string): Promise<unknown>;
  devSimulate(x: number, y: number, windowNumber: number, steps: SwipeStep[], ignorePreference: boolean): Promise<unknown>;
};
type NativeComponent = React.ComponentType<NativeProps & { ref?: React.Ref<NativeHandle> }>;

const Module = requireNativeModule<SwipeModule>("NetnyahooSwipe");
const Native = requireNativeViewManager<NativeProps>("NetnyahooSwipe") as unknown as NativeComponent;
// Native Animated attaches onPagerPosition to this view, so frames update the value without JS.
let AnimatedNative: NativeComponent | undefined;
const animatedNative = () => (AnimatedNative ??= Animated.createAnimatedComponent(Native) as unknown as NativeComponent);

export const swipeHaptic = (pattern: "levelChange" | "alignment" | "generic") => Module.haptic(pattern);

// order: the caller's profile ids joined with newlines, so the index means what the caller meant.
export const switchPager = (key: string, index: number, order?: string): Promise<boolean> => Module.switchPager(key, index, order);
// False when the window has no native pager; the caller falls back to the store.
export const stepPager = (key: string, delta: -1 | 1, wrap = false, order?: string): Promise<boolean> =>
  Module.stepPager(key, delta, wrap, order);
// Order is the profile ids joined with newlines, as in NativePagerConfig.order.
export const selectPager = (key: string, profileId: string, order: string): Promise<boolean> =>
  Module.selectPager(key, profileId, order);
export const pagerState = (key: string): PagerSnapshot | null => Module.pagerState(key);
export const devPagerState = (key: string): Promise<unknown> => Module.devPagerState(key);

export const SwipeArea = forwardRef<SwipeAreaHandle, SwipeAreaProps>(function SwipeArea({ onSwipe, onPagerState, ...props }, ref) {
  const handle = useRef<NativeHandle>(null);
  useImperativeHandle(ref, () => ({
    async devSimulate(steps, options = {}) {
      const at = await handle.current?.devLocate();
      if (!at) return { error: "area not in a window" };
      const x = at.x + (options.x ?? at.width / 2);
      const y = at.y + (options.y ?? at.height / 2);
      return Module.devSimulate(x, y, at.windowNumber, steps, options.ignorePreference ?? false);
    },
  }));
  const View = props.nativePager ? animatedNative() : Native;
  return (
    <View
      ref={handle}
      {...props}
      onSwipe={(e: NativeSyntheticEvent<SwipeEvent>) => onSwipe(e.nativeEvent)}
      onPagerState={onPagerState && ((e: NativeSyntheticEvent<PagerStateEvent>) => onPagerState(e.nativeEvent))}
    />
  );
});
