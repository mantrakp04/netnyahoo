import { AreaLight, EdgeLight, Orb, PowerUp } from "@netnyahoo/shaders";
import { useEffect, useRef, useState } from "react";
import { Surface, VisualEffect } from "@netnyahoo/shell";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { hex, useTheme } from "../lib/theme";
import { NewTabExtras } from "./ntp";
import { Omnibox } from "./Omnibox";

const BAR_HEIGHT = 110;
/** Dia's logo box (the circle's diameter), measured: its centre sits 49.5pt above the bar. */
const LOGO_SIZE = 68.5;
const LOGO_CENTER_ABOVE_BAR = 49.5;
/** OrbView draws the logo inset by this much so its antialiased edge isn't clipped. */
const ORB_PAD = 2;
const SHOW_ORB = true;
/**
 * NewTabAreaLightView.negateAngle (= showDiaIcon, true with the logo shown): flips and halves the
 * tilt. It would also halve the intensity, but Dia computes intensity before the flag is set.
 * Dia 1.50 rolls out its rebrand (`ntp-rebrand-enabled`, which forces showDiaIcon on): the mark is
 * painted, the bar gets a shadow and the power-up band takes one theme colour.
 */
const NEGATE_ANGLE = true;

type Frame = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
let lastSize: Size | null = null;
const frameStyle = (f: Frame) => ({ left: f.x, top: f.y, width: f.width, height: f.height });

function logoFrame(viewWidth: number, barTop: number): Frame {
  const r = LOGO_SIZE / 2;
  return { x: viewWidth / 2 - r, y: barTop - LOGO_CENTER_ABOVE_BAR - r, width: LOGO_SIZE, height: LOGO_SIZE };
}

const outset = (f: Frame, d: number): Frame => ({ x: f.x - d, y: f.y - d, width: f.width + 2 * d, height: f.height + 2 * d });

/**
 * EdgeLightView: sits above the bar in a container covering (panel ∪ icon) outset
 * by 10pt (at least 480 tall). The light rises from 300pt below the bar to its
 * top edge over 1s (easeOutExpo), tracing the border; the logo gets a rim light.
 */
function EdgeLightLayer({ bar, orb, color, scale }: { bar: Frame; orb: Frame | null; color: string; scale: Animated.AnimatedInterpolation<number> | Animated.Value }) {
  const minX = Math.min(bar.x, orb?.x ?? bar.x) - 10;
  const minY = Math.min(bar.y, orb?.y ?? bar.y) - 10;
  const maxX = Math.max(bar.x + bar.width, orb ? orb.x + orb.width : 0) + 10;
  const maxY = Math.max(bar.y + bar.height, orb ? orb.y + orb.height : 0) + 10;
  const container = { x: minX, y: minY, width: maxX - minX, height: Math.max(maxY - minY, 480) };
  const local = (f: Frame) => ({ x: f.x - container.x, y: f.y - container.y, width: f.width, height: f.height });
  const rect = local(bar);
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", ...frameStyle(container), transform: [{ scale }] }}>
      <EdgeLight
        style={StyleSheet.absoluteFill}
        rectFrame={rect}
        cornerRadius={20}
        lightStart={{ x: rect.x + rect.width / 2, y: rect.y + rect.height + 300 }}
        lightEnd={{ x: rect.x + rect.width / 2, y: rect.y }}
        lightColor={color}
        // Dia passes iconFrame + 5pt; that's where its logo is actually drawn, which is this box.
        logoFrame={orb ? local(orb) : null}
        animationDuration={1}
      />
    </Animated.View>
  );
}

/** Command-bar width, from Dia's NewTabPageViewController. */
function barWidth(viewWidth: number) {
  const content = viewWidth < 708 ? (viewWidth <= 636 ? viewWidth - 20 : 616) : viewWidth < 1700 ? 652 : 774;
  return Math.min(content, viewWidth - 28);
}

/**
 * Dia's New Tab page: the command bar floats over the translucent card and
 * doubles as an area light, so the page underneath picks up a soft glow that
 * rises in, then slowly breathes.
 */
