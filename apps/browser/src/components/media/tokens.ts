import { useTheme } from "../../lib/theme";

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

export const CAPTURE_RED = "#FF453A";
