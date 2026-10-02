import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, View } from "react-native";

// Dia 1.50.1 (owner recording, 60 fps): a group opens or closes in about 150 ms, fast at first.
const FOLD_MS = 150;
const FOLD_EASING = Easing.bezier(0.2, 0.9, 0.3, 1);

export type FoldState = { open: Animated.Value; moving: boolean };

/** `open` runs to 0 (collapsed) or 1; `moving` until the latest change has finished (an interrupted one never settles). */
export function useFold(collapsed: boolean): FoldState {
  const open = useRef(new Animated.Value(collapsed ? 0 : 1)).current;
  const [settled, setSettled] = useState(collapsed);
  const [running, setRunning] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setRunning(true);
    // JS driver: the height reflows the rows below.
    const animation = Animated.timing(open, { toValue: collapsed ? 0 : 1, duration: FOLD_MS, easing: FOLD_EASING, useNativeDriver: false });
    animation.start(({ finished }) => {
      if (!finished) return;
      setSettled(collapsed);
      setRunning(false);
    });
    return () => animation.stop();
  }, [collapsed]);
  return { open, moving: running || settled !== collapsed };
}

export type FoldEntry = { key: string; node: ReactNode };

/**
 * The members of a sidebar group or live folder, opening and closing on `fold`. Closed, the block shows nothing, or
 * only `keep` (the window's active tab): then the block folds around it, every other entry sliding away or back while
 * it stays put at full opacity. Every entry has one wrapper in every state, so the kept row never remounts or pops.
 * `rowHeight`: every entry's height, known before layout (entries closed and settled aren't mounted, unless
 * `mountClosed`); without it each entry is measured and stays mounted. `footer` must take no room (a drag tail).
 */
export function Fold({
  fold,
  collapsed,
  entries,
  keep,
  gap,
  rowHeight,
  padTop = 0,
  padBottom = 0,
  mountClosed = false,
  footer,
}: {
  fold: FoldState;
  collapsed: boolean;
  entries: FoldEntry[];
  keep?: string | null;
  gap: number;
  rowHeight?: number;
  padTop?: number;
  padBottom?: number;
  mountClosed?: boolean;
  footer?: ReactNode;
}) {
  const { open, moving } = fold;
  const measuring = rowHeight === undefined;
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const styles = useRef(new Map<number, object>()).current;
  const kept = keep && entries.some((e) => e.key === keep) ? keep : null;
  const folding = !!kept && (collapsed || moving);
  const state = useRef({ moving, folding, kept });
  state.current = { moving, folding, kept };
  const heightOf = (key: string) => rowHeight ?? measured[key] ?? 0;
  const total = entries.reduce((sum, e) => sum + heightOf(e.key), 0) + gap * Math.max(0, entries.length - 1) + padTop + padBottom;
  // A folding entry shrinks to nothing and cancels the gap after it.
  const foldingStyle = (height: number) => {
    let style = styles.get(height);
    if (!style) {
      style = {
        height: open.interpolate({ inputRange: [0, 1], outputRange: [0, height] }),
        marginBottom: open.interpolate({ inputRange: [0, 1], outputRange: [-gap, 0] }),
        opacity: open,
        overflow: "hidden",
      };
      styles.set(height, style);
    }
    return style;
  };
  const closed = { height: 0, marginBottom: -gap, opacity: 0, overflow: "hidden" as const };
  const outer = folding
    ? null
    : moving
      ? { height: open.interpolate({ inputRange: [0, 1], outputRange: [0, total] }), opacity: open, overflow: "hidden" as const }
      : collapsed
        ? { height: 0, opacity: 0, overflow: "hidden" as const }
        : null;
  const mountAll = !collapsed || moving || mountClosed || measuring;

  return (
    <Animated.View style={outer} pointerEvents={collapsed ? "box-none" : "auto"}>
      {/* Measured entries lay out at their own height while the block is closed: a view in a clipped, zero-height
          parent reports a height of 0. */}
      <View style={[{ gap, paddingTop: padTop, paddingBottom: padBottom }, measuring && outer && !moving ? { position: "absolute", left: 0, right: 0, top: 0 } : null]}>
        {entries.map(({ key, node }) => {
          const stays = key === kept;
          if (!stays && !mountAll) return null;
          return (
            <Animated.View key={key} style={folding && !stays ? (moving ? foldingStyle(heightOf(key)) : closed) : null} pointerEvents={collapsed && !stays ? "none" : "auto"}>
              {measuring ? (
                <View
                  onLayout={(e) => {
                    // A folded entry's wrapper squeezes it: only a free one tells its height.
                    if (state.current.moving || (state.current.folding && key !== state.current.kept)) return;
                    const height = e.nativeEvent.layout.height;
                    setMeasured((all) => (all[key] === height ? all : { ...all, [key]: height }));
                  }}
                >
                  {node}
                </View>
              ) : (
                node
              )}
            </Animated.View>
          );
        })}
        {footer}
      </View>
    </Animated.View>
  );
}
