import { AreaLight, EdgeLight, Orb, PowerUp } from "@netnyahoo/shaders";
import { useEffect, useState } from "react";
import { Surface, VisualEffect } from "@netnyahoo/shell";
import { StyleSheet, View } from "react-native";
import { hex, useTheme } from "../lib/theme";
import { NewTabExtras } from "./ntp";
import { Omnibox } from "./Omnibox";

/**
 * Dia 1.50's rebrand (`ntp-rebrand-enabled`, rolled out remotely): the mark is painted, the bar
 * gets a shadow, and the page's light configuration turns off both the area light and the edge
 * light (NewTabPageController: rebrand without the daylight effect = no lights). The power-up
 * band then takes one theme colour at speed 1, a halo runs around the bar, and the bar is the
 * opaque AssistantPanel background instead of a translucent panel over the light.
 */
const REBRAND = true;
/** The bar's height before its first layout, so the halo is placed right from the first frame. */
const BAR_HEIGHT = 112;
/**
 * The logo's circle (its diameter) and how far its centre sits above the bar top. 1.49's glass orb
 * was measured from the screen: 68.5, 49.5. 1.50's painted mark, fitted to the 1.50.1 capture
 * with the orb's own outline (scratchpad r3/markfit.py): 76 (19/21 of Dia's 84pt icon view, the
 * shape layer's radius constant) and 48.6 (the icon view is centred 48 above the bar).
 */
const LOGO_SIZE = REBRAND ? 76 : 68.5;
const LOGO_CENTER_ABOVE_BAR = REBRAND ? 48.6 : 49.5;
/**
 * Measured on Dia 1.50.1 (rec150 intro, edges fitted to 0.5pt through the capture's resampling):
 * its bar, and the mark above it, sit 1pt right of and 1pt below where NewTabPageViewController's
 * formulas put them for our card size, as if its New Tab view were 2pt larger than the card's
 * content area. The bar is 112pt tall (the hero Omnibox's rows).
 */
const DIA_OFFSET = 1;
/** OrbView draws the logo inset by this much so its antialiased edge isn't clipped. */
const ORB_PAD = 2;
const SHOW_ORB = true;
/**
 * NewTabAreaLightView.negateAngle (= showDiaIcon, true with the logo shown): flips and halves the
 * tilt. It would also halve the intensity, but Dia computes intensity before the flag is set.
 */
const NEGATE_ANGLE = true;

type Frame = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
let lastSize: Size | null = null;
/** Tabs whose New Tab page already played the entrance; switching back to one doesn't replay it. */
const introPlayed = new Set<string>();
const frameStyle = (f: Frame) => ({ left: f.x, top: f.y, width: f.width, height: f.height });

function logoFrame(viewWidth: number, barTop: number): Frame {
  const r = LOGO_SIZE / 2;
  return { x: viewWidth / 2 + DIA_OFFSET - r, y: barTop - LOGO_CENTER_ABOVE_BAR - r, width: LOGO_SIZE, height: LOGO_SIZE };
}

const outset = (f: Frame, d: number): Frame => ({ x: f.x - d, y: f.y - d, width: f.width + 2 * d, height: f.height + 2 * d });

/**
 * EdgeLightView: sits above the bar in a container covering (panel ∪ icon) outset
 * by 10pt (at least 480 tall). The light rises from 300pt below the bar to its
 * top edge over 1s (easeOutExpo), tracing the border; the logo gets a rim light.
 */
function EdgeLightLayer({ bar, orb, color }: { bar: Frame; orb: Frame | null; color: string }) {
  const minX = Math.min(bar.x, orb?.x ?? bar.x) - 10;
  const minY = Math.min(bar.y, orb?.y ?? bar.y) - 10;
  const maxX = Math.max(bar.x + bar.width, orb ? orb.x + orb.width : 0) + 10;
  const maxY = Math.max(bar.y + bar.height, orb ? orb.y + orb.height : 0) + 10;
  const container = { x: minX, y: minY, width: maxX - minX, height: Math.max(maxY - minY, 480) };
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
        // Dia passes iconFrame + 5pt; that's where its logo is actually drawn, which is this box.
        logoFrame={orb ? local(orb) : null}
        animationDuration={1}
      />
    </View>
  );
}

/** Command-bar width, from Dia's NewTabPageViewController. */
function barWidth(viewWidth: number) {
  const content = viewWidth < 708 ? (viewWidth <= 636 ? viewWidth - 20 : 616) : viewWidth < 1700 ? 652 : 774;
  return Math.min(content, viewWidth - 28);
}

/**
 * Dia's New Tab page: the command bar floats over the translucent card. A power-up band rises
 * from the bottom as the page opens; with the rebrand a halo then wraps the bar, otherwise the
 * bar doubles as an area light (a soft glow that rises in, then slowly breathes) and an edge
 * light traces its border.
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
  // The band and halo fade out completely, so a page that has played them just leaves them out.
  const [playIntro] = useState(() => !introPlayed.has(tabId));
  useEffect(() => {
    introPlayed.add(tabId);
  }, [tabId]);

  if (!size) return <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)} />;

  const width = barWidth(size.width);
  const x = Math.max(size.width / 2 - width / 2, 14) + DIA_OFFSET;
  const top = Math.max(size.height / 2 - 158, 100) + 38 + DIA_OFFSET;

  // NewTabAreaLightView: the emitter is the panel inset by 8; taller panels sit lower and flatter.
  const r = (panelHeight - 112) / 240;
  const lift = r < 1 ? 10 - 4 * Math.max(r, 0) : 6;
  // Same convention as Dia's shader (verified line by line against the binary).
  const tilt = (r < 1 ? 5 - 4 * Math.max(r, 0) : 1) * (NEGATE_ANGLE ? -0.5 : 1);
  const source = { x: x + 8, y: top + 8, width: width - 16, height: panelHeight - 16 };
  const lightHeight = Math.max(0.85 * size.height, 720);
  const bar = { x, y: top, width, height: panelHeight };
  // NewTabPageViewController's light configuration; the daylight effect (and with it the bar's
  // elevation spring) is off, so the bar sits at its resting elevation (scale 1) from the start.
  const lightPalette = REBRAND ? null : theme.lightPalette;
  const areaLight = lightPalette !== null;
  const edgeLight = !REBRAND;

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      {/* CommandBarPowerUpView: full-page band rising from the bottom, behind everything, and the
          halo (shown while the area light is off). Incognito has neither. */}
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
      <View onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)} style={{ position: "absolute", left: x, top, width }}>
        {/* AssistantPanelRootView, radius 20, 1 device-pixel border. Over the area light: a .hudWindow
            material (blended within the window) under the TransparentBackground fill, so the light
            shows through; without it, the opaque Background. The rebrand adds two shadows: black
            0.08 r2 (0, 0.5) and black 0.04 r1 (0, 2). */}
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
      {edgeLight && <EdgeLightLayer bar={bar} orb={SHOW_ORB ? logoFrame(size.width, top) : null} color={theme.edgeLight} />}
      {/* Postcard slot (components/ntp): release notes, check-in, Personalize. */}
      <NewTabExtras size={size} bar={bar} />
    </View>
  );
}
