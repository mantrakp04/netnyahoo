import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

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

export type SwipeAreaProps = ViewProps & {
  canSwipeBack: boolean;
  canSwipeForward: boolean;
  tracksUnavailableDirections?: boolean;
  allowsVerticalMotion?: boolean;
  isPager?: boolean;
  onSwipe: (event: SwipeEvent) => void;
};

export type SwipeAreaHandle = {
  devSimulate(steps: SwipeStep[], options?: { x?: number; y?: number; ignorePreference?: boolean }): Promise<unknown>;
};

type NativeProps = Omit<SwipeAreaProps, "onSwipe"> & { onSwipe: (e: NativeSyntheticEvent<SwipeEvent>) => void };
type NativeHandle = { devLocate(): Promise<{ windowNumber: number; x: number; y: number; width: number; height: number } | null> };

type SwipeModule = {
  haptic(pattern: string): void;
  devSimulate(x: number, y: number, windowNumber: number, steps: SwipeStep[], ignorePreference: boolean): Promise<unknown>;
};
type NativeComponent = React.ComponentType<NativeProps & { ref?: React.Ref<NativeHandle> }>;

const Module = (() => {
  try {
    return requireNativeModule<SwipeModule>("NetnyahooSwipe");
  } catch {
    return null;
  }
})();
let Native: NativeComponent | null | undefined;
const native = () => (Native ??= Module ? (requireNativeViewManager<NativeProps>("NetnyahooSwipe") as unknown as NativeComponent) : null);

export const swipeHaptic = (pattern: "levelChange" | "alignment" | "generic") => Module?.haptic(pattern);

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
