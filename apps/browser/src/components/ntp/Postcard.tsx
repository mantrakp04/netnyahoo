import { WindowBackdrop } from "@netnyahoo/shaders";
import { Surface, Symbol, VisualEffect } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { hex, PROFILE_COLORS, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { useHover } from "../primitives";
import type { ReleaseNotes } from "./releaseNotes";

const ICON = require("../../../assets/app-icon.png");

/**
 * Dia's ReleaseNotesPostcardView, measured from its binary: a 320×200 card tilted 2° clockwise,
 * hanging off the New Tab page's top-right corner (40pt past the right edge, 30pt above the top).
 */
const CARD = { width: 320, height: 200, overhangRight: 40, overhangTop: 30, tilt: 2, radius: 10 };
/** Hovering anywhere this close to the card shows its tooltip. */
const HOVER_SLOP = 24;
const TOOLTIP = { height: 28, gap: 4 };
const PAPER = "#FCFCFA";
const INK = "#1D1B1A";

/** Where the card sits in the page (unrotated), for the full-page view to grow out of. */
const cardFrame = (size: { width: number }) => ({
  x: size.width + CARD.overhangRight - CARD.width,
  y: -CARD.overhangTop,
  width: CARD.width,
  height: CARD.height,
});

/** The release's artwork colours: the window profile's theme, lightened and deepened. */
function useArtworkColors(): [string, string] {
  const windowId = useWindowId();
  const color = useBrowser((s) => s.profiles[s.windows[windowId]?.profileId ?? ""]?.color ?? "plum");
  const swatch = PROFILE_COLORS[color]?.swatch ?? PROFILE_COLORS.plum.swatch;
  return [mix(swatch, "#FFFFFF", 0.45), mix(swatch, "#10121A", 0.5)];
}

function mix(a: string, b: string, t: number) {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The release notes postcard on the New Tab page. It drops in from above (a critically damped
 * spring, 0.65s, with a 0.3s fade; none under Reduce Motion); hovering scales it to 1.05 and
 * shows "Latest Release Notes" under it with a close button; clicking opens the notes.
 */
export function ReleaseNotesPostcard({ notes, size, onOpen, onDismiss }: { notes: ReleaseNotes; size: { width: number; height: number }; onOpen: () => void; onDismiss: () => void }) {
  const { hovered, hoverProps } = useHover();
  const drop = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const tooltip = useRef(new Animated.Value(0)).current;
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) return drop.setValue(0), opacity.setValue(1);
      // CASpringAnimation(perceptualDuration: 0.65, bounce: 0).
      const stiffness = (2 * Math.PI / 0.65) ** 2;
      Animated.parallel([
        Animated.spring(drop, { toValue: 0, stiffness, damping: 2 * Math.sqrt(stiffness), mass: 1, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    Animated.timing(scale, { toValue: hovered ? 1.05 : 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    Animated.timing(tooltip, { toValue: hovered ? 1 : 0, duration: hovered ? 50 : 100, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [hovered]);

  const dismiss = () => {
    setLeaving(true);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: false }),
      Animated.timing(scale, { toValue: 0.96, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: false }),
    ]).start(onDismiss);
  };
  // Too small a page: it would crowd the command bar.
  if (size.height < 420 || size.width < 560) return null;

  const card = cardFrame(size);
  return (
    <Animated.View
      pointerEvents={leaving ? "none" : "box-none"}
      style={{
        position: "absolute",
        left: card.x - HOVER_SLOP,
        top: card.y - HOVER_SLOP,
        width: card.width + HOVER_SLOP * 2,
        height: card.height + HOVER_SLOP + TOOLTIP.gap + TOOLTIP.height,
        opacity,
        transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [0, -280] }) }],
      }}
    >
      <View {...hoverProps} style={StyleSheet.absoluteFill}>
        <Animated.View
          style={{
            position: "absolute",
            left: HOVER_SLOP,
            top: HOVER_SLOP,
            width: card.width,
            height: card.height,
            transform: [{ rotate: `${CARD.tilt}deg` }, { scale }],
          }}
        >
          <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel="What's new in Netnyahoo" style={{ flex: 1 }}>
            <Surface
              style={StyleSheet.absoluteFill}
              cornerRadius={CARD.radius}
              fill="#00000000"
              shadowColor="#000000"
              shadowOpacity={0.3}
              shadowRadius={20}
              // Dia's offset is (0, 6) in unflipped coordinates: the shadow rises above the card.
              shadowOffset={[0, -6]}
            />
            <Artwork notes={notes} radius={CARD.radius} titleSize={40} hidden={{ top: CARD.overhangTop, right: CARD.overhangRight }} />
          </Pressable>
        </Animated.View>
        <Animated.View
          pointerEvents={hovered ? "box-none" : "none"}
          style={{ position: "absolute", left: 0, right: 0, top: HOVER_SLOP + card.height + TOOLTIP.gap, alignItems: "center", opacity: tooltip }}
        >
          <Tooltip text="Latest Release Notes" onOpen={onOpen} onClose={dismiss} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/** ReleaseNotesPostcardTooltipView: a small blurred pill (opens the notes) with a close button. */
function Tooltip({ text, onOpen, onClose }: { text: string; onOpen: () => void; onClose: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={text}>
      <View style={{ height: TOOLTIP.height, borderRadius: 6, overflow: "hidden", flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 3 }}>
        <VisualEffect material="contentBackground" blendingMode="withinWindow" cornerRadius={6} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.8)" }]} />
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: "rgba(255,255,255,0.85)", marginRight: 9 }}>
          {text}
        </Text>
        <CloseButton onPress={onClose} label="Dismiss release notes" size={22} radius={8} />
      </View>
    </Pressable>
  );
}

