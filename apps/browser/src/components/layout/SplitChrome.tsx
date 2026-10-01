import { Surface, Symbol, VisualEffect } from "@netnyahoo/shell";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { withAlpha } from "../sidebar/tokens";
import { useBrowser } from "../../store/browser";
import type { SplitView } from "../../store/types";
import { resize, type Divider, type Rect } from "./geometry";
import { useHover } from "../primitives";
import { hideToast, useToasts } from "./splitActions";
import { useWindowId } from "../../store/hooks";
import { zoneHit, zoneRect, type ZoneStage } from "./splitDrop";
import { setDropTarget, setOnPage, setTargetResolver, useTabDrag } from "./tabDrag";

export function SplitDividers({ split, dividers, width, height }: { split: SplitView; dividers: Divider[]; width: number; height: number }) {
  return (
    <>
      {dividers.map((d) => (
        <DividerHandle key={d.kind === "root" ? `r${d.index}` : "s"} split={split} divider={d} width={width} height={height} />
      ))}
    </>
  );
}

function DividerHandle({ split, divider, width, height }: { split: SplitView; divider: Divider; width: number; height: number }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ sizes: number[]; stack?: [number, number] }>({ sizes: split.sizes });
  const latest = useRef({ split, divider, width, height });
  latest.current = { split, divider, width, height };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          const { split: v } = latest.current;
          start.current = { sizes: v.sizes, stack: v.stack?.sizes };
          setDragging(true);
        },
        onPanResponderMove: (_, g) => {
          const { split: v, divider: d, width: w, height: h } = latest.current;
          const delta = d.vertical ? g.dx : g.dy;
          if (d.kind === "root") {
            useBrowser.getState().updateSplit(v.id, { sizes: resize(start.current.sizes, d.index, delta, d.vertical ? w : h) });
          } else if (start.current.stack) {
            const next = resize(start.current.stack, 0, delta, d.vertical ? w : h) as [number, number];
            useBrowser.getState().updateSplit(v.id, { stackSizes: next });
          }
        },
        onPanResponderRelease: () => setDragging(false),
        onPanResponderTerminate: () => setDragging(false),
      }),
    [],
  );

  const { rect, vertical } = divider;
  const active = hovered || dragging;
  return (
    <View
      {...responder.panHandlers}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: rect.x - (vertical ? 2 : 0),
        top: rect.y - (vertical ? 0 : 2),
        width: rect.width + (vertical ? 4 : 0),
        height: rect.height + (vertical ? 0 : 4),
        alignItems: "center",
        justifyContent: "center",
        cursor: vertical ? "col-resize" : "row-resize",
      }}
    >
      <View
        style={{
          width: vertical ? 4 : 36,
          height: vertical ? 36 : 4,
          borderRadius: 2,
          backgroundColor: theme.dark ? "#FFFFFF" : "#000000",
          opacity: dragging ? 0.55 : active ? 0.32 : 0,
        }}
      />
    </View>
  );
}

