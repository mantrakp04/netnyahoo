import { GlassEffect, isLiquidGlass } from "@netnyahoo/shell";
import { useTheme, type Theme } from "../lib/theme";

/**
 * macOS 26's Liquid Glass under the pinned tiles and the URL field (the sidebar's, or the toolbar's
 * pill): AppKit's NSGlassEffectView (shell GlassEffect), laid under their content. Before macOS 26
 * (and in builds without GlassEffect) they keep Dia's flat fills.
 */
export const liquidGlass = isLiquidGlass();

/** How much of the profile's colour the glass's tint takes, over the state's own. */
const PROFILE_SHARE = 0.15;

/**
 * The glass tint for a surface Dia fills with `fill` (a theme token: resting, hover, pressed,
 * selected): the token's colour, a little toward the profile's (the window tint's colour; incognito's
 * grey), at a strength that lands the glass near Dia's flat fill over the same backdrop. Glass
 * brightens under a white tint far more than a flat fill does (≈2× in light, ≈1.7× in dark), so
 * lightening tints are scaled down; darkening ones read as they are.
 */
export function glassTint(theme: Theme, fill: string, raised = false, dark = theme.dark): string {
  const [r, g, b, a] = rgba(fill);
  const [pr, pg, pb] = rgba(theme.backdrop.tintColor);
  const lightening = r + g + b > 3 * 127;
  // A selected tile is Dia's raised white bubble: its glass takes more of the white (0.8 in light).
  const alpha = a * (!lightening ? 1 : dark ? 0.6 : raised ? 0.8 : 0.55);
  const mix = (c: number, p: number) => c + (p - c) * PROFILE_SHARE;
  return toHex([mix(r, pr), mix(g, pg), mix(b, pb), alpha * 255]);
}

/**
 * Glass filling its parent, `radius` its corners (the tile's or field's own), tinted for `fill` (or
 * `tint` as it is). Put it first among the parent's children so their content draws over it; in a
 * parent with a border, `border` is its width, so the glass covers it too.
 */
export function GlassFill({
  fill,
  tint,
  radius,
  border = 0,
  raised,
  dark,
}: {
  fill: string;
  tint?: string;
  radius: number;
  border?: number;
  raised?: boolean;
  /** Dark or light glass when the surface under it isn't the theme's (a website colour's band). */
  dark?: boolean;
}) {
  const theme = useTheme();
  return (
    <GlassEffect
      pointerEvents="none"
      cornerRadius={radius}
      tint={tint ?? glassTint(theme, fill, raised, dark ?? theme.dark)}
      dark={dark ?? theme.dark}
      style={{ position: "absolute", top: -border, left: -border, right: -border, bottom: -border }}
    />
  );
}

/** "rgba(r,g,b,a)", "#RRGGBB" or "#RRGGBBAA" → [r, g, b, a (0…1)]. */
function rgba(color: string): [number, number, number, number] {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r = 0, g = 0, b = 0, a = 1] = m[1]!.split(",").map((v) => Number(v.trim()));
    return [r, g, b, a];
  }
  const h = color.replace("#", "");
  const ch = (i: number) => parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return [ch(0), ch(1), ch(2), h.length >= 8 ? ch(3) / 255 : 1];
}

const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
