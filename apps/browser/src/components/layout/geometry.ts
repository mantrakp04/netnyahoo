import { layout } from "../../lib/theme";
import { slotsOf } from "../../store/splits";
import type { SplitView } from "../../store/types";

export type Rect = { x: number; y: number; width: number; height: number };

export const PANE_GAP = 7;
export const MIN_PANE = 220;

export type Divider = { kind: "root"; index: number; rect: Rect; vertical: boolean } | { kind: "stack"; rect: Rect; vertical: boolean };

export type SplitGeometry = { panes: Record<string, Rect>; dividers: Divider[] };

function cut(total: number, sizes: number[], gap: number): { start: number; size: number }[] {
  const free = Math.max(0, total - gap * (sizes.length - 1));
  let at = 0;
  return sizes.map((f) => {
    const size = Math.round(free * f);
    const out = { start: at, size };
    at += size + gap;
    return out;
  });
}

export function splitGeometry(split: SplitView, width: number, height: number, gap = PANE_GAP): SplitGeometry {
  const horizontal = split.orientation === "horizontal";
  const slots = slotsOf(split);
  const sizes = split.sizes.length === slots.length ? split.sizes : slots.map(() => 1 / slots.length);
  const panes: Record<string, Rect> = {};
  const dividers: Divider[] = [];
  const main = cut(horizontal ? width : height, sizes, gap);
  slots.forEach((slot, i) => {
    const { start, size } = main[i]!;
    const slotRect: Rect = horizontal ? { x: start, y: 0, width: size, height } : { x: 0, y: start, width, height: size };
    if (slot.length === 1) panes[slot[0]!] = slotRect;
    else {
      const inner = cut(horizontal ? slotRect.height : slotRect.width, split.stack?.sizes ?? [0.5, 0.5], gap);
      slot.forEach((id, j) => {
        const { start: s, size: z } = inner[j]!;
        panes[id] = horizontal ? { ...slotRect, y: s, height: z } : { ...slotRect, x: s, width: z };
      });
      const d = inner[0]!;
      dividers.push({
        kind: "stack",
        vertical: !horizontal,
        rect: horizontal ? { x: slotRect.x, y: d.size, width: slotRect.width, height: gap } : { x: d.size, y: slotRect.y, width: gap, height: slotRect.height },
      });
    }
    if (i < slots.length - 1) {
      dividers.push({
        kind: "root",
        index: i,
        vertical: horizontal,
        rect: horizontal ? { x: start + size, y: 0, width: gap, height } : { x: 0, y: start + size, width, height: gap },
      });
    }
  });
  return { panes, dividers };
}

export function resize(sizes: number[], a: number, delta: number, total: number, gap = PANE_GAP): number[] {
  const free = Math.max(1, total - gap * (sizes.length - 1));
  const px = sizes.map((f) => f * free);
  const pair = px[a]! + px[a + 1]!;
  const min = Math.min(MIN_PANE, px[a]!, px[a + 1]!);
  const left = Math.min(Math.max(px[a]! + delta, min), pair - min);
  const next = [...px];
  next[a] = left;
  next[a + 1] = pair - left;
  return next.map((p) => p / free);
}

export type ToolbarGeometry = {
  sidebarButton: number | null;
  back: number;
  forward: number;
  reload: number;
  urlLeft: number;
};

const geometries = new Map<string, ToolbarGeometry>();

// One object per layout, so panes that get it as a prop can skip re-rendering. The traffic lights never need room:
// they go with the sidebar (components/layout/SidebarDock.tsx), so a hidden sidebar's toolbar starts at the card's edge.
export function toolbarGeometry(o: { sidebarButton: boolean }): ToolbarGeometry {
  const key = `${o.sidebarButton}`;
  let g = geometries.get(key);
  if (!g) geometries.set(key, (g = computeToolbarGeometry(o)));
  return g;
}

function computeToolbarGeometry(o: { sidebarButton: boolean }): ToolbarGeometry {
  const [c0, c1, c2, c3] = layout.toolbarIconCenters;
  if (o.sidebarButton) return { sidebarButton: c0, back: c1, forward: c2, reload: c3, urlLeft: layout.breadcrumbX - 8 };
  const shift = c1 - c0;
  return { sidebarButton: null, back: c1 - shift, forward: c2 - shift, reload: c3 - shift, urlLeft: layout.breadcrumbX - 8 - shift };
}

export const NO_TOOLBAR: ToolbarGeometry = { sidebarButton: null, back: 21, forward: 21, reload: 21, urlLeft: 8 };