// Dia's split targets while a tab is dragged over the page (from the sidebar or the top strip): a target at each
// side of every pane, sliding in from the card's edges, growing once the tab is over the page, and the one under
// the dragged card turning the accent colour and leaning toward the pointer. Geometry in splitDrop.ts.
export function DropTargets({ panes, origin }: { panes: Record<string, Rect>; origin: { x: number; y: number } | null }) {
  const windowId = useWindowId();
  const dragging = useTabDrag((s) => (s.windowId === windowId ? s.tabId : null));
  const x = useTabDrag((s) => s.x);
  const y = useTabDrag((s) => s.y);
  const lifted = useTabDrag((s) => s.lifted);
  const outside = useTabDrag((s) => s.outside);
  const target = useTabDrag((s) => s.target);
  const full = Object.keys(panes).length >= 3;
  // The page showing the dragged tab alone splits with the tab it leaves for: the one used last.
  const fallback = useBrowser((s) => {
    if (!dragging || Object.keys(panes).length !== 1 || !panes[dragging]) return null;
    const tab = s.tabs[dragging];
    const others = (s.windows[windowId]?.tabIds ?? []).map((id) => s.tabs[id]!).filter((t) => t && t.id !== dragging && t.profileId === tab?.profileId);
    return others.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]?.id ?? null;
  });
  const candidates = useMemo((): [string, Rect][] => {
    if (fallback && dragging) return [[fallback, panes[dragging]!]];
    return Object.entries(panes).filter(([tabId]) => tabId !== dragging);
  }, [panes, dragging, fallback]);

  const px = origin ? x - origin.x : -1;
  const py = origin ? y - origin.y : -1;
  const overPage = !!origin && x >= 0 && Object.values(panes).some((r) => px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height);
  const shown = !!dragging && !!origin && !full && !outside && candidates.length > 0 && (lifted ?? overPage);
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    setGrown(false);
    if (!shown) return;
    // Dia grows the targets as soon as they've slid in.
    const timer = setTimeout(() => setGrown(true), ZONE_SLIDE_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  const hit = shown && grown && overPage ? zoneHit(candidates, px, py, target) : null;
  const preview = shown && overPage;
  const resolver = useRef({ candidates, origin, panes, ready: false });
  resolver.current = { candidates, origin, panes, ready: !!dragging && !!origin && !full && candidates.length > 0 && grown && lifted !== false };
  useEffect(() => {
    if (!dragging) return;
    setTargetResolver((x, y, current, outside) => {
      const { candidates, origin, panes, ready } = resolver.current;
      if (!ready || outside || !origin) return null;
      const px = x - origin.x, py = y - origin.y;
      if (!Object.values(panes).some((r) => px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height)) return null;
      return zoneHit(candidates, px, py, current);
    });
    return () => setTargetResolver(null);
  }, [dragging]);
  useEffect(() => setDropTarget(hit), [hit?.tabId, hit?.side]);
  useEffect(() => setOnPage(preview), [preview]);
  useEffect(
    () => () => {
      setDropTarget(null);
      setOnPage(false);
    },
    [],
  );
  // Zones stay mounted for their slide out.
  const [mounted, setMounted] = useState<[string, Rect][]>([]);
  useEffect(() => {
    if (shown) setMounted(candidates);
  }, [shown, candidates]);

  if (!mounted.length) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {mounted.flatMap(([tabId, rect]) =>
        (["left", "right"] as const).map((side) => (
          <DropZone
            key={`${tabId}${side}`}
            pane={rect}
            side={side}
            shown={shown}
            stage={target?.tabId === tabId && target.side === side ? "active" : grown ? "grown" : "rest"}
            pointerX={px}
            onHidden={() => setMounted([])}
          />
        )),
      )}
    </View>
  );
}

const ZONE_SLIDE_MS = 110;
// Dia's targets settle in about 0.12 s with no overshoot: a 0.2 s response, 0.9 damping.
const ZONE_SPRING = { stiffness: 987, damping: 56.5, mass: 1, useNativeDriver: false } as const;

