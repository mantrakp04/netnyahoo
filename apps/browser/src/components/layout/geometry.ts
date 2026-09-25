import { layout } from "../../lib/theme";
import { slotsOf } from "../../store/splits";
import type { SplitView } from "../../store/types";

export type Rect = { x: number; y: number; width: number; height: number };

/** Space between split panes (the card's own inset, like Dia's pane insets). */
export const PANE_GAP = 7;
/** Panes can't be dragged narrower / shorter than this. */
export const MIN_PANE = 220;

/** A draggable divider: between top-level slots (`index`, `index + 1`) or inside the stack. */
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

/** Pane rects (relative to the content area) and dividers for a split. */
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
      // Stacked the other way inside the slot.
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

/**
 * New fractions after dragging the divider between `a` and `a + 1` by `delta`
 * points, keeping both panes at least MIN_PANE (or their current size if smaller).
 */
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

/**
 * Toolbar geometry for one pane. The leading pane (touching the window's
 * top-left) hosts the sidebar button in the sidebar layout, and clears the
 * traffic lights when the sidebar is hidden.
 */
export type ToolbarGeometry = {
  /** Icon centres from the pane's left edge: [sidebar?, back, forward, reload]. */
  sidebarButton: number | null;
  back: number;
  forward: number;
  reload: number;
  /** Where the URL pill starts (its text sits 8pt further in). */
  urlLeft: number;
};

/** Clearance for the traffic lights when the card reaches the window's top-left. */
export const TRAFFIC_LIGHTS_OFFSET = 70;

export function toolbarGeometry(o: { sidebarButton: boolean; clearTrafficLights: boolean }): ToolbarGeometry {
  const offset = o.clearTrafficLights ? TRAFFIC_LIGHTS_OFFSET : 0;
  const [c0, c1, c2, c3] = layout.toolbarIconCenters;
  if (o.sidebarButton) return { sidebarButton: offset + c0, back: offset + c1, forward: offset + c2, reload: offset + c3, urlLeft: offset + layout.breadcrumbX - 8 };
  // Without the sidebar button everything moves one slot left.
  const shift = c1 - c0;
  return { sidebarButton: null, back: offset + c1 - shift, forward: offset + c2 - shift, reload: offset + c3 - shift, urlLeft: offset + layout.breadcrumbX - 8 - shift };
}

/**
 * Panes without a toolbar (the address bar is in the sidebar): what hangs off the toolbar
 * (history list, permission prompts) opens at the page's top-left corner, next to the sidebar.
 */
export const NO_TOOLBAR: ToolbarGeometry = { sidebarButton: null, back: 21, forward: 21, reload: 21, urlLeft: 8 };
