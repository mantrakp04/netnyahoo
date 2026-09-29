import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { setSharing, useTelemetry } from "../../telemetry/client";
import { SHARING_COPY } from "../../telemetry/copy";
import { StepLayout } from "./steps";
import { useOnboarding } from "./state";
import { CheckRow, PrimaryButton, Reveal, StepTitle, useOnboardingColors } from "./ui";

/**
 * Onboarding's telemetry step: one checkbox, off unless the user ticks it (or already shared on
 * this Mac). The preview is an itemised receipt of what would go, and what never does.
 */
export function PrivacyStep() {
  const next = useOnboarding((s) => s.next);
  const [share, setShare] = useState(() => useTelemetry.getState().sharing);
  const colors = useOnboardingColors();
  const done = () => {
    setSharing(share, "onboarding");
    next();
  };
  return (
    <StepLayout actions={<PrimaryButton title="Continue" onPress={done} />} preview={<Receipt on={share} />}>
      <Reveal delay={60}>
        <StepTitle title={SHARING_COPY.onboarding.title} subtitle={SHARING_COPY.onboarding.subtitle} />
      </Reveal>
      <Reveal delay={140} style={{ gap: 12 }}>
        <CheckRow icon="stethoscope" title={SHARING_COPY.toggle} subtitle={SHARING_COPY.onboarding.row} value={share} onChange={setShare} />
        <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.footnote }}>{SHARING_COPY.footnote}</Text>
      </Reveal>
    </StepLayout>
  );
}

const SENT = ["Crash reports", "Error types", "Feature counts", "Speed and memory"];
const NEVER = ["Sites you visit", "What you type", "Your tabs", "Your name"];
const MONO = "Menlo";

function Receipt({ on }: { on: boolean }) {
  const colors = useOnboardingColors();
  const line = (label: string, mark: string, dim: boolean) => (
    <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 6, opacity: dim ? 0.35 : 1 }}>
      <Text style={{ fontFamily: MONO, fontSize: 11, color: colors.title }}>{label}</Text>
      {/* Dot leaders as text: a dotted border on a 1pt line draws solid in some rows. */}
      <Text numberOfLines={1} ellipsizeMode="clip" style={{ flex: 1, fontFamily: MONO, fontSize: 11, color: colors.steps }}>
        {".".repeat(40)}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 11, color: colors.title }}>{mark}</Text>
    </View>
  );
  const rule = <View style={{ height: 1, borderBottomWidth: 1, borderStyle: "dashed", borderColor: colors.rowBorder, marginVertical: 10 }} />;
  return (
    <View
      style={{
        width: 250,
        paddingHorizontal: 18,
        paddingVertical: 16,
        borderRadius: 4,
        backgroundColor: colors.card,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.rowBorder,
        transform: [{ rotate: "2deg" }],
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: "700", letterSpacing: 1, textAlign: "center", color: colors.title }}>
        NETNYAHOO
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.6, textAlign: "center", marginTop: 3, color: colors.subtitle }}>
        ITEMIZED. UNLIKE SOME EXPENSES.
      </Text>
      {rule}
      <View style={{ gap: 6 }}>{SENT.map((label) => line(label, on ? "SENT" : "—", !on))}</View>
      {rule}
      <View style={{ gap: 6 }}>{NEVER.map((label) => line(label, "NEVER", false))}</View>
      {rule}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: "700", color: colors.title }}>PERSONAL DATA</Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: "700", color: colors.title }}>0.00</Text>
      </View>
      {/* Stamp: whether this Mac shares. */}
      <View
        style={{
          alignSelf: "center",
          marginTop: 14,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderWidth: 1.5,
          borderRadius: 3,
          borderColor: on ? "#2F9E5B" : colors.steps,
          transform: [{ rotate: "-6deg" }],
        }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: "700", letterSpacing: 1, color: on ? "#2F9E5B" : colors.steps }}>
          {on ? "THANK YOU" : "NOT SHARED"}
        </Text>
      </View>
    </View>
  );
}
