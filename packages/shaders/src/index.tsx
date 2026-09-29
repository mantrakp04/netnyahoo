import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import type { ViewProps } from "react-native";

export const DIA_SPECTRUM = ["#0358F7", "#5092C7", "#E1E1FE", "#FFD400", "#FA3D1D", "#FD02F5"];

export type Rect = { x: number; y: number; width: number; height: number };

export type AreaLightPalette = "blue" | "red" | "pink" | "orange" | "yellow" | "green" | "purple";

export type AreaLightProps = ViewProps & {
  source: Rect | null;
  cornerRadius?: number;
  palette?: AreaLightPalette | string[];
  lift?: number;
  intensity?: number;
  falloff?: number;
  tilt?: [number, number];
  noiseSeed?: number;
  introDelay?: number;
  introDuration?: number;
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
  colors: [string, string];
  vibrancy?: boolean;
  tintColor?: string;
  tintAlpha?: number;
  tintLightness?: number;
  angle?: number;
  grainOpacity?: number;
  grainScale?: number;
};

const NativeBackdrop = requireNativeViewManager<WindowBackdropProps>("NetnyahooWindowBackdrop");

export function WindowBackdrop({ angle = 180, grainOpacity = 0.09, grainScale = 1, ...props }: WindowBackdropProps) {
  return <NativeBackdrop pointerEvents="none" angle={angle} grainOpacity={grainOpacity} grainScale={grainScale} {...props} />;
}

export type EdgeLightProps = ViewProps & {
  rectFrame: Rect;
  cornerRadius?: number;
  lightStart: { x: number; y: number };
  lightEnd: { x: number; y: number };
  lightColor?: string;
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
  speed?: number;
  origin?: number;
  cornerRadius?: number;
  halo?: Rect | null;
};

type NativePowerUpProps = Omit<PowerUpProps, "palette" | "halo"> & { palette?: string[]; haloFrame: number[] };

const NativePowerUp = requireNativeViewManager<NativePowerUpProps>("NetnyahooPowerUp");

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

export const shaderDebug = () => requireNativeModule<AreaLightDebugModule>("NetnyahooAreaLight");
