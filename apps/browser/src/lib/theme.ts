import type { AreaLightPalette, LogoPaint } from "@netnyahoo/shaders";
import { useContext } from "react";
import { useBrowser } from "../store/browser";
import { WindowContext } from "../store/hooks";
import type { ProfileColor } from "../store/types";
import { backdropTint, opaqueTint, tintForHue, type BackdropTint } from "./windowTint";

/**
 * Chrome colors, taken from Dia's asset-catalog tokens and pixel samples of the
 * real app (see docs/dia-spec.md). Colors go to native views as hex, so alpha
 * colors are written as #RRGGBBAA. The window tint and New Tab light come from
 * the window's profile colour (PROFILE_THEMES); incognito windows are always dark.
 */
export type Theme = typeof dark & ProfileTheme & {
  /** The window backdrop's tint over the desktop blur (lib/windowTint). */
  backdrop: BackdropTint;
  /**
   * The backdrop with the blur opaque (inactive window), top → bottom: the window colour for
   * surfaces that need a solid fill, and the backdrop where the blur isn't built in yet.
   */
  windowTint: [string, string];
  /** Dia 1.50's hand-painted New Tab mark: the painting for the profile colour. */
  logoPaint: LogoPaint;
  /** Dia 1.50 power-up band: one theme colour instead of the per-hue palette; null = none. */
  powerUpColor: string | null;
};

const dark = {
  dark: true,
  // Window grain (multiplied over the tint). 1.49 captures gave 0.06; Dia 1.50.1's capture is almost
  // grain-free once its gradient is removed (row-detrended noise 0.09 levels in the sidebar, 0.05 on
  // the page). Our capture path shows 0.74× what the backdrop renders, so 0.006 gives ≈0.10 / 0.045.
  grain: 0.006,
  // WindowContent/BaseTint is #121212 at 60% over the tint; Dia 1.50's rebrand overrides it to 50%
  // (fitted exactly from a 1.50.1 capture: page = tint·0.5 + 9 in every channel).
  card: "rgba(18,18,18,0.5)",
  cardEdge: "rgba(0,0,0,0.35)",
  divider: "rgba(255,255,255,0.08)",

  textPrimary: "#FFFFFF",
  textTab: "#FFFFFFC7", // TabTitleUnselected .78
  textSecondary: "#FFFFFF80",
  textTertiary: "#FFFFFF59",
  icon: "#F7F5FFC6", // DownloadsButton/ButtonTintColor .78
  iconDisabled: "#F7F5FF4D",

  tabHover: "rgba(255,255,255,0.16)",
  tabPressed: "rgba(255,255,255,0.31)",
  // Dia 1.50 (TabShapeView, rebrand): #121212 at 0.5; 1.49 was black ~0.4.
  tabSelected: "rgba(18,18,18,0.5)",
  tabSelectedText: "#FFFFFF",
  // TabShapeView: 1pt gradient border, TabSelectedShadow glow (radius 15 dark / 12.5 light).
  tabSelectedBorder: ["rgba(255,255,255,0.2)", "rgba(255,255,255,0.05)"] as [string, string],
  tabSelectedShadow: "rgba(255,255,255,0.15)",
  tabSelectedShadowRadius: 15,
  pinnedResting: "rgba(255,255,255,0.1)",
  pinnedRestingStroke: "rgba(255,255,255,0.06)",
  pinnedSelectedFill: "rgba(255,255,255,0.25)",
  pinnedSelectedRim: "rgba(0,0,0,0.85)",
  pinnedSelectedOutline: "rgba(255,255,255,0.2)",

  toolbarHover: "rgba(255,255,255,0.1)",
  toolbarPressed: "rgba(255,255,255,0.18)",
  urlPill: "rgba(255,255,255,0.07)",

  panel: "#2A2A2A",
  panelBorder: "rgba(255,255,255,0.1)",
  panelShadowOpacity: 0.5,
  rowSelected: "rgba(255,255,255,0.22)",
  rowHover: "rgba(255,255,255,0.07)",
  selection: "rgba(120,125,134,0.7)",
  placeholder: "#FFFFFF87", // Input/Placeholder .53
  chipBorder: "rgba(255,255,255,0.15)",
  chipText: "#FFFFFF99",
  goButton: "#DCCBD8",
  goButtonText: "#1A1418",
  sendIdle: "rgba(255,255,255,0.08)",

  // TransparentBackground (0.8) over a .hudWindow material: the area light shows through.
  ntpBar: "rgba(24,24,24,0.8)",
  // AssistantPanelUIBase Background: the opaque panel Dia 1.50 (rebrand) shows with the area light off.
  ntpBarSolid: "#2D2D2D",
  ntpBarBorder: "rgba(120,125,134,0.32)", // Border/None
  lightIntensity: 4,
  accent: "#4A77D4", // Input/Cursor/Search
};

