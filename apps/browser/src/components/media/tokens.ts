import { useTheme } from "../../lib/theme";

/**
 * AudioMiniPlayer colours, recovered from Dia's binary: the background is
 * white 0.956 (light) / white 0.15 (dark); the progress bar is black 10/35/60%
 * (track / fill / hover fill) in light mode and white 20/50/80% in dark mode.
 * Text uses labelColor / secondaryLabelColor.
 */
const light = {
  background: "#F4F4F4",
  backgroundRgb: [244, 244, 244] as [number, number, number],
  label: "rgba(0,0,0,0.85)",
  secondary: "rgba(0,0,0,0.5)",
  track: "rgba(0,0,0,0.1)",
  fill: "rgba(0,0,0,0.35)",
  hoverFill: "rgba(0,0,0,0.6)",
  artPlaceholder: "rgba(0,0,0,0.06)",
  border: "rgba(0,0,0,0.1)",
};

const dark: typeof light = {
  background: "#262626",
  backgroundRgb: [38, 38, 38],
  label: "rgba(255,255,255,0.85)",
  secondary: "rgba(255,255,255,0.55)",
  track: "rgba(255,255,255,0.2)",
  fill: "rgba(255,255,255,0.5)",
  hoverFill: "rgba(255,255,255,0.8)",
  artPlaceholder: "rgba(255,255,255,0.08)",
  border: "rgba(255,255,255,0.1)",
};

export type MediaTokens = typeof light;

export function useMediaTokens(): MediaTokens {
  return useTheme().dark ? dark : light;
}

/** Red of the recording indicators (the toolbar's capture button uses it too). */
export const CAPTURE_RED = "#FF453A";