function DropZone({ pane, side, shown, stage, pointerX, onHidden }: { pane: Rect; side: "left" | "right"; shown: boolean; stage: ZoneStage; pointerX: number; onHidden(): void }) {
  const theme = useTheme();
  const rect = zoneRect(pane, side, stage, pointerX);
  const anim = useRef({ x: new Animated.Value(rect.x), y: new Animated.Value(rect.y), w: new Animated.Value(rect.width), h: new Animated.Value(rect.height) }).current;
  const glow = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const active = stage === "active";
  useEffect(() => {
    // JS driver: frames are layout.
    Animated.parallel([
      Animated.spring(anim.x, { toValue: rect.x, ...ZONE_SPRING }),
      Animated.spring(anim.y, { toValue: rect.y, ...ZONE_SPRING }),
      Animated.spring(anim.w, { toValue: rect.width, ...ZONE_SPRING }),
      Animated.spring(anim.h, { toValue: rect.height, ...ZONE_SPRING }),
    ]).start();
  }, [rect.x, rect.y, rect.width, rect.height]);
  useEffect(() => {
    Animated.timing(glow, { toValue: active ? 1 : 0, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [active]);
  useEffect(() => {
    Animated.timing(slide, { toValue: shown ? 1 : 0, duration: ZONE_SLIDE_MS, easing: shown ? Easing.out(Easing.cubic) : Easing.in(Easing.quad), useNativeDriver: false }).start(
      ({ finished }) => finished && !shown && onHidden(),
    );
  }, [shown]);
  // In from (and back out past) the card's edge.
  const away = side === "left" ? -(rect.x - pane.x + rect.width) : pane.x + pane.width - rect.x;
  const dark = theme.dark;
  const rest = dark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)";
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: anim.x,
        top: anim.y,
        width: anim.w,
        height: anim.h,
        borderRadius: 20,
        borderWidth: 0.5,
        borderColor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
        backgroundColor: glow.interpolate({ inputRange: [0, 1], outputRange: [dark ? "rgba(255,236,214,0.04)" : "rgba(255,255,255,0.45)", withAlpha(theme.accent, dark ? 0.16 : 0.12)] }),
        alignItems: "center",
        justifyContent: "center",
        transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [away, 0] }) }],
      }}
    >
      <View
        style={{
          position: "absolute",
          left: 9.5,
          right: 9.5,
          top: 9.5,
          bottom: 9.5,
          borderRadius: 11,
          borderStyle: "dashed",
          // RN dashes are 3 × the width: Dia's 6 pt dashes, and 7 pt on the target under the card.
          borderWidth: active ? 2.33 : 2,
          borderColor: active ? theme.accent : dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
        }}
      />
      <Symbol name={side === "left" ? "rectangle.lefthalf.filled" : "rectangle.righthalf.filled"} size={18} color={active ? theme.accent : rest} style={{ width: 24, height: 20 }} />
      <Text style={{ marginTop: 11, fontSize: 13, fontWeight: "600", color: active ? theme.accent : rest }}>{side === "left" ? "Add left split" : "Add right split"}</Text>
    </Animated.View>
  );
}

export function SplitToast({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const toast = useToasts((s) => s.toasts[windowId] ?? null);
  const appear = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(toast);
  useEffect(() => {
    if (toast) return setShown(toast);
    if (!shown?.sticky) return;
    Animated.timing(appear, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setShown(null);
    });
  }, [toast]);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    appear.setValue(0);
    Animated.spring(appear, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
    if (toast.sticky) return;
    const timer = setTimeout(() => {
      Animated.timing(appear, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        setShown(null);
        hideToast(windowId, toast.id);
      });
    }, toast.action ? 4000 : 2600);
    return () => clearTimeout(timer);
  }, [toast?.id]);
  if (!shown) return null;
  return (
    <View pointerEvents={shown.action ? "box-none" : "none"} style={{ position: "absolute", left: 0, right: 0, bottom: 22, alignItems: "center" }}>
      <Animated.View style={{ opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
        <Surface
          fill={hex(theme.dark ? "rgba(44,42,43,0.9)" : "rgba(255,255,255,0.92)")}
          cornerRadius={14}
          borderColor={hex(theme.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)")}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={theme.dark ? 0.4 : 0.14}
          shadowRadius={16}
          shadowOffset={[0, 6]}
          style={{ paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10, maxWidth: 420 }}
        >
          <VisualEffect material="hudWindow" cornerRadius={14} style={StyleSheet.absoluteFill} />
          <Symbol name={shown.icon ?? "rectangle.split.3x1"} size={15} color={theme.icon} style={{ width: 20, height: 20 }} />
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>{shown.title}</Text>
            {shown.message ? <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 1 }}>{shown.message}</Text> : null}
          </View>
          {shown.action ? (
            <ToastAction
              title={shown.action.title}
              onPress={() => {
                shown.action!.run();
                setShown(null);
                hideToast(windowId, shown.id);
              }}
            />
          ) : null}
        </Surface>
      </Animated.View>
    </View>
  );
}

function ToastAction({ title, onPress }: { title: string; onPress(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable {...hoverProps} onPress={onPress}>
      {({ pressed }) => (
        <View style={{ height: 24, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center", backgroundColor: pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : theme.urlPill }}>
          <Text style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}
