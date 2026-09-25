import { useTheme } from "../../lib/theme";

/**
 * Status colours for live folders and Live Calendar (GitHub's Primer palette
 * for PR / CI states, so they read the same as on github.com), light / dark.
 */
const DARK = {
  success: "#3FB950",
  failure: "#F85149",
  pending: "#D29922",
  merged: "#A371F7",
  draft: "#8B949E",
  conflict: "#DB6D28",
  /** Unread pip / dots (Dia's unreadPipColor follows the accent). */
  pip: "#4C8DF6",
  now: "#E5534B",
  ciTrack: "rgba(255,255,255,0.1)",
  chip: "rgba(255,255,255,0.1)",
};

const LIGHT: typeof DARK = {
  success: "#1A7F37",
  failure: "#CF222E",
  pending: "#9A6700",
  merged: "#8250DF",
  draft: "#6E7781",
  conflict: "#BC4C00",
  pip: "#0969DA",
  now: "#D1242F",
  ciTrack: "rgba(0,0,0,0.08)",
  chip: "rgba(0,0,0,0.06)",
};

export type LiveColors = typeof DARK;

export function useLiveColors(): LiveColors {
  return useTheme().dark ? DARK : LIGHT;
}