export function NewTabPage({ tabId }: { tabId: string }) {
  const theme = useTheme();
  // Every New Tab page is card-sized, so reuse the last measurement: waiting for onLayout would
  // flash an empty page for a frame before the bar appears (Dia shows it on the first frame).
  const [size, setSizeState] = useState<Size | null>(lastSize);
  const setSize = (next: Size) => {
    lastSize = next;
    setSizeState((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
  };
  const [panelHeight, setPanelHeight] = useState(BAR_HEIGHT);
  const elevation = useElevationSpring();

  if (!size) return <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)} />;

  const width = barWidth(size.width);
  const x = Math.max(size.width / 2 - width / 2, 14);
  const top = Math.max(size.height / 2 - 158, 100) + 38;

  // NewTabAreaLightView: the emitter is the panel inset by 8; taller panels sit lower and flatter.
  const r = (panelHeight - 112) / 240;
  const lift = r < 1 ? 10 - 4 * Math.max(r, 0) : 6;
  // Same convention as Dia's shader (verified line by line against the binary).
  const tilt = (r < 1 ? 5 - 4 * Math.max(r, 0) : 1) * (NEGATE_ANGLE ? -0.5 : 1);
  const source = { x: x + 8, y: top + 8, width: width - 16, height: panelHeight - 16 };
  const lightHeight = Math.max(0.85 * size.height, 720);

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      {/* CommandBarPowerUpView: full-page band rising from the bottom, behind everything.
          Dia's neutral theme (and incognito) has no light. */}
      {theme.powerUpColor && <PowerUp style={StyleSheet.absoluteFill} palette={[theme.powerUpColor]} speed={1.25} origin={0.5} />}
      {theme.lightPalette && (
        <AreaLight
          style={{ position: "absolute", left: 0, top: 0, width: size.width, height: lightHeight }}
          source={source}
          cornerRadius={22}
          palette={theme.lightPalette}
          lift={lift}
          tilt={[tilt, 0]}
          falloff={1}
          // Dia computes intensity before negateAngle is set, so it keeps the un-halved value.
          intensity={theme.lightIntensity}
        />
      )}
      {SHOW_ORB && (
        <Orb
          variant="painted"
          paint={theme.logoPaint}
          tint={theme.orbTint}
          style={{ position: "absolute", ...frameStyle(outset(logoFrame(size.width, top), ORB_PAD)) }}
        />
      )}
      <Animated.View
        onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
        style={{ position: "absolute", left: x, top, width, transform: [{ scale: elevation }] }}
      >
        {/* AssistantPanelRootView: a .hudWindow material (blended within the window) under the
            TransparentBackground fill, radius 20, 1 device-pixel border. The rebrand (1.50) adds two
            shadows: black 0.08 r2 (0, 0.5) and black 0.04 r1 (0, 2). */}
        <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={20} shadowColor="#000000" shadowOpacity={0.08} shadowRadius={2} shadowOffset={[0, 0.5]} />
        <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={20} shadowColor="#000000" shadowOpacity={0.04} shadowRadius={1} shadowOffset={[0, 2]} />
        <VisualEffect style={StyleSheet.absoluteFill} material="hudWindow" blendingMode="withinWindow" cornerRadius={20} />
        <Surface
          fill={hex(theme.ntpBar)}
          cornerRadius={20}
          borderColor={hex(theme.ntpBarBorder)}
          borderWidth={0.5}
        >
          <Omnibox variant="hero" tabId={tabId} />
        </Surface>
      </Animated.View>
      <EdgeLightLayer bar={{ x, y: top, width, height: panelHeight }} orb={SHOW_ORB ? logoFrame(size.width, top) : null} color={theme.edgeLight} scale={elevation} />
      {/* Postcard slot (components/ntp): release notes, check-in, Personalize. */}
      <NewTabExtras size={size} bar={{ x, y: top, width, height: panelHeight }} />
    </View>
  );
}

/**
 * Entrance: a CASpringAnimation on the bar (and edge light) from scale 0.99 to 1,
 * starting 0.25s after appear (response 0.7, bounce 0.3). Skipped under Reduce Motion.
 */
function useElevationSpring() {
  const value = useRef(new Animated.Value(0.99)).current;
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) return value.setValue(1);
      const response = 0.7;
      const dampingRatio = 1 - 0.3;
      const stiffness = (2 * Math.PI / response) ** 2;
      Animated.sequence([
        Animated.delay(250),
        Animated.spring(value, {
          toValue: 1,
          stiffness,
          damping: 2 * dampingRatio * Math.sqrt(stiffness),
          mass: 1,
          useNativeDriver: false,
        }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return value;
}
