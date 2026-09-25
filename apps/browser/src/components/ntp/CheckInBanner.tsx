import { Surface, Symbol, VisualEffect } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { CHECK_IN_COPY, useDefaultBrowserCheckIn } from "../../lib/defaultBrowserCheckIn";
import { hex, useTheme } from "../../lib/theme";
import { useHover } from "../primitives";

const ICON = require("../../../assets/app-icon.png");

/**
 * Dia's NewTabPageTryForAWeek frame is 242×69 in the New Tab page's top-left corner; ours is wider
 * by what "Netnyahoo" takes over "Dia" in the title, so it fits on one line.
 */
const FRAME = { width: 282, height: 69 };

/**
 * The follow-up to onboarding's "Try it for a week": seven days on, the New Tab page asks "How are
 * you liking Netnyahoo?" (Dia's TryForAWeekView). The card opens Help › Send Feedback…; it and the
 * close button both retire it. When it's due is lib/defaultBrowserCheckIn's call.
 */
export function CheckInBanner({ windowId }: { windowId: string }) {
  const checkIn = useDefaultBrowserCheckIn(windowId);
  const [leaving, setLeaving] = useState<null | (() => void)>(null);
  if (!checkIn.visible && !leaving) return null;
  // Removal: scale 0.98 and fade, then retire it (which unmounts this).
  const retire = (action: () => void) =>
    setLeaving(() => () => {
      action();
      setLeaving(null);
    });
  return (
    <View style={{ position: "absolute", left: 0, top: 0, width: FRAME.width, height: FRAME.height, padding: 8 }} pointerEvents="box-none">
      <Card leaving={leaving} onFeedback={() => retire(checkIn.leaveFeedback)} onClose={() => retire(checkIn.dismiss)} />
    </View>
  );
}

function Card({ leaving, onFeedback, onClose }: { leaving: null | (() => void); onFeedback: () => void; onClose: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 300, delay: 300, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, []);
  // spring(response: 0.2, dampingFraction: 0.5): hover 1.02, press 0.98.
  useEffect(() => {
    if (leaving) return;
    const stiffness = (2 * Math.PI / 0.2) ** 2;
    Animated.spring(scale, { toValue: pressed ? 0.98 : hovered ? 1.02 : 1, stiffness, damping: 2 * 0.5 * Math.sqrt(stiffness), mass: 1, useNativeDriver: false }).start();
  }, [hovered, pressed, !!leaving]);
  useEffect(() => {
    if (!leaving) return;
    Animated.parallel([
      Animated.timing(scale, { toValue: 0.98, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.timing(opacity, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false }),
    ]).start(() => leaving());
  }, [leaving]);

  return (
    <Animated.View {...hoverProps} style={{ flex: 1, opacity, transform: [{ scale }] }} pointerEvents={leaving ? "none" : "auto"}>
      <Pressable
        onPress={onFeedback}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityRole="button"
        accessibilityLabel={`${CHECK_IN_COPY.title} ${CHECK_IN_COPY.action}`}
        style={{ flex: 1 }}
      >
        <Surface
          style={StyleSheet.absoluteFill}
          fill={theme.dark ? "#FFFFFF17" : "#FFFFFF80"}
          cornerRadius={10}
          borderColor={theme.dark ? "#FFFFFF0A" : "#00000014"}
          borderWidth={1}
          shadowColor="#000000"
          shadowOpacity={theme.dark ? 0.3 : 0.1}
          shadowRadius={24}
          shadowOffset={[0, 8]}
        />
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 10 }}>
          <View style={{ width: 37, height: 37, borderRadius: 6, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
            <Image source={ICON} style={{ width: 37, height: 37 }} />
          </View>
          <View style={{ flex: 1, gap: 2, paddingLeft: 4 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: theme.dark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.8)" }}>
              {CHECK_IN_COPY.title}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Text style={{ fontSize: 12, color: theme.dark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.53)" }}>{CHECK_IN_COPY.action}</Text>
              <Symbol name="arrow.up.right" size={9} weight="medium" color={theme.dark ? "#FFFFFF99" : "#00000087"} style={{ width: 11, height: 11 }} />
            </View>
          </View>
        </View>
      </Pressable>
      <View style={{ position: "absolute", right: -8, top: -8, opacity: hovered ? 1 : 0 }} pointerEvents={hovered ? "auto" : "none"}>
        <CloseButton onPress={onClose} />
      </View>
    </Animated.View>
  );
}

/** A small round xmark over a thin material, at the card's top-trailing corner. */
function CloseButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const fill = theme.dark ? (hovered ? "#FFFFFF4D" : "#FFFFFF14") : hovered ? "#0000004D" : "#00000033";
  return (
    <View {...hoverProps} tooltip="Dismiss">
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Dismiss">
        <View style={{ width: 23, height: 23, borderRadius: 11.5, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
          <VisualEffect material="hudWindow" blendingMode="withinWindow" cornerRadius={11.5} style={StyleSheet.absoluteFill} />
          <Surface style={StyleSheet.absoluteFill} fill={hex(fill)} cornerRadius={11.5} borderColor={theme.dark ? "#FFFFFF1F" : "#00000014"} borderWidth={1} />
          <Symbol name="xmark" size={10} weight="medium" color="#FFFFFFE6" style={{ width: 23, height: 23 }} />
        </View>
      </Pressable>
    </View>
  );
}
