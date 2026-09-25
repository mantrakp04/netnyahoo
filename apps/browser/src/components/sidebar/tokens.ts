import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import type { GroupColor } from "../../store/types";
import { useSidebarUi } from "./state";

/**
 * Sidebar colours from Dia's asset catalogs (BoostBrowser_TabUI, _RecentTabs,
 * _DragDrop, _CustomIconUI, ARCClients_BaseAssets), light / dark.
 */
const DARK = {
  groupFill: "rgba(255,255,255,0.1)", // TabGroupNeutralBackground
  groupFillEmphasized: "rgba(255,255,255,0.12)",
  groupHeaderHover: "rgba(255,255,255,0.12)", // TabGroupNeutralBackgroundHovered
  groupStroke: "rgba(255,255,255,0.1)", // TabGroupSidebarStroke
  groupTitle: "#FFFFFF", // TabGroupTitle
  countPill: "rgba(255,255,255,0.15)", // TabGroupCountPillBackground
  multiSelected: "rgba(255,255,255,0.1)", // TabCellBackgroundMutiselected
  multiSelectedStroke: "rgba(255,255,255,0.14)",
  dragBorder: "rgba(255,255,255,0.33)", // DragDrop/Border
  dragSilhouette: "#0F0F14", // DragDrop/TabSilhouetteBackground
  switcherFocus: "rgba(255,255,255,0.3)", // RecentTabs/ItemFocusBackground
  switcherOutline: "rgba(255,255,255,0.15)", // RecentTabs/ItemOutline
  pickerCellHover: "rgba(255,255,255,0.25)", // CustomIconUI/IconPickerBackground
  separator: "rgba(255,255,255,0.15)", // SidebarSeparator
  badge: "rgba(255,255,255,0.9)",
  badgeGlyph: "#1B1618",
  upsellButton: "rgba(255,255,255,0.08)", // CleanTabs/SecondaryButton
  upsellButtonHover: "rgba(255,255,255,0.11)",
};

const LIGHT: typeof DARK = {
  groupFill: "rgba(0,0,0,0.05)",
  groupFillEmphasized: "rgba(0,0,0,0.07)",
  groupHeaderHover: "rgba(255,255,255,0.4)",
  groupStroke: "rgba(0,0,0,0.1)",
  groupTitle: "#000000D9",
  countPill: "rgba(0,0,0,0.15)",
  multiSelected: "rgba(0,0,0,0.1)",
  multiSelectedStroke: "rgba(0,0,0,0.08)",
  dragBorder: "rgba(0,0,0,0.28)",
  dragSilhouette: "#FFFFFF",
  switcherFocus: "rgba(0,0,0,0.18)",
  switcherOutline: "rgba(0,0,0,0.1)",
  pickerCellHover: "rgba(134,136,141,0.25)",
  separator: "rgba(0,0,0,0.15)",
  badge: "rgba(0,0,0,0.75)",
  badgeGlyph: "#FFFFFF",
  upsellButton: "rgba(0,0,0,0.08)",
  upsellButtonHover: "rgba(0,0,0,0.11)",
};

export type SidebarTokens = typeof DARK;

export function useSidebarTokens(): SidebarTokens {
  return useTheme().dark ? DARK : LIGHT;
}

/** Group colours (Dia groups are neutral unless coloured). */
export const GROUP_COLORS: Record<GroupColor, { name: string; hex: string }> = {
  grey: { name: "Grey", hex: "#8E8E93" },
  blue: { name: "Blue", hex: "#4C8DF6" },
  red: { name: "Red", hex: "#E5534B" },
  yellow: { name: "Yellow", hex: "#E3B341" },
  green: { name: "Green", hex: "#3FB06C" },
  pink: { name: "Pink", hex: "#DB61A2" },
  purple: { name: "Purple", hex: "#9B6CF0" },
  cyan: { name: "Cyan", hex: "#35B8C6" },
  orange: { name: "Orange", hex: "#EE8434" },
};

/** The group colour closest in hue to a site's theme colour (Dia derives group colours from the site). */
export function nearestGroupColor(color: string): GroupColor | null {
  const m = color.trim().match(/^#?([0-9a-f]{6})/i) ?? color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const rgb = m.length === 2 ? [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) : [+m[1]!, +m[2]!, +m[3]!];
  const hsl = (r: number, g: number, b: number) => {
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r / 255 ? ((g - b) / 255 / d + 6) % 6 : max === g / 255 ? (b - r) / 255 / d + 2 : (r - g) / 255 / d + 4;
    return { h: h * 60, s, l };
  };
  const target = hsl(rgb[0]!, rgb[1]!, rgb[2]!);
  // Greys, near-black and near-white sites stay neutral.
  if (target.s < 0.18 || target.l < 0.12 || target.l > 0.92) return null;
  let best: GroupColor | null = null;
  let bestDistance = Infinity;
  for (const [id, { hex }] of Object.entries(GROUP_COLORS) as [GroupColor, { hex: string }][]) {
    if (id === "grey") continue;
    const n = parseInt(hex.slice(1), 16);
    const c = hsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
    const dh = Math.min(Math.abs(c.h - target.h), 360 - Math.abs(c.h - target.h));
    if (dh < bestDistance) [best, bestDistance] = [id, dh];
  }
  return best;
}

/** "#RRGGBB" at `alpha` → rgba(). */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 400;

/** The window's sidebar width: live while its edge is dragged, else the saved setting. */
export function useSidebarWidth(windowId: string): number {
  const saved = useBrowser((s) => s.settings.sidebarWidth ?? layout.sidebarWidth);
  const dragging = useSidebarUi((u) => u.dragWidth[windowId]);
  return dragging ?? saved;
}
