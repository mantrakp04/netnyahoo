import { Symbol } from "@netnyahoo/shell";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../lib/theme";
import { useHover } from "../primitives";
import { STEPS, useOnboarding, type OnboardingStep } from "./state";

/**
 * Onboarding colours: Dia's UnboxingUI / Unboxing asset-catalog tokens, per appearance.
 */
export function onboardingColors(dark: boolean) {
  return dark
    ? {
        background: "#000000",
        overlay: "rgba(0,0,0,0.6)", // BackgroundOverlay
        card: "#161616",
        cardBorder: "rgba(254,255,255,0.3)", // BackgroundBorder
        title: "#FEFFFF",
        subtitle: "rgba(254,255,255,0.6)",
        body: "rgba(255,255,255,0.55)", // RebrandBodyText
        footnote: "rgba(255,255,255,0.5)",
        steps: "rgba(255,255,255,0.3)", // StepsDescription
        row: "rgba(255,255,255,0.08)", // RebrandRowBackground
        rowBorder: "rgba(255,255,255,0.16)",
        rowSubtitle: "rgba(255,255,255,0.6)", // RebrandCheckboxSubtitleText
        primary: "rgba(255,255,255,0.85)", // ButtonPrimaryBackground
        primaryHover: "rgba(255,255,255,0.9)",
        primaryText: "#000000",
        button: "rgba(255,255,255,0.08)", // ButtonDefaultBackground
        buttonHover: "rgba(255,255,255,0.1)",
        buttonText: "#FFFFFF",
        outlinedHover: "rgba(255,255,255,0.03)",
        noThanksBorder: "rgba(254,255,255,0.2)",
        noThanksText: "rgba(254,255,255,0.5)",
        iconContainer: "rgba(255,255,255,0.15)",
        separator: "rgba(254,255,255,0.1)",
        preview: "rgba(255,255,255,0.04)",
        previewBorder: "rgba(255,255,255,0.1)",
        progressTrack: "rgba(255,255,255,0.12)",
        progressFill: "#FDD023", // RebrandProgressFill
        checkbox: "rgba(255,255,255,0.1)",
        checkboxBorder: "rgba(255,255,255,0.25)",
        checkboxOn: "#FEFFFF",
        checkmark: "#000000",
      }
    : {
        background: "#FEFFFF",
        overlay: "rgba(254,255,255,0.6)",
        card: "#FFFFFF",
        cardBorder: "rgba(0,0,0,0.08)",
        title: "#000000",
        subtitle: "rgba(0,0,0,0.53)",
        body: "rgba(0,0,0,0.55)",
        footnote: "rgba(0,0,0,0.5)",
        steps: "rgba(0,0,0,0.3)",
        row: "rgba(0,0,0,0.015)",
        rowBorder: "rgba(0,0,0,0.08)",
        rowSubtitle: "rgba(0,0,0,0.6)",
        primary: "rgba(0,0,0,0.85)",
        primaryHover: "rgba(0,0,0,0.9)",
        primaryText: "#FEFFFF",
        button: "rgba(0,0,0,0.08)",
        buttonHover: "rgba(0,0,0,0.1)",
        buttonText: "#000000",
        outlinedHover: "rgba(0,0,0,0.03)",
        noThanksBorder: "rgba(0,0,0,0.1)",
        noThanksText: "rgba(0,0,0,0.5)",
        iconContainer: "rgba(0,0,0,0.03)",
        separator: "rgba(0,0,0,0.1)",
        preview: "rgba(0,0,0,0.025)",
        previewBorder: "rgba(0,0,0,0.07)",
        progressTrack: "rgba(0,0,0,0.08)",
        progressFill: "#FDD023",
        checkbox: "#FFFFFF",
        checkboxBorder: "rgba(0,0,0,0.2)",
        checkboxOn: "#000000",
        checkmark: "#FFFFFF",
      };
}

export const useOnboardingColors = () => onboardingColors(useTheme().dark);

