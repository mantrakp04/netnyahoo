import { Surface, VisualEffect, WindowDragRegion } from "@arcadia/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { hex } from "../../lib/theme";
import { useWindowId } from "../../store/hooks";
import { Intro } from "./Intro";
import { dismissOnboarding, useOnboarding } from "./state";
import { DefaultBrowserStep, ImportStep, OutroStep, PersonalizeStep, PinnedTabsStep } from "./steps";
import { PrivacyStep } from "./privacyStep";
import { ToolTour } from "./tour/ToolTour";
import { useOnboardingColors } from "./ui";

const CARD = { width: 880, height: 560, margin: 40 };

export function OnboardingOverlay() {
  const windowId = useWindowId();
  const active = useOnboarding((s) => s.windowId === windowId);
  const session = useOnboarding((s) => s.session);
  return (
    <>
      {active ? <Overlay key={session} session={session} /> : null}
      <ToolTour />
    </>
  );
}

function Overlay({ session }: { session: number }) {
  const colors = useOnboardingColors();
  const step = useOnboarding((s) => s.step);
  const leaving = useOnboarding((s) => s.leaving);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const presence = useRef(new Animated.Value(0)).current;
  const card = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(presence, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    if (step === "intro") return card.setValue(0);
    Animated.spring(card, { toValue: 1, friction: 9, tension: 60, useNativeDriver: true }).start();
  }, [step === "intro"]);

  useEffect(() => {
    if (!leaving) return;
    Animated.parallel([
      Animated.timing(presence, { toValue: 0, duration: 420, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(card, { toValue: 2, duration: 420, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(({ finished }) => finished && dismissOnboarding(session));
  }, [leaving]);

  const width = Math.min(CARD.width, Math.max(0, size.width - CARD.margin * 2));
  const height = Math.min(CARD.height, Math.max(0, size.height - CARD.margin * 2));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: presence }]}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <VisualEffect material="fullScreenUI" blendingMode="withinWindow" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />
      <WindowDragRegion style={StyleSheet.absoluteFill} />
      {step !== "intro" && width > 0 && (
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]} pointerEvents="box-none">
          <Animated.View
            style={{
              width,
              height,
              opacity: card.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] }),
              transform: [
                { translateY: card.interpolate({ inputRange: [0, 1, 2], outputRange: [24, 0, 0] }) },
                { scale: card.interpolate({ inputRange: [0, 1, 2], outputRange: [0.97, 1, 1.03] }) },
              ],
            }}
          >
            <Surface
              fill={hex(colors.card)}
              cornerRadius={20}
              borderColor={hex(colors.cardBorder)}
              borderWidth={0.5}
              shadowColor="#000000"
              shadowOpacity={0.28}
              shadowRadius={40}
              shadowOffset={[0, 18]}
              style={{ flex: 1, overflow: "hidden" }}
            >
              <View key={step} style={{ flex: 1 }}>
                {step === "defaultBrowser" && <DefaultBrowserStep />}
                {step === "personalize" && <PersonalizeStep />}
                {step === "import" && <ImportStep />}
                {step === "pinnedTabs" && <PinnedTabsStep />}
                {step === "privacy" && <PrivacyStep />}
                {step === "outro" && <OutroStep />}
              </View>
            </Surface>
          </Animated.View>
        </View>
      )}
      {step === "intro" && <Intro onDone={() => useOnboarding.getState().go("defaultBrowser")} />}
    </Animated.View>
  );
}
