import { GlassEffect, isLiquidGlass } from "@netnyahoo/shell";
import { memo } from "react";
import { useTheme, type Theme } from "../lib/theme";

export const liquidGlass = isLiquidGlass();

const PROFILE_SHARE = 0.15;

export function glassTint(theme: Theme, fill: string, raised = false, dark = theme.dark): string {
  const [r, g, b, a] = rgba(fill);
  const [pr, pg, pb] = rgba(theme.backdrop.tintColor);
  const lightening = r + g + b > 3 * 127;
  const alpha = a * (!lightening ? 1 : dark ? (raised ? 0.9 : 0.6) : raised ? 0.8 : 0.55);
  const mix = (c: number, p: number) => c + (p - c) * PROFILE_SHARE;
  return toHex([mix(r, pr), mix(g, pg), mix(b, pb), alpha * 255]);
}

export const GlassFill = memo(function GlassFill({
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
});

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
