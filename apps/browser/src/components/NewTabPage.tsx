import { AreaLight, EdgeLight, PowerUp } from "@arcadia/shaders";
import { useEffect, useState } from "react";
import { Surface, VisualEffect } from "@arcadia/shell";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { hex, layout, useTheme } from "../lib/theme";
import { springParams } from "./layout/swipeMotion";
import { NewTabExtras } from "./ntp";
import { Omnibox } from "./Omnibox";

const REBRAND = true;
const BAR_HEIGHT = 112;
// The painted hills in each profile colour, as Dia paints its mark per colour; green is the brand painting.
const MARKS = {
  green: require("../../assets/ntp-mark.png"),
  plum: require("../../assets/ntp-mark-plum.png"),
  blue: require("../../assets/ntp-mark-blue.png"),
  purple: require("../../assets/ntp-mark-purple.png"),
  pink: require("../../assets/ntp-mark-pink.png"),
  red: require("../../assets/ntp-mark-red.png"),
  orange: require("../../assets/ntp-mark-orange.png"),
  yellow: require("../../assets/ntp-mark-yellow.png"),
  neutral: require("../../assets/ntp-mark-neutral.png"),
  incognito: require("../../assets/ntp-mark-neutral.png"),
};
const MARK_SIZE = 100;
const MARK_ABOVE_BAR = 84.1;
const MARK_HIDDEN = 86;
const MARK_SPRING = springParams(0.34, 0.7);
const MARK_DELAY_MS = 80;
const DIA_OFFSET = 1;
const NEGATE_ANGLE = true;

type Frame = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
let lastSize: Size | null = null;
const introPlayed = new Set<string>();
const frameStyle = (f: Frame) => ({ left: f.x, top: f.y, width: f.width, height: f.height });

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceMotion = on), () => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

function EdgeLightLayer({ bar, color }: { bar: Frame; color: string }) {
  const container = { x: bar.x - 10, y: bar.y - 10, width: bar.width + 20, height: Math.max(bar.height + 20, 480) };
  const local = (f: Frame) => ({ x: f.x - container.x, y: f.y - container.y, width: f.width, height: f.height });
  const rect = local(bar);
  return (
    <View pointerEvents="none" style={{ position: "absolute", ...frameStyle(container) }}>
      <EdgeLight
        style={StyleSheet.absoluteFill}
        rectFrame={rect}
        cornerRadius={20}
        lightStart={{ x: rect.x + rect.width / 2, y: rect.y + rect.height + 300 }}
        lightEnd={{ x: rect.x + rect.width / 2, y: rect.y }}
        lightColor={color}
        animationDuration={1}
      />
    </View>
  );
}

function barWidth(viewWidth: number) {
  const content = viewWidth < 708 ? (viewWidth <= 636 ? viewWidth - 20 : 616) : viewWidth < 1700 ? 652 : 774;
  return Math.min(content, viewWidth - 28);
}

export function NewTabPage({ tabId, toolbar = true }: { tabId: string; toolbar?: boolean }) {
  const theme = useTheme();
  const [size, setSizeState] = useState<Size | null>(lastSize);
  const setSize = (next: Size) => {
    lastSize = next;
    setSizeState((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
  };
  const [panelHeight, setPanelHeight] = useState(BAR_HEIGHT);
  const [playIntro] = useState(() => !introPlayed.has(tabId));
  const [rise] = useState(() => new Animated.Value(playIntro && !reduceMotion ? MARK_HIDDEN : 0));
  useEffect(() => {
    introPlayed.add(tabId);
  }, [tabId]);
  useEffect(() => {
    if (!playIntro || reduceMotion) return;
    const timer = setTimeout(() => Animated.spring(rise, { toValue: 0, ...MARK_SPRING, useNativeDriver: true }).start(), MARK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [playIntro, rise]);

  if (!size) return <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)} />;

  const width = barWidth(size.width);
  const x = Math.max(size.width / 2 - width / 2, 14) + DIA_OFFSET;
  // Dia's rule is from the page under the toolbar; without one (address bar in the sidebar) the bar keeps the same place in the card.
  const under = toolbar ? 0 : layout.toolbarHeight;
  const top = Math.max((size.height - under) / 2 - 158, 100) + 38 + DIA_OFFSET + under;

  const r = (panelHeight - 112) / 240;
  const lift = r < 1 ? 10 - 4 * Math.max(r, 0) : 6;
  const tilt = (r < 1 ? 5 - 4 * Math.max(r, 0) : 1) * (NEGATE_ANGLE ? -0.5 : 1);
  const source = { x: x + 8, y: top + 8, width: width - 16, height: panelHeight - 16 };
  const lightHeight = Math.max(0.85 * size.height, 720);
  const bar = { x, y: top, width, height: panelHeight };
  const lightPalette = REBRAND ? null : theme.lightPalette;
  const areaLight = lightPalette !== null;
  const edgeLight = !REBRAND;

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      {playIntro && theme.powerUpColor && (
        <PowerUp
          style={StyleSheet.absoluteFill}
          palette={[theme.powerUpColor]}
          speed={areaLight ? 1.25 : 1}
          origin={0.5}
          cornerRadius={20}
          halo={areaLight ? null : bar}
        />
      )}
      {lightPalette && (
        <AreaLight
          style={{ position: "absolute", left: 0, top: 0, width: size.width, height: lightHeight }}
          source={source}
          cornerRadius={22}
          palette={lightPalette}
          lift={lift}
          tilt={[tilt, 0]}
          falloff={1}
          intensity={theme.lightIntensity}
        />
      )}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: size.width / 2 + DIA_OFFSET - MARK_SIZE / 2,
          top: top - MARK_ABOVE_BAR,
          width: MARK_SIZE,
          height: MARK_ABOVE_BAR,
          overflow: "hidden",
        }}
      >
        <Animated.Image
          source={MARKS[theme.profileColor] ?? MARKS.green}
          style={{
            width: MARK_SIZE,
            height: MARK_SIZE,
            transform: [
              { translateY: rise },
              { translateY: MARK_SIZE / 2 },
              { rotate: rise.interpolate({ inputRange: [-4, 0, MARK_HIDDEN], outputRange: ["-3deg", "0deg", "0deg"], extrapolate: "clamp" }) },
              { translateY: -MARK_SIZE / 2 },
            ],
          }}
        />
      </View>
      <View onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)} style={{ position: "absolute", left: x, top, width }}>
        {REBRAND && (
          <>
            <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={20} shadowColor="#000000" shadowOpacity={0.08} shadowRadius={2} shadowOffset={[0, 0.5]} />
            <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={20} shadowColor="#000000" shadowOpacity={0.04} shadowRadius={1} shadowOffset={[0, 2]} />
          </>
        )}
        {areaLight && <VisualEffect style={StyleSheet.absoluteFill} material="hudWindow" blendingMode="withinWindow" cornerRadius={20} />}
        <Surface
          fill={hex(areaLight ? theme.ntpBar : theme.ntpBarSolid)}
          cornerRadius={20}
          borderColor={hex(theme.ntpBarBorder)}
          borderWidth={0.5}
        >
          <Omnibox variant="hero" tabId={tabId} />
        </Surface>
      </View>
      {edgeLight && <EdgeLightLayer bar={bar} color={theme.edgeLight} />}
      <NewTabExtras size={size} bar={bar} />
    </View>
  );
}
