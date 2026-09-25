import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import type { Theme } from "../../lib/theme";

/** Colours for toolbar content; with a website colour they're picked for contrast against it. */
export type ToolbarPalette = {
  /** The band's fill (#RRGGBB), or null for the plain translucent card. */
  background: string | null;
  text: string;
  secondary: string;
  icon: string;
  iconDisabled: string;
  hover: string;
  pressed: string;
  pill: string;
  divider: string;
};

function channels(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})/i.exec(color.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance (0 black … 1 white). */
export function luminance(color: string): number {
  const c = channels(color);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const cache = new Map<string, ToolbarPalette>();

/**
 * Dia's "Extend website color into tab bar": the toolbar band takes the page's
 * theme / header colour, and its text and icons flip to whichever of black or
 * white reads better on it.
 */
export function toolbarPalette(theme: Theme, websiteColor: string | null): ToolbarPalette {
  const key = `${theme.dark}|${theme.textPrimary}|${websiteColor ?? ""}`;
  let palette = cache.get(key);
  if (palette) return palette;
  if (!websiteColor || !channels(websiteColor)) {
    palette = {
      background: null,
      text: theme.textPrimary,
      secondary: theme.textSecondary,
      icon: theme.icon,
      iconDisabled: theme.iconDisabled,
      hover: theme.toolbarHover,
      pressed: theme.toolbarPressed,
      pill: theme.urlPill,
      divider: theme.divider,
    };
  } else {
    // Contrast against white vs. black text: (L1 + .05) / (L2 + .05).
    const l = luminance(websiteColor);
    const light = (1.05 / (l + 0.05)) < ((l + 0.05) / 0.05);
    palette = light
      ? {
          background: websiteColor.slice(0, 7),
          text: "#000000E6",
          secondary: "#00000080",
          icon: "#000000C6",
          iconDisabled: "#00000040",
          hover: "rgba(0,0,0,0.07)",
          pressed: "rgba(0,0,0,0.12)",
          pill: "rgba(0,0,0,0.06)",
          divider: "rgba(0,0,0,0.1)",
        }
      : {
          background: websiteColor.slice(0, 7),
          text: "#FFFFFF",
          secondary: "#FFFFFF99",
          icon: "#FFFFFFD9",
          iconDisabled: "#FFFFFF4D",
          hover: "rgba(255,255,255,0.14)",
          pressed: "rgba(255,255,255,0.22)",
          pill: "rgba(255,255,255,0.1)",
          divider: "rgba(255,255,255,0.12)",
        };
  }
  cache.set(key, palette);
  return palette;
}

/**
 * A background colour that eases between values (sticky headers change it while
 * the page scrolls). Returns an animated colour, transparent when `color` is null.
 */
export function useEasedColor(color: string | null, duration = 180) {
  const progress = useRef(new Animated.Value(1)).current;
  const from = useRef<string>(color ?? "#00000000");
  const to = useRef<string>(color ?? "#00000000");
  // Fading out keeps the hue, so the band doesn't flash grey on the way.
  const target = color ? color.slice(0, 7) : `${to.current.slice(0, 7)}00`;
  if (target !== to.current) {
    // Start from wherever the last transition was heading.
    from.current = to.current;
    to.current = target;
  }
  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [target]);
  return progress.interpolate({ inputRange: [0, 1], outputRange: [from.current, to.current] });
}
