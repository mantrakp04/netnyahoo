import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { PROFILE_COLORS } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import type { ProfileColor } from "../../store/types";
import { useHover } from "../primitives";
import { useOnboardingColors } from "./ui";

/**
 * Dia's Personalization (onboarding's PersonalizationView, and the New Tab page's Personalize):
 * the theme colour of the window's profile and the tab layout, applied as they're picked.
 */
export const PERSONALIZE_COPY = {
  title: "Make it yours",
  subtitle: "Pick the theme color and layout that feel right for you.",
  layouts: "Choose how you would like to view your tabs:",
} as const;

const COLORS = Object.keys(PROFILE_COLORS) as ProfileColor[];

export function ThemeColorPicker({ windowId, size = 30 }: { windowId: string; size?: number }) {
  const profileId = useBrowser((s) => s.windows[windowId]?.profileId);
  const current = useBrowser((s) => (profileId ? s.profiles[profileId]?.color : undefined));
  const incognito = useBrowser((s) => !!s.windows[windowId]?.incognito);
  if (!profileId || incognito) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: size >= 30 ? 8 : 6 }} accessibilityRole="radiogroup" accessibilityLabel="Theme color">
      {COLORS.map((c) => (
        <ColorButton key={c} color={c} size={size} selected={current === c} onPress={() => useBrowser.getState().updateProfile(profileId, { color: c })} />
      ))}
    </View>
  );
}

/** PersonalizationColorButton: an inner swatch, and an outer ring in its colour once picked. */
function ColorButton({ color, size, selected, onPress }: { color: ProfileColor; size: number; selected: boolean; onPress: () => void }) {
  const { swatch, name } = PROFILE_COLORS[color];
  const { hovered, hoverProps } = useHover();
  const t = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: selected ? 1 : 0, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [selected]);
  return (
    <View {...hoverProps} tooltip={name}>
      <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={name}>
        {({ pressed }) => (
          <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.94 : 1 }] }}>
            <Animated.View
              style={{
                position: "absolute",
                width: size,
                height: size,
                borderRadius: size / 2,
                borderWidth: 2,
                borderColor: swatch,
                opacity: t,
              }}
            />
            {/* Sized rather than scaled: the swatch shrinks inside the ring once picked. */}
            <Animated.View
              style={{
                width: t.interpolate({ inputRange: [0, 1], outputRange: [size - (hovered ? 6 : 8), size - 12] }),
                height: t.interpolate({ inputRange: [0, 1], outputRange: [size - (hovered ? 6 : 8), size - 12] }),
                borderRadius: size / 2,
                backgroundColor: swatch,
                opacity: hovered || selected ? 1 : 0.85,
              }}
            />
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function TabLayoutPicker({ windowId }: { windowId: string }) {
  const layout = useBrowser((s) => s.windows[windowId]?.tabLayout ?? s.settings.tabLayout);
  const pick = (next: "sidebar" | "top") => {
    if (next !== layout) useBrowser.getState().toggleTabLayout(windowId);
  };
  return (
    <View style={{ flexDirection: "row", gap: 10 }} accessibilityRole="radiogroup" accessibilityLabel="Tab layout">
      <LayoutButton kind="sidebar" title="Sidebar" subtitle="Tabs down the side" selected={layout === "sidebar"} onPress={() => pick("sidebar")} />
      <LayoutButton kind="top" title="Classic" subtitle="Tabs along the top" selected={layout === "top"} onPress={() => pick("top")} />
    </View>
  );
}

/** PersonalizationTabLayoutButton: a little window drawn in that layout, with a radio button. */
function LayoutButton({ kind, title, subtitle, selected, onPress }: { kind: "sidebar" | "top"; title: string; subtitle: string; selected: boolean; onPress: () => void }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  const bar = { backgroundColor: colors.progressTrack, borderRadius: 2 };
  return (
    <View {...hoverProps} style={{ flex: 1 }}>
      <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            style={{
              padding: 10,
              gap: 10,
              borderRadius: 12,
              backgroundColor: hovered || selected ? colors.button : colors.row,
              borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth * 2,
              borderColor: selected ? colors.title : colors.rowBorder,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            }}
          >
            <View style={{ height: 64, borderRadius: 7, padding: 5, gap: 4, backgroundColor: colors.preview, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.previewBorder, flexDirection: kind === "sidebar" ? "row" : "column" }}>
              {kind === "sidebar" ? (
                <View style={{ width: "26%", gap: 3, paddingTop: 7 }}>
                  {[1, 0.8, 0.9].map((w, i) => (
                    <View key={i} style={[bar, { height: 5, width: `${w * 100}%`, opacity: i === 0 ? 1 : 0.6 }]} />
                  ))}
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: 3, height: 7, paddingLeft: 12 }}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={[bar, { width: "22%", height: 7, opacity: i === 0 ? 1 : 0.6 }]} />
                  ))}
                </View>
              )}
              <View style={{ flex: 1, borderRadius: 4, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.previewBorder }} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Radio on={selected} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12.5, fontWeight: "500", color: colors.title }}>{title}</Text>
                <Text style={{ fontSize: 11, color: colors.rowSubtitle }}>{subtitle}</Text>
              </View>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function Radio({ on }: { on: boolean }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: on ? 5 : 1.5, borderColor: on ? colors.checkboxOn : colors.checkboxBorder, backgroundColor: colors.checkbox }} />
  );
}