const light: typeof dark = {
  dark: false,
  grain: 0.05,
  card: "rgba(255,255,255,0.7)", // rebrand override (1.49: 0.8); the pair to dark's 0.5, not yet seen in a light capture
  cardEdge: "rgba(0,0,0,0.08)",
  divider: "rgba(0,0,0,0.08)",

  textPrimary: "#000000",
  textTab: "#000000AD", // .68
  textSecondary: "#00000080",
  textTertiary: "#00000059",
  icon: "#000000C6",
  iconDisabled: "#0000004D",

  tabHover: "rgba(255,255,255,0.55)",
  tabPressed: "rgba(255,255,255,0.7)",
  tabSelected: "rgba(255,255,255,0.7)", // Dia 1.50 (rebrand); 1.49 was opaque white
  tabSelectedText: "#000000",
  tabSelectedBorder: ["rgba(255,255,255,0.98)", "rgba(0,0,0,0.06)"],
  tabSelectedShadow: "rgba(0,0,0,0.12)",
  tabSelectedShadowRadius: 12.5,
  pinnedResting: "rgba(0,0,0,0.05)",
  pinnedRestingStroke: "rgba(0,0,0,0.1)",
  pinnedSelectedFill: "rgba(255,255,255,0.7)",
  pinnedSelectedRim: "rgba(0,0,0,0.12)",
  pinnedSelectedOutline: "rgba(255,255,255,0.98)",

  toolbarHover: "rgba(0,0,0,0.06)",
  toolbarPressed: "rgba(0,0,0,0.1)",
  urlPill: "rgba(0,0,0,0.05)",

  panel: "#FFFFFF",
  panelBorder: "rgba(0,0,0,0.1)",
  panelShadowOpacity: 0.18,
  rowSelected: "rgba(15,24,44,0.08)",
  rowHover: "rgba(15,24,44,0.05)",
  selection: "rgba(120,125,134,0.4)",
  placeholder: "#00000066",
  chipBorder: "rgba(0,0,0,0.12)",
  chipText: "#00000099",
  goButton: "#0F182C",
  goButtonText: "#FFFFFF",
  sendIdle: "rgba(0,0,0,0.06)",

  ntpBar: "rgba(255,255,255,0.85)",
  ntpBarSolid: "#FEFFFF",
  ntpBarBorder: "rgba(0,0,0,0.07)",
  lightIntensity: 0.5,
  accent: "#6395FC",
};

/** "rgba(r,g,b,a)" or "#RRGGBB[AA]" → "#RRGGBBAA", for native views. */
export function hex(color: string): string {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return color;
  const [r, g, b, a = "1"] = m[1]!.split(",").map((v) => v.trim());
  const h = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0").toUpperCase();
  return `#${h(+r!)}${h(+g!)}${h(+b!)}${h(+a * 255)}`;
}

type ProfileTheme = {
  /** Area light / power-up palette; null = no light (Dia's neutral theme). */
  lightPalette: AreaLightPalette | null;
  orbTint: string;
  /** Edge-light sweep: theme colour at 0.5 (dark) / 0.4 (light), per NewTabPageViewController. */
  edgeLight: string;
};

type ProfileColorSpec = {
  name: string;
  swatch: string;
  palette: AreaLightPalette | null;
  /** Dia 1.50's power-up band/halo colour (the palette's primary colour), where measured; else the swatch. */
  powerUp?: string;
  /** The window backdrop's tint colour (`BackgroundTintInfo.color`), where measured; else from the swatch's hue. */
  tint?: string;
  dark?: ProfileTheme;
  light?: ProfileTheme;
};

/**
 * Profile theme colours. Plum is measured from Dia (the user's theme, Dia's pink); the others
 * take their window tint from the swatch's hue and their light from the area-light palette.
 */
