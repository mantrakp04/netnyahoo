import { Surface, Symbol, VisualEffect } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useDefaultBrowserCheckIn } from "../../lib/defaultBrowserCheckIn";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { dismissAsk, setSharing, useTelemetry } from "../../telemetry/client";
import { SHARING_COPY } from "../../telemetry/copy";
import { onboardingCompletedAt, useOnboarding } from "../onboarding/state";
import { useHover } from "../primitives";
import { openSettings } from "../settings/windows";
import { usePendingReleaseNotes } from "./releaseNotes";

/** The card sizes to its copy (three lines of body at 300 wide), so its padding holds all round. */
const FRAME = { width: 300 };

/**
 * The one-time ask for people who installed Netnyahoo before it could share crash reports (new
 * installs answer in onboarding). It waits its turn in the New Tab page's corner (after the
 * default-browser check-in and the release notes postcard) and never comes back once answered
 * or dismissed. "Not now" and "Share" weigh the same.
 */
export function TelemetryAsk({ windowId }: { windowId: string }) {
  const due = useTelemetry((s) => !s.decided && !s.askDone);
  const incognito = useBrowser((s) => !!s.windows[windowId]?.incognito);
  const onboarding = useOnboarding((s) => s.windowId !== null);
  const checkIn = useDefaultBrowserCheckIn(windowId).visible;
  const releaseNotes = usePendingReleaseNotes() !== null;
  // Existing installs only: onboarding done before this ask existed (or counted as done).
  const [existing] = useState(() => onboardingCompletedAt() !== null);
  const [leaving, setLeaving] = useState<null | (() => void)>(null);
  if (!leaving && !(due && existing && !incognito && !onboarding && !checkIn && !releaseNotes)) return null;
  const retire = (action: () => void) =>
    setLeaving(() => () => {
      action();
      setLeaving(null);
    });
  return (
    <View style={{ position: "absolute", left: 0, top: 0, width: FRAME.width, padding: 8 }} pointerEvents="box-none">
      <Card
        leaving={leaving}
        onShare={() => retire(() => setSharing(true, "ask"))}
        onNotNow={() => retire(() => setSharing(false, "ask"))}
        onClose={() => retire(dismissAsk)}
      />
    </View>
  );
}

function Card({ leaving, onShare, onNotNow, onClose }: { leaving: null | (() => void); onShare: () => void; onNotNow: () => void; onClose: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 300, delay: 600, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, []);
  useEffect(() => {
    if (!leaving) return;
    Animated.parallel([
      Animated.timing(scale, { toValue: 0.98, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.timing(opacity, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false }),
    ]).start(() => leaving());
  }, [leaving]);

  const primary = theme.dark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.8)";
  const secondary = theme.dark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.53)";
  return (
    <Animated.View {...hoverProps} style={{ opacity, transform: [{ scale }] }} pointerEvents={leaving ? "none" : "auto"}>
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
      <View style={{ padding: 12, gap: 12 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 7,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.dark ? "#FFFFFF14" : "#0000000A",
            }}
          >
            <Symbol name="stethoscope" size={14} weight="medium" color={theme.dark ? "#FFFFFFCC" : "#000000B3"} style={{ width: 30, height: 30 }} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: primary }}>
              {SHARING_COPY.ask.title}
            </Text>
            <Text style={{ fontSize: 11.5, lineHeight: 15, color: secondary }}>
              {SHARING_COPY.ask.body}{" "}
              <Text onPress={() => openSettings("privacy")} style={{ textDecorationLine: "underline" }} accessibilityRole="link">
                {SHARING_COPY.whatsSent}
              </Text>
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <AskButton title={SHARING_COPY.ask.notNow} onPress={onNotNow} />
          <AskButton title={SHARING_COPY.ask.share} onPress={onShare} />
        </View>
      </View>
      <View style={{ position: "absolute", right: -8, top: -8, opacity: hovered ? 1 : 0 }} pointerEvents={hovered ? "auto" : "none"}>
        <CloseButton onPress={onClose} />
      </View>
    </Animated.View>
  );
}

/** Both answers use this: the same size, fill and weight. */
function AskButton({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  const fill = theme.dark ? (pressed ? "#FFFFFF2E" : hovered ? "#FFFFFF24" : "#FFFFFF17") : pressed ? "#0000001F" : hovered ? "#00000017" : "#0000000D";
  return (
    <View {...hoverProps} style={{ flex: 1 }}>
      <Pressable onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} accessibilityRole="button" accessibilityLabel={title}>
        <View style={{ height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: fill }}>
          <Text style={{ fontSize: 12, fontWeight: "500", color: theme.dark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.8)" }}>{title}</Text>
        </View>
      </Pressable>
    </View>
  );
}

/** The check-in card's close button: a small round xmark over a thin material. */
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
