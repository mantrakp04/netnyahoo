import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import type { ViewProps } from "react-native";

/** Dia's brand spectrum (asset catalog ProgressBarColor2–7). */
export const DIA_SPECTRUM = ["#0358F7", "#5092C7", "#E1E1FE", "#FFD400", "#FA3D1D", "#FD02F5"];

export type Rect = { x: number; y: number; width: number; height: number };

export type AreaLightPalette = "blue" | "red" | "pink" | "orange" | "yellow" | "green" | "purple";

export type AreaLightProps = ViewProps & {
  /** The emitter in this view's coordinates (Dia uses the command-bar panel inset by 8). */
  source: Rect | null;
  cornerRadius?: number;
  /** One of Dia's seven fixed palettes (picked by theme hue), or explicit hex stops. */
  palette?: AreaLightPalette | string[];
  /** Resting height of the emitter above the page, in points. */
  lift?: number;
  intensity?: number;
  /** 2 = physical inverse-square; Dia's New Tab uses 1 (a broad, soft glow). */
  falloff?: number;
  /** Emitter tilt in degrees about [x, y]. */
  tilt?: [number, number];
  noiseSeed?: number;
  introDelay?: number;
  introDuration?: number;
  /** Change to replay the intro. */
  replayKey?: number;
};

type NativeAreaLightProps = Omit<AreaLightProps, "source" | "palette"> & { shapeFrame: number[]; palette?: string[] };

const NativeAreaLight = requireNativeViewManager<NativeAreaLightProps>("NetnyahooAreaLight");

export function AreaLight({ source, palette = "pink", ...props }: AreaLightProps) {
  const shapeFrame = source ? [source.x, source.y, source.width, source.height] : [0, 0, 0, 0];
  return (
    <NativeAreaLight
      pointerEvents="none"
      {...props}
      palette={typeof palette === "string" ? [palette] : palette}
      shapeFrame={shapeFrame}
    />
  );
}

export type WindowBackdropProps = ViewProps & {
  /** Gradient stops as hex; interpolated in OKLab. */
  colors: [string, string];
  /** Stops while the window is inactive (neither it nor a parent window is key or main). */
  inactiveColors?: [string, string];
  /** CSS-style gradient angle in degrees (180 = top→bottom). */
  angle?: number;
  grainOpacity?: number;
  grainScale?: number;
};

const NativeBackdrop = requireNativeViewManager<WindowBackdropProps>("NetnyahooWindowBackdrop");

export function WindowBackdrop({ angle = 180, grainOpacity = 0.09, grainScale = 1, ...props }: WindowBackdropProps) {
  return <NativeBackdrop pointerEvents="none" angle={angle} grainOpacity={grainOpacity} grainScale={grainScale} {...props} />;
}

/** Dia 1.50's New Tab paintings, one per profile colour family (plus a dark version of each). */
export type LogoPaint = AreaLightPalette | "neutral";

export type OrbProps = ViewProps & {
  /** Theme accent (hex); unused by the glass shading for now. */
  tint?: string;
  /** "glass" = Dia 1.49's glass orb; "painted" = Dia 1.50's hand-painted mark. */
  variant?: "glass" | "painted";
  /** Which painting the painted mark uses; its dark version follows the view's appearance. */
  paint?: LogoPaint;
};

const NativeOrb = requireNativeViewManager<OrbProps>("NetnyahooOrb");

/** Dia's logo shown above the New Tab command bar. */
export function Orb(props: OrbProps) {
  return <NativeOrb pointerEvents="none" {...props} />;
}

export type EdgeLightProps = ViewProps & {
  /** The rect whose border lights up, in this view's coordinates. */
  rectFrame: Rect;
  cornerRadius?: number;
  lightStart: { x: number; y: number };
  lightEnd: { x: number; y: number };
  /** #RRGGBBAA; alpha scales the overall strength. */
  lightColor?: string;
  /** Logo that gets a back-lit rim (optional). */
  logoFrame?: Rect | null;
  animationDuration?: number;
  animationDelay?: number;
};

type NativeEdgeLightProps = ViewProps & {
  rectFrame: number[];
  cornerRadius?: number;
  lightStart: number[];
  lightEnd: number[];
  lightColor?: string;
  logoFrame?: number[];
  animationDuration?: number;
  animationDelay?: number;
};

const NativeEdgeLight = requireNativeViewManager<NativeEdgeLightProps>("NetnyahooEdgeLight");
const rect = (r: Rect) => [r.x, r.y, r.width, r.height];

/** Dia's New Tab "wrap": a light sweeping up from below that traces the bar's border. */
export function EdgeLight({ rectFrame, lightStart, lightEnd, logoFrame, ...props }: EdgeLightProps) {
  return (
    <NativeEdgeLight
      pointerEvents="none"
      {...props}
      rectFrame={rect(rectFrame)}
      lightStart={[lightStart.x, lightStart.y]}
      lightEnd={[lightEnd.x, lightEnd.y]}
      logoFrame={logoFrame ? rect(logoFrame) : [0, 0, 0, 0]}
    />
  );
}

export type PowerUpProps = ViewProps & {
  palette?: AreaLightPalette | string[];
  /** Dia's New Tab: 1.25 with the area light on, 1 without; 1.5 for skill chips. Also the halo's. */
  speed?: number;
  /** Horizontal start of the band's centre (0–1), sliding to 0.5. */
  origin?: number;
  /** The command bar's corner radius; the halo traces the bar at +2. */
  cornerRadius?: number;
  /** The rect the halo wraps (the command bar), in this view's coordinates; null = no halo. */
  halo?: Rect | null;
};

type NativePowerUpProps = Omit<PowerUpProps, "palette" | "halo"> & { palette?: string[]; haloFrame: number[] };

const NativePowerUp = requireNativeViewManager<NativePowerUpProps>("NetnyahooPowerUp");

/**
 * Dia's CommandBarPowerUpView: a faint palette wash rising from the bottom of the page and,
 * with `halo`, a light that runs around the command bar's outline.
 */
export function PowerUp({ palette = "pink", halo = null, ...props }: PowerUpProps) {
  return (
    <NativePowerUp
      pointerEvents="none"
      {...props}
      palette={typeof palette === "string" ? [palette] : palette}
      haloFrame={halo ? rect(halo) : [0, 0, 0, 0]}
    />
  );
}

type AreaLightDebugModule = {
  debugState(): Record<string, unknown>;
  debugSetWindowActive(active: boolean | null): Promise<void>;
  debugSetReduceMotion(reduce: boolean | null): Promise<void>;
  debugSnapshot(dir: string): Promise<Array<{ file: string; class: string; ok: boolean; window: number; frame: number[]; key: boolean; main: boolean; hidden: boolean; alpha: number }>>;
};

/**
 * DEV tooling for the shader views: force windows to read as key/active or not, force Reduce
 * Motion for views mounted afterwards, and render every shader view offscreen to PNGs (window
 * snapshots can't read Metal layers).
 */
export const shaderDebug = () => requireNativeModule<AreaLightDebugModule>("NetnyahooAreaLight");
