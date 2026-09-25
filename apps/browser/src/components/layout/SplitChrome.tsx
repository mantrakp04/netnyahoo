import { Surface, Symbol, VisualEffect } from "@netnyahoo/shell";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import type { SplitView } from "../../store/types";
import { resize, type Divider, type Rect } from "./geometry";
import { useHover } from "../primitives";
import { hideToast, useToasts } from "./splitActions";
import { useWindowId } from "../../store/hooks";
import { setDropTarget, useTabDrag, type DropTarget } from "./tabDrag";

/**
 * Drag handles in the gaps between panes. Hovering shows Dia's small rounded
 * handle; dragging resizes the neighbours (each keeps a minimum size).
 */
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
            // The stacked slot runs the full width / height across the split.
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
        // A little wider than the gap so it's easy to grab.
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

/**
 * While a tab is dragged over the page: Dia's left / right split targets on the
 * pane under the pointer. The hovered one lights up; dropping splits there.
 */
export function DropTargets({ panes, origin }: { panes: Record<string, Rect>; origin: { x: number; y: number } | null }) {
  const theme = useTheme();
  const windowId = useWindowId();
  // Only the window the drag is in: other windows' coordinates differ.
  const dragging = useTabDrag((s) => (s.windowId === windowId ? s.tabId : null));
  const x = useTabDrag((s) => s.x);
  const y = useTabDrag((s) => s.y);
  const target = useTabDrag((s) => s.target);
  // A full split takes no more panes (dropping onto it would show the "Cannot Add" toast).
  const full = Object.keys(panes).length >= 3;

  // Which pane (and which half) the pointer is over, in content coordinates.
  const hit = useMemo((): DropTarget | null => {
    if (!dragging || !origin || x < 0 || full) return null;
    const px = x - origin.x;
    const py = y - origin.y;
    for (const [tabId, r] of Object.entries(panes)) {
      if (tabId === dragging) continue;
      if (px < r.x || px > r.x + r.width || py < r.y || py > r.y + r.height) continue;
      return { tabId, side: px < r.x + r.width / 2 ? "left" : "right" };
    }
    return null;
  }, [dragging, origin, x, y, panes, full]);
  useEffect(() => setDropTarget(hit), [hit?.tabId, hit?.side]);
  useEffect(() => () => setDropTarget(null), []);

  if (!dragging || full || !origin) return null;
  const overPage = Object.entries(panes).some(([, r]) => x - origin.x >= r.x && x - origin.x <= r.x + r.width && y - origin.y >= r.y && y - origin.y <= r.y + r.height);
  if (!overPage) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Object.entries(panes)
        .filter(([tabId]) => tabId !== dragging)
        .flatMap(([tabId, r]) =>
          (["left", "right"] as const).map((side) => (
            <DropZone key={`${tabId}${side}`} rect={r} side={side} active={target?.tabId === tabId && target.side === side} dark={theme.dark} />
          )),
        )}
    </View>
  );
}

function DropZone({ rect, side, active, dark }: { rect: Rect; side: "left" | "right"; active: boolean; dark: boolean }) {
  const glow = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(glow, { toValue: active ? 1 : 0, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [active]);
  const inset = 10;
  const w = rect.width / 2 - inset * 1.5;
  return (
    <Animated.View
      style={{
        position: "absolute",
        top: rect.y + inset,
        height: rect.height - inset * 2,
        left: side === "left" ? rect.x + inset : rect.x + rect.width - inset - w,
        width: w,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: glow.interpolate({ inputRange: [0, 1], outputRange: [dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)", dark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.35)"] }),
        backgroundColor: glow.interpolate({ inputRange: [0, 1], outputRange: [dark ? "rgba(30,28,29,0.35)" : "rgba(255,255,255,0.3)", dark ? "rgba(60,56,58,0.62)" : "rgba(255,255,255,0.7)"] }),
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) }],
      }}
    >
      <Symbol name={side === "left" ? "rectangle.lefthalf.filled" : "rectangle.righthalf.filled"} size={26} weight="light" color={dark ? "#FFFFFFCC" : "#000000A8"} style={{ width: 40, height: 32 }} />
      <Text style={{ fontSize: 13, fontWeight: "500", color: dark ? "#FFFFFFCC" : "#000000A8" }}>{side === "left" ? "Split Left" : "Split Right"}</Text>
    </Animated.View>
  );
}

/** Dia's toast ("Cannot Add New Pane"), at the bottom of the page; fades out on its own. */
export function SplitToast({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const toast = useToasts((s) => s.toasts[windowId] ?? null);
  const appear = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(toast);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    appear.setValue(0);
    Animated.spring(appear, { toValue: 1, useNativeDriver: false, speed: 18, bounciness: 6 }).start();
    const timer = setTimeout(() => {
      Animated.timing(appear, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: false }).start(({ finished }) => {
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