/** Fades and lifts its children in on mount (each step's content, staggered by `delay`). */
export function Reveal({ delay = 0, children, style }: { delay?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** "Step 2 of 4" and a segmented progress bar (the intro isn't counted). */
export function StepProgress() {
  const colors = useOnboardingColors();
  const step = useOnboarding((s) => s.step);
  const steps: OnboardingStep[] = STEPS.filter((s) => s !== "intro");
  const index = steps.indexOf(step);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {steps.map((s, i) => (
          <View key={s} style={{ width: 22, height: 3, borderRadius: 1.5, backgroundColor: i <= index ? colors.progressFill : colors.progressTrack }} />
        ))}
      </View>
      <Text style={{ fontSize: 11, fontWeight: "500", letterSpacing: 0.2, color: colors.steps }}>
        {`STEP ${index + 1} OF ${steps.length}`}
      </Text>
    </View>
  );
}

export function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 26, lineHeight: 31, fontWeight: "300", letterSpacing: -0.4, color: colors.title }}>{title}</Text>
      {subtitle ? <Text style={{ fontSize: 13.5, lineHeight: 19, color: colors.subtitle }}>{subtitle}</Text> : null}
    </View>
  );
}

/** Dia's primary unboxing button: a near-opaque pill in the text colour. */
export function PrimaryButton({ title, onPress, disabled, icon }: { title: string; onPress: () => void; disabled?: boolean; icon?: string }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ opacity: disabled ? 0.4 : 1 }}>
      <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            style={{
              height: 36,
              borderRadius: 18,
              paddingHorizontal: 20,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              backgroundColor: hovered && !disabled ? colors.primaryHover : colors.primary,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primaryText }}>{title}</Text>
            {icon ? <Symbol name={icon} size={11} weight="semibold" color={colors.primaryText} style={{ width: 12, height: 12 }} /> : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

/** Secondary pill ("Skip", "Not now"): outlined, fills faintly on hover. */
export function SecondaryButton({ title, onPress, filled }: { title: string; onPress: () => void; filled?: boolean }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            style={{
              height: 36,
              borderRadius: 18,
              paddingHorizontal: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: filled ? (hovered ? colors.buttonHover : colors.button) : hovered ? colors.outlinedHover : "transparent",
              borderWidth: filled ? 0 : 1,
              borderColor: colors.noThanksBorder,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "500", color: filled ? colors.buttonText : colors.noThanksText }}>{title}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function CheckMark({ on, size = 18 }: { on: boolean; size?: number }) {
  const colors = useOnboardingColors();
  const t = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: on ? 1 : 0, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [on]);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.checkbox,
        borderWidth: 1.5,
        borderColor: colors.checkboxBorder,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={{
          position: "absolute",
          left: -1.5,
          top: -1.5,
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.checkboxOn,
          opacity: t,
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }}
      >
        <Symbol name="checkmark" size={size * 0.5} weight="bold" color={colors.checkmark} style={{ width: size, height: size }} />
      </Animated.View>
    </View>
  );
}

/** Dia's unboxing checkbox row: title, subtitle, round check on the right. */
export function CheckRow({
  title,
  subtitle,
  value,
  onChange,
  disabled,
  icon,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** SF Symbol in a small tile before the text. */
  icon?: string;
}) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ opacity: disabled ? 0.5 : 1 }}>
      <Pressable disabled={disabled} onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value, disabled }} accessibilityLabel={title}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 9,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: hovered && !disabled ? colors.button : colors.row,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.rowBorder,
          }}
        >
          {icon ? (
            <View style={{ width: 28, height: 28, borderRadius: 7, backgroundColor: colors.iconContainer, alignItems: "center", justifyContent: "center" }}>
              <Symbol name={icon} size={13} color={colors.title} style={{ width: 28, height: 28 }} />
            </View>
          ) : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 13, fontWeight: "500", color: colors.title }}>{title}</Text>
            <Text numberOfLines={2} style={{ fontSize: 12, color: colors.rowSubtitle }}>{subtitle}</Text>
          </View>
          <CheckMark on={value} />
        </View>
      </Pressable>
    </View>
  );
}
