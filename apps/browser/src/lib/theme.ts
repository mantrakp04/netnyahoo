import type { AreaLightPalette } from "@netnyahoo/shaders";
import { createContext, createElement, useContext, type ReactNode } from "react";
import { useBrowser, type BrowserState } from "../store/browser";
import { PageProfileContext, WindowContext } from "../store/hooks";
import type { ProfileColor } from "../store/types";
import { backdropTint, opaqueTint, tintForHue, type BackdropTint } from "./windowTint";

export type Theme = typeof dark & ProfileTheme & {
  backdrop: BackdropTint;
  windowTint: [string, string];
  powerUpColor: string | null;
};

const dark = {
  dark: true,
  // Dia: 0.09 sidebar, 0.05 page.
  grain: 0.006,
  // Dia: 0.5 tint.
  card: "rgba(18,18,18,0.5)",
  cardEdge: "rgba(0,0,0,0.35)",
  divider: "rgba(255,255,255,0.08)",

  textPrimary: "#FFFFFF",
  textTab: "#FFFFFFC7", // Dia: 0.78.
  textSecondary: "#FFFFFF80",
  textTertiary: "#FFFFFF59",
  icon: "#F7F5FFC6", // Dia: 0.78.
  iconDisabled: "#F7F5FF4D",

  tabHover: "rgba(255,255,255,0.16)",
  tabPressed: "rgba(255,255,255,0.31)",
  // Dia: 0.5.
  tabSelected: "rgba(18,18,18,0.5)",
  tabSelectedText: "#FFFFFF",
  // Dia: 0.5pt border; 15/12.5 shadow.
  tabSelectedBorder: ["rgba(255,255,255,0.15)", "rgba(255,255,255,0.15)"] as [string, string],
  tabSelectedShadow: "rgba(255,255,255,0.15)",
  tabSelectedShadowRadius: 15,
  pinnedResting: "rgba(255,255,255,0.1)",
  pinnedRestingStroke: "rgba(255,255,255,0.14)",
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
  placeholder: "#FFFFFF87", // Dia: 0.53.
  chipBorder: "rgba(255,255,255,0.15)",
  chipText: "#FFFFFF99",
  goButton: "#DCCBD8",
  goButtonText: "#1A1418",
  sendIdle: "rgba(255,255,255,0.08)",

  ntpBar: "rgba(24,24,24,0.8)",
  ntpBarSolid: "#2D2D2D",
  ntpBarBorder: "rgba(120,125,134,0.32)",
  lightIntensity: 4,
  accent: "#4A77D4",
};

const light: typeof dark = {
  dark: false,
  grain: 0.05,
  card: "rgba(255,255,255,0.7)", // Dia: 0.7.
  cardEdge: "rgba(0,0,0,0.08)",
  divider: "rgba(0,0,0,0.08)",

  textPrimary: "#000000",
  textTab: "#000000AD", // Dia: 0.68.
  textSecondary: "#00000080",
  textTertiary: "#00000059",
  icon: "#000000C6",
  iconDisabled: "#0000004D",

  tabHover: "rgba(255,255,255,0.55)",
  tabPressed: "rgba(255,255,255,0.7)",
  tabSelected: "rgba(255,255,255,0.7)",
  tabSelectedText: "#000000",
  tabSelectedBorder: ["rgba(255,255,255,0.98)", "rgba(0,0,0,0.06)"],
  tabSelectedShadow: "rgba(0,0,0,0.12)",
  tabSelectedShadowRadius: 12.5,
  pinnedResting: "rgba(0,0,0,0.05)",
  pinnedRestingStroke: "rgba(0,0,0,0.18)",
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

export function hex(color: string): string {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return color;
  const [r, g, b, a = "1"] = m[1]!.split(",").map((v) => v.trim());
  const h = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0").toUpperCase();
  return `#${h(+r!)}${h(+g!)}${h(+b!)}${h(+a * 255)}`;
}

type ProfileTheme = {
  lightPalette: AreaLightPalette | null;
  // Dia: 0.5 / 0.4.
  edgeLight: string;
};

type ProfileColorSpec = {
  name: string;
  swatch: string;
  palette: AreaLightPalette | null;
  powerUp?: string;
  tint?: string;
  action?: string;
  dark?: ProfileTheme;
  light?: ProfileTheme;
};

export const PROFILE_COLORS: Record<ProfileColor, ProfileColorSpec> = {
  plum: {
    name: "Plum",
    swatch: "#C07A98",
    // Dia: plum band #B5556B, tint #B25B6B, name #DD899B.
    powerUp: "#B5556B",
    tint: "#B25B6B",
    action: "#DD899B",
    palette: "pink",
    dark: { lightPalette: "pink", edgeLight: "#EBB3CB80" },
    light: { lightPalette: "pink", edgeLight: "#D37B8B66" },
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
    dark: { lightPalette: null, edgeLight: "#FFFFFF40" },
    light: { lightPalette: null, edgeLight: "#00000026" },
  },
};

const INCOGNITO_TINT = "#3A3A3C";
const INCOGNITO: ProfileTheme = { lightPalette: null, edgeLight: "#FFFFFF33" };

export function profileNameColor(color: ProfileColor, dark: boolean): string {
  const spec = PROFILE_COLORS[color] ?? PROFILE_COLORS.plum;
  const base = spec.action ?? spec.swatch;
  return dark ? mix(base, "#FFFFFF", 0.6) : mix(base, "#000000", 0.4);
}

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
    ? { lightPalette: spec.palette, edgeLight: `${mix(spec.swatch, "#FFFFFF", 0.5)}80` }
    : { lightPalette: spec.palette, edgeLight: `${spec.swatch}66` };
}

