import { DIA_SPECTRUM, PowerUp } from "@netnyahoo/shaders";
import { playIntroMusic, setIntroMusicMuted, stopIntroMusic, Symbol, type IntroMusicCues } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useHover } from "../primitives";
import { introMusicMuted, saveIntroMusicMuted } from "./state";
import { SecondaryButton, useOnboardingColors } from "./ui";

const WORDMARK = "Netnyahoo";
const ICON = require("../../../assets/app-icon.png");

/**
 * The beats of the title sequence, in seconds. The animation runs on these fixed times (not
 * chained on the icon's spring settling) so the music, synthesized to the same cues, lands with it.
 */
const LETTER = 0.52;
const TAGLINE = 0.6;
const EXIT = 0.65;
const CUES: IntroMusicCues = (() => {
  const icon = 0.25;
  const letters = 1.15;
  const letterStep = 0.055;
  const letterCount = WORDMARK.length;
  const tagline = letters + (letterCount - 1) * letterStep + LETTER + 0.15;
  const exit = tagline + TAGLINE + 1.1;
  return { icon, letters, letterStep, letterCount, tagline, exit, end: exit + EXIT };
})();

const ms = (s: number) => Math.round(s * 1000);

/**
 * The opening title sequence (Dia's OnboardingIntro2): the icon settles in, the wordmark writes
 * itself letter by letter over a rising spectrum wash, the tagline follows, then the stage opens
 * from the centre into the first step. Our own music plays under it (mutable, remembered);
 * skippable throughout.
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const colors = useOnboardingColors();
  const dark = useTheme().dark;
  const icon = useRef(new Animated.Value(0)).current;
  const letters = useRef([...WORDMARK].map(() => new Animated.Value(0))).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const done = useRef(false);
  const [muted, setMuted] = useState(introMusicMuted);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    const at = (s: number) => ({ delay: ms(s), useNativeDriver: false });
    const sequence = Animated.parallel([
      Animated.spring(icon, { toValue: 1, friction: 7, tension: 50, ...at(CUES.icon) }),
      ...letters.map((l, i) =>
        Animated.timing(l, { toValue: 1, duration: ms(LETTER), easing: ease, ...at(CUES.letters + i * CUES.letterStep) }),
      ),
      Animated.timing(tagline, { toValue: 1, duration: ms(TAGLINE), easing: ease, ...at(CUES.tagline) }),
      Animated.timing(exit, { toValue: 1, duration: ms(EXIT), easing: Easing.inOut(Easing.cubic), ...at(CUES.exit) }),
    ]);
    playIntroMusic(CUES, introMusicMuted());
    // Its last chord rings on into the first step, then the music stops by itself.
    sequence.start(({ finished }) => finished && finish());
    return () => sequence.stop();
  }, []);

  const skip = () => {
    stopIntroMusic(0.35);
    Animated.timing(exit, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: false }).start(finish);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setIntroMusicMuted(next);
    saveIntroMusicMuted(next);
  };

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          opacity: exit.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] }),
        },
      ]}
    >
      <PowerUp palette={DIA_SPECTRUM} speed={0.8} origin={0.5} style={[StyleSheet.absoluteFill, { opacity: dark ? 0.9 : 0.6 }]} />
      <Animated.View
        style={{
          alignItems: "center",
          gap: 18,
          transform: [{ scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
        }}
      >
        <Animated.View
          style={{
            opacity: icon.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
            transform: [{ scale: icon.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          }}
        >
          <Image source={ICON} style={{ width: 96, height: 96 }} />
        </Animated.View>
        <View style={{ flexDirection: "row" }} accessibilityLabel={WORDMARK}>
          {[...WORDMARK].map((ch, i) => (
            <Animated.Text
              key={i}
              style={{
                fontSize: 64,
                fontWeight: "200",
                letterSpacing: -1.5,
                color: colors.title,
                opacity: letters[i],
                transform: [{ translateY: letters[i]!.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
              }}
            >
              {ch}
            </Animated.Text>
          ))}
        </View>
        <Animated.View style={{ opacity: tagline, transform: [{ translateY: tagline.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }}>
          <Text style={{ fontSize: 17, fontWeight: "300", color: colors.subtitle }}>Your new home on the internet</Text>
        </Animated.View>
      </Animated.View>
      <View style={{ position: "absolute", left: 28, bottom: 28 }}>
        <MuteButton muted={muted} onPress={toggleMute} />
      </View>
      <View style={{ position: "absolute", right: 28, bottom: 28 }} accessibilityHint="Button that skips the onboarding intro animation">
        <SecondaryButton title="Skip" onPress={skip} />
      </View>
    </Animated.View>
  );
}

/** Dia's intro mute toggle (bottom left, as tall as Skip): speaker.wave.3.fill / speaker.slash.fill. */
function MuteButton({ muted, onPress }: { muted: boolean; onPress: () => void }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  const label = muted ? "Unmute intro music" : "Mute intro music";
  return (
    <View {...hoverProps} tooltip={label}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
        {({ pressed }) => (
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: hovered ? colors.outlinedHover : "transparent",
              borderWidth: 1,
              borderColor: colors.noThanksBorder,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            }}
          >
            <Symbol
              name={muted ? "speaker.slash.fill" : "speaker.wave.3.fill"}
              size={13}
              weight="medium"
              color={colors.noThanksText}
              style={{ width: 20, height: 20 }}
            />
          </View>
        )}
      </Pressable>
    </View>
  );
}
