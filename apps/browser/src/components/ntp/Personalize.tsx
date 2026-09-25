import { Surface, Symbol } from "@netnyahoo/shell";
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { create } from "zustand";
import { hex, useTheme } from "../../lib/theme";
import { PERSONALIZE_COPY, TabLayoutPicker, ThemeColorPicker } from "../onboarding/personalize";
import { useHover } from "../primitives";

const INSET = 16;
const BUTTON = 30;

/** Which window has the panel open (one at a time, like a popover). */
const usePanel = create<{ windowId: string | null }>(() => ({ windowId: null }));
const setOpen = (windowId: string | null) => usePanel.setState({ windowId });

/**
 * The New Tab page's Personalize button (bottom right) and its panel: the profile's theme colour
 * and the tab layout, the same controls as onboarding's Personalization step.
 */
export function PersonalizeButton({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const open = usePanel((s) => s.windowId === windowId);
  // Leaving the New Tab page closes it.
  useEffect(() => () => {
    if (usePanel.getState().windowId === windowId) setOpen(null);
  }, [windowId]);
  return (
    <>
      {open ? <PersonalizePanel windowId={windowId} onClose={() => setOpen(null)} /> : null}
      <View {...hoverProps} tooltip="Personalize" style={{ position: "absolute", right: INSET, bottom: INSET }}>
        <Pressable onPress={() => setOpen(open ? null : windowId)} accessibilityRole="button" accessibilityLabel="Personalize" accessibilityState={{ expanded: open }}>
          {({ pressed }) => (
            <View
              style={{
                width: BUTTON,
                height: BUTTON,
                borderRadius: BUTTON / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? theme.toolbarPressed : hovered || open ? theme.toolbarHover : undefined,
              }}
            >
              <Symbol name="paintpalette" size={14} color={hovered || open ? theme.icon : theme.textTertiary} style={{ width: BUTTON, height: BUTTON }} />
            </View>
          )}
        </Pressable>
      </View>
    </>
  );
}

function PersonalizePanel({ windowId, onClose }: { windowId: string; onClose: () => void }) {
  const theme = useTheme();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(t, { toValue: 1, friction: 9, tension: 90, useNativeDriver: false }).start();
  }, []);
  return (
    <>
      {/* Clicking anywhere else closes it. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close Personalize" />
      <Animated.View
        style={{
          position: "absolute",
          right: INSET,
          bottom: INSET + BUTTON + 8,
          width: 352,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
        }}
      >
        <Surface
          fill={hex(theme.panel)}
          cornerRadius={16}
          borderColor={hex(theme.panelBorder)}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={theme.panelShadowOpacity}
          shadowRadius={24}
          shadowOffset={[0, 10]}
        >
          <View style={{ padding: 18, gap: 16 }}>
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{PERSONALIZE_COPY.title}</Text>
              <Text style={{ fontSize: 12, lineHeight: 17, color: theme.textSecondary }}>{PERSONALIZE_COPY.subtitle}</Text>
            </View>
            <ThemeColorPicker windowId={windowId} size={28} />
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 12, color: theme.textSecondary }}>{PERSONALIZE_COPY.layouts}</Text>
              <TabLayoutPicker windowId={windowId} />
            </View>
          </View>
        </Surface>
      </Animated.View>
    </>
  );
}

// DEV: tooling opens it through the dev harness (`globalThis.nnPersonalize`).
if (__DEV__) (globalThis as { nnPersonalize?: unknown }).nnPersonalize = { open: setOpen };