export const PROFILE_COLORS: Record<ProfileColor, ProfileColorSpec> = {
  plum: {
    name: "Plum",
    swatch: "#C07A98",
    // Measured from Dia 1.50.1's New Tab band and halo (dark).
    powerUp: "#B5556B",
    // Display P3, fitted from an inactive Dia 1.50.1 window (dark) through the window-treatment model
    // (dia-spec › Window translucency); ≈ sRGB #BF556A, next to the band colour above.
    tint: "#B25B6B",
    palette: "pink",
    dark: { lightPalette: "pink", orbTint: "#E9A9C4", edgeLight: "#EBB3CB80" },
    light: { lightPalette: "pink", orbTint: "#E59CC0", edgeLight: "#D37B8B66" },
  },
  blue: { name: "Blue", swatch: "#4691C3", palette: "blue" },
  purple: { name: "Purple", swatch: "#7873AF", palette: "purple" },
  pink: { name: "Pink", swatch: "#D37B8B", palette: "pink" },
  red: { name: "Red", swatch: "#C1575C", palette: "red" },
  orange: { name: "Orange", swatch: "#D87249", palette: "orange" },
  yellow: { name: "Yellow", swatch: "#E3AC38", palette: "yellow" },
  green: { name: "Green", swatch: "#3EB489", palette: "green" },
  neutral: {
    name: "Neutral",
    swatch: "#8E8E93",
    palette: null,
    dark: { lightPalette: null, orbTint: "#C8C8CC", edgeLight: "#FFFFFF40" },
    light: { lightPalette: null, orbTint: "#B8B8BC", edgeLight: "#00000026" },
  },
};

/** Incognito: a darker neutral, whatever the app appearance. */
const INCOGNITO_TINT = "#3A3A3C";
const INCOGNITO: ProfileTheme = { lightPalette: null, orbTint: "#C8C8CC", edgeLight: "#FFFFFF33" };

function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function profileTheme(color: ProfileColor, isDark: boolean): ProfileTheme {
  const spec = PROFILE_COLORS[color] ?? PROFILE_COLORS.plum;
  const explicit = isDark ? spec.dark : spec.light;
  if (explicit) return explicit;
  return isDark
    ? { lightPalette: spec.palette, orbTint: mix(spec.swatch, "#FFFFFF", 0.45), edgeLight: `${mix(spec.swatch, "#FFFFFF", 0.5)}80` }
    : { lightPalette: spec.palette, orbTint: mix(spec.swatch, "#FFFFFF", 0.35), edgeLight: `${spec.swatch}66` };
}

const cache = new Map<string, Theme>();

/** Theme objects are cached so their identity is stable across renders. */
export function themeFor(key: string): Theme {
  let theme = cache.get(key);
  if (!theme) {
    const [color, mode] = key.split(":") as [ProfileColor | "incognito", string];
    const base = color === "incognito" ? { ...dark, ...INCOGNITO } : { ...(mode === "dark" ? dark : light), ...profileTheme(color, mode === "dark") };
    const spec = color === "incognito" ? null : (PROFILE_COLORS[color] ?? PROFILE_COLORS.plum);
    // NewTabPageViewController (rebrand): neutral's band is grey (0.502) at 0.65, others the theme colour.
    const powerUpColor = !spec ? null : spec.palette ? (spec.powerUp ?? spec.swatch) : "#808080A6";
    const backdrop = backdropTint(spec ? (spec.tint ?? tintForHue(spec.swatch, !spec.palette)) : INCOGNITO_TINT, !spec?.palette);
    theme = {
      ...base,
      backdrop,
      windowTint: opaqueTint(backdrop, base.dark),
      logoPaint: spec?.palette ?? "neutral",
      powerUpColor,
    };
    cache.set(key, theme);
  }
  return theme;
}

/** The theme for the window this component renders in. */
export function useTheme(): Theme {
  const windowId = useContext(WindowContext);
  const key = useBrowser((s) => {
    const w = s.windows[windowId ?? s.ui.focusedWindowId ?? ""];
    if (w?.incognito) return "incognito";
    const color = s.profiles[w?.profileId ?? s.settings.defaultProfileId]?.color ?? "plum";
    return `${color}:${s.ui.appDark ? "dark" : "light"}`;
  });
  return themeFor(key);
}

/** Layout constants measured from Dia (points). */
export const layout = {
  sidebarWidth: 190,
  sidebarHeader: 46,
  // TabList's horizontal inset (Dia 1.50.1, 0x105391ac4); tiles and rows span x 6 … 184 at 190.
  sidebarInset: 6,
  pinnedTop: 54.5,
  pinnedHeight: 40,
  rowHeight: 33,
  rowGap: 4,
  cardTop: 6,
  cardInset: 7,
  cardRadius: 10,
  toolbarHeight: 41,
  toolbarButton: 30,
  toolbarIconCenters: [21, 56, 92, 127],
  breadcrumbX: 153,
  trafficLightsWidth: 78,
} as const;
