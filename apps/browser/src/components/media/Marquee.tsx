import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Text, View, type TextStyle } from "react-native";

/**
 * Dia's MarqueeCoordinator: the mini player's title and artist scroll together.
 * One progress value drives every label (each moves by its own overflow), at
 * 30 pt/s for the longest one, pausing 1.5 s at either end, back and forth.
 */
const SPEED = 30;
const PAUSE_MS = 1500;
const FADE = 12;
const FADE_STEPS = 8;

export type MarqueeGroup = {
  progress: Animated.Value;
  report(key: string, overflow: number): void;
};

export function useMarqueeGroup(resetKey: string): MarqueeGroup {
  const progress = useRef(new Animated.Value(0)).current;
  const [overflows, setOverflows] = useState<Record<string, number>>({});
  const max = Math.max(0, ...Object.values(overflows));
  useEffect(() => {
    progress.setValue(0);
    if (max < 1) return;
    const duration = (max / SPEED) * 1000;
    const leg = (toValue: number) => Animated.timing(progress, { toValue, duration, easing: Easing.linear, useNativeDriver: false });
    const loop = Animated.loop(Animated.sequence([Animated.delay(PAUSE_MS), leg(1), Animated.delay(PAUSE_MS), leg(0)]));
    loop.start();
    return () => loop.stop();
  }, [max, resetKey]);
  return useMemo(
    () => ({
      progress,
      report: (key, overflow) => setOverflows((o) => (Math.abs((o[key] ?? 0) - overflow) < 0.5 ? o : { ...o, [key]: overflow })),
    }),
    [progress],
  );
}

/**
 * One line of text that scrolls when it doesn't fit (MarqueeLabel). The edge
 * fades are painted in `background`, so it must sit on an opaque fill.
 */
export function Marquee({
  id,
  text,
  group,
  style,
  height,
  background,
}: {
  id: string;
  text: string;
  group: MarqueeGroup;
  style: TextStyle;
  height: number;
  background: [number, number, number];
}) {
  const [box, setBox] = useState(0);
  const [natural, setNatural] = useState(0);
  const overflow = box > 0 && natural > box + 0.5 ? natural - box : 0;
  useEffect(() => group.report(id, overflow), [overflow]);
  const x = overflow ? group.progress.interpolate({ inputRange: [0, 1], outputRange: [0, -overflow] }) : 0;
  const leading = overflow ? group.progress.interpolate({ inputRange: [0, 0.03], outputRange: [0, 1], extrapolate: "clamp" }) : 0;
  const trailing = overflow ? group.progress.interpolate({ inputRange: [0.97, 1], outputRange: [1, 0], extrapolate: "clamp" }) : 0;
  return (
    <View style={{ height, overflow: "hidden" }} onLayout={(e) => setBox(e.nativeEvent.layout.width)}>
      {/* Laid out wide so the text keeps its natural width. */}
      <Animated.View style={{ position: "absolute", left: 0, top: 0, height, width: 4000, flexDirection: "row", alignItems: "center", transform: [{ translateX: x }] }}>
        <Text numberOfLines={1} onLayout={(e) => setNatural(e.nativeEvent.layout.width)} style={style}>
          {text}
        </Text>
      </Animated.View>
      {overflow ? (
        <>
          <Fade side="left" opacity={leading} background={background} height={height} />
          <Fade side="right" opacity={trailing} background={background} height={height} />
        </>
      ) : null}
    </View>
  );
}

function Fade({ side, opacity, background, height }: { side: "left" | "right"; opacity: Animated.AnimatedInterpolation<number> | number; background: [number, number, number]; height: number }) {
  const [r, g, b] = background;
  const w = FADE / FADE_STEPS;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, [side]: 0, width: FADE, height, flexDirection: side === "left" ? "row" : "row-reverse", opacity }}>
      {Array.from({ length: FADE_STEPS }, (_, i) => (
        <View key={i} style={{ width: w, height, backgroundColor: `rgba(${r},${g},${b},${1 - (i + 0.5) / FADE_STEPS})` }} />
      ))}
    </Animated.View>
  );
}