/** PostcardCloseButton: an xmark on a faint square that deepens on hover and press. */
function CloseButton({ onPress, label, size, radius }: { onPress: () => void; label: string; size: number; radius: number }) {
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={label}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
        {({ pressed }) => (
          <View
            style={{
              width: size,
              height: size,
              borderRadius: radius,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `rgba(255,255,255,${pressed ? 0.3 : hovered ? 0.2 : 0.1})`,
            }}
          >
            <Symbol name="xmark" size={11} weight="medium" color="#FFFFFF8C" style={{ width: size, height: size }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

/** The release's picture side: a grained gradient in the profile's colours, titled. */
function Artwork({ notes, radius, titleSize, hidden }: { notes: ReleaseNotes; radius: number; titleSize: number; hidden?: { top: number; right: number } }) {
  const colors = useArtworkColors();
  const k = titleSize / 44;
  const pad = 22 * k;
  return (
    <View style={{ flex: 1, borderRadius: radius, overflow: "hidden", backgroundColor: mix(colors[0], colors[1], 0.5) }}>
      <WindowBackdrop colors={colors} angle={150} grainOpacity={0.1} style={StyleSheet.absoluteFill} />
      {/* Kept clear of the edges that hang off the page. */}
      <View style={{ flex: 1, padding: pad, paddingTop: pad + (hidden?.top ?? 0), paddingRight: pad + (hidden?.right ?? 0), justifyContent: "space-between" }}>
        <Text style={{ fontSize: 11.5 * k, fontWeight: "700", letterSpacing: 1.4 * k, color: "#FFFFFFCC" }}>{`NETNYAHOO ${notes.version}`}</Text>
        <Text style={{ fontSize: titleSize, fontWeight: "300", fontStyle: "italic", letterSpacing: -1.1 * k, color: "#FFFFFF" }}>{"What's new"}</Text>
      </View>
    </View>
  );
}

/**
 * The notes as a full-page postcard over the New Tab page (Dia 1.46's release notes): the picture
 * on the left, the message on the right under a stamp and postmark.
 */
export function ReleaseNotesPage({ notes, size, onClose }: { notes: ReleaseNotes; size: { width: number; height: number }; onClose: () => void }) {
  const theme = useTheme();
  const t = useRef(new Animated.Value(0)).current;
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    Animated.spring(t, { toValue: 1, friction: 9, tension: 55, useNativeDriver: false }).start();
    // Leaving the New Tab page closes it.
    return onClose;
  }, []);
  const close = () => {
    setClosing(true);
    Animated.timing(t, { toValue: 0, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: false }).start(onClose);
  };

  const width = Math.min(860, size.width - 64);
  const height = Math.min(520, size.height - 64, width * 0.62);
  const split = width >= 640;
  // It grows out of the corner the postcard hung in.
  const card = cardFrame(size);
  const from = { x: card.x + card.width / 2 - size.width / 2, y: card.y + card.height / 2 - size.height / 2 };

  return (
    <Animated.View style={StyleSheet.absoluteFill} pointerEvents={closing ? "none" : "auto"}>
      {/* The New Tab page's own backdrop, washed over so the card stands alone. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }) }]}>
        <VisualEffect material="hudWindow" blendingMode="withinWindow" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.dark ? "rgba(10,10,10,0.35)" : "rgba(255,255,255,0.35)" }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close release notes" />
      </Animated.View>
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]} pointerEvents="box-none">
        <Animated.View
          style={{
            width,
            height,
            opacity: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
            transform: [
              { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [from.x, 0] }) },
              { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [from.y, 0] }) },
              { scale: t.interpolate({ inputRange: [0, 1], outputRange: [CARD.width / width, 1] }) },
              { rotate: t.interpolate({ inputRange: [0, 1], outputRange: [`${CARD.tilt}deg`, "-1deg"] }) },
            ],
          }}
        >
          <Surface
            style={StyleSheet.absoluteFill}
            fill={PAPER}
            cornerRadius={6}
            borderColor="#00000014"
            borderWidth={0.5}
            shadowColor="#000000"
            shadowOpacity={0.3}
            shadowRadius={40}
            shadowOffset={[0, 18]}
          />
          <View style={{ flex: 1, flexDirection: split ? "row" : "column", padding: 16, gap: 22 }}>
            <View style={split ? { width: "46%" } : { height: 150 }}>
              <Artwork notes={notes} radius={4} titleSize={46} />
            </View>
            <View style={{ flex: 1, paddingTop: 10, paddingRight: 8 }}>
              <Stamp />
              <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 1.2, color: `${INK}80`, marginRight: 116 }}>{notes.date.toUpperCase()}</Text>
              <Text style={{ fontSize: 26, fontWeight: "300", letterSpacing: -0.5, color: INK, marginTop: 6, marginRight: 116 }}>{notes.title}</Text>
              <Text style={{ fontSize: 13, lineHeight: 19, color: `${INK}B3`, marginTop: 8, marginRight: 116 }}>{notes.summary}</Text>
              <ScrollView style={{ flex: 1, marginTop: 14 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
                {notes.items.map((item) => (
                  <View key={item.title} style={{ gap: 2, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: `${INK}14` }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: INK }}>{item.title}</Text>
                    <Text style={{ fontSize: 12.5, lineHeight: 18, color: `${INK}99` }}>{item.body}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
          <View style={{ position: "absolute", right: -13, top: -13 }}>
            <PageCloseButton onPress={close} />
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function PageCloseButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const label = "Close release notes";
  return (
    <View {...hoverProps} tooltip={label}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
        {({ pressed }) => (
          <Surface
            fill={hex(theme.panel)}
            cornerRadius={13}
            borderColor={hex(theme.panelBorder)}
            borderWidth={0.5}
            shadowColor="#000000"
            shadowOpacity={0.2}
            shadowRadius={6}
            shadowOffset={[0, 2]}
            style={{ width: 26, height: 26, transform: [{ scale: pressed ? 0.94 : 1 }] }}
          >
            <Symbol name="xmark" size={10} weight="semibold" color={hovered ? theme.textPrimary : theme.textSecondary} style={{ width: 26, height: 26 }} />
          </Surface>
        )}
      </Pressable>
    </View>
  );
}

/** The app icon as a perforated stamp, franked by a round postmark. */
function Stamp() {
  return (
    <View style={{ position: "absolute", right: 0, top: 0, width: 110, height: 86 }} pointerEvents="none">
      <View style={{ position: "absolute", right: 0, top: 0, padding: 4, borderWidth: 1.5, borderStyle: "dashed", borderColor: `${INK}33`, borderRadius: 3, backgroundColor: "#FFFFFF" }}>
        <Image source={ICON} style={{ width: 54, height: 54 }} />
      </View>
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 18,
          width: 58,
          height: 58,
          borderRadius: 29,
          borderWidth: 1.2,
          borderColor: `${INK}59`,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ rotate: "-14deg" }],
        }}
      >
        <Text style={{ fontSize: 6.5, fontWeight: "700", letterSpacing: 0.6, color: `${INK}80` }}>{"WHAT'S NEW"}</Text>
      </View>
    </View>
  );
}