const cache = new Map<string, Theme>();

export function themeFor(key: string): Theme {
  let theme = cache.get(key);
  if (!theme) {
    const [color, mode] = key.split(":") as [ProfileColor | "incognito", string];
    const base = color === "incognito" ? { ...dark, ...INCOGNITO } : { ...(mode === "dark" ? dark : light), ...profileTheme(color, mode === "dark") };
    const spec = color === "incognito" ? null : (PROFILE_COLORS[color] ?? PROFILE_COLORS.plum);
    // Dia: neutral band 0.502 at 0.65.
    const powerUpColor = !spec ? null : spec.palette ? (spec.powerUp ?? spec.swatch) : "#808080A6";
    const backdrop = backdropTint(spec ? (spec.tint ?? tintForHue(spec.swatch, !spec.palette)) : INCOGNITO_TINT, !spec?.palette);
    theme = {
      ...base,
      backdrop,
      windowTint: opaqueTint(backdrop, base.dark),
      powerUpColor,
    };
    cache.set(key, theme);
  }
  return theme;
}

function themeKey(s: BrowserState, windowId: string | null, page: string | null): string {
  const w = s.windows[windowId ?? s.ui.focusedWindowId ?? ""];
  if (w?.incognito) return "incognito";
  const color = s.profiles[page ?? w?.profileId ?? s.settings.defaultProfileId]?.color ?? "plum";
  return `${color}:${s.ui.appDark ? "dark" : "light"}`;
}

const ThemeContext = createContext<Theme | null>(null);

// Resolves the theme once for everything below it: every window root and every profile page (which
// sets PageProfileContext) has one, so the hundreds of components that call useTheme read a context
// instead of each subscribing to the store (each subscription runs on every store update).
export function ThemeScope({ children }: { children: ReactNode }) {
  const windowId = useContext(WindowContext);
  const page = useContext(PageProfileContext);
  const key = useBrowser((s) => themeKey(s, windowId, page));
  return createElement(ThemeContext.Provider, { value: themeFor(key) }, children);
}

export function useTheme(): Theme {
  const scoped = useContext(ThemeContext);
  if (scoped) return scoped;
  // Outside a ThemeScope (nothing renders there today) the theme is read once, not followed.
  if (__DEV__) console.warn("useTheme outside a ThemeScope");
  return themeFor(themeKey(useBrowser.getState(), null, null));
}

export const layout = {
  sidebarWidth: 190,
  sidebarHeader: 46,
  // Dia: 6pt inset.
  sidebarInset: 6,
  // Dia: 41pt tiles, 6pt gap, 54pt top; 37pt rows.
  pinnedTop: 54,
  pinnedHeight: 41,
  rowHeight: 34,
  rowGap: 3,
  cardTop: 6,
  cardInset: 7,
  cardRadius: 10,
  toolbarHeight: 41,
  toolbarButton: 30,
  toolbarIconCenters: [21, 56, 92, 127],
  breadcrumbX: 153,
  trafficLightsWidth: 78,
} as const;
