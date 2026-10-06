import { create } from "zustand";

// The sidebar sliding out of the window and back (Auto-Hide Tabs, ⌘S), as in Dia: the sidebar, the traffic lights over
// it and the card's left edge move together on one spring, the card's right edge stays, and the page is laid out at
// every step (components/layout/SidebarDock.tsx). This file is the arithmetic and the per-window motion flag.

/**
 * Dia's spring, fitted to the owner's 240 fps recording (2026-10-06, two collapses and one expansion, the card's left
 * edge traced frame by frame): response 0.215 s, damping ratio 0.79 both ways (rms 2.4 % of the travel collapsing,
 * 3.2 % expanding). 90 % of the way in 100 ms, a 1.7 % overshoot at 170 ms, settled by ~0.27 s.
 */
export const DOCK_SPRING = { response: 0.215, damping: 0.79 } as const;

/** React Native's spring parameters (unit mass) for a response and damping ratio. */
export function springConfig({ response, damping }: { response: number; damping: number }) {
  const omega = (2 * Math.PI) / response;
  return { stiffness: omega * omega, damping: 2 * damping * omega, mass: 1 };
}

/** The spring's position after `t` seconds from 0 toward 1 (tests, and the frame strip's reference curve). */
export function springAt(
  t: number,
  { response, damping }: { response: number; damping: number } = DOCK_SPRING,
): number {
  if (t <= 0) return 0;
  const omega = (2 * Math.PI) / response;
  const wd = omega * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * omega * t) * (Math.cos(wd * t) + ((damping * omega) / wd) * Math.sin(wd * t));
}

/** Where AppKit puts the traffic lights (NNCore's default centre, NNCoreChromeWindow.mm), window top-left points. */
export const LIGHTS_CENTER: readonly [number, number] = [25, 27];

/**
 * The traffic lights' centre with the sidebar `offset` points to the left of its place (0 = shown, `width` = gone):
 * they belong to the sidebar's top row and go with it, as in Dia. null: their own place (nothing to move). A sidebar all
 * the way out puts them past the window's left edge, where AppKit doesn't draw them.
 */
export function lightsCenter(offset: number): [number, number] | null {
  const dx = Math.round(offset * 2) / 2;
  return dx === 0 ? null : [LIGHTS_CENTER[0] - dx, LIGHTS_CENTER[1]];
}

/** The card's left edge for a dock position (1 shown, 0 hidden) and a sidebar width. */
export const cardLeft = (dock: number, width: number, inset: number) => inset + (width - inset) * dock;

// Windows whose sidebar is moving: the card's pane fills the card by itself meanwhile (flex), and what the card computes
// from its size (split rects, the URL bar's anchor) waits for the end, so the motion re-renders nothing per frame.
type DockMotion = { moving: Record<string, true> };
export const useDockMotion = create<DockMotion>()(() => ({ moving: {} }));

export const dockMoving = (windowId: string) => !!useDockMotion.getState().moving[windowId];

export function setDockMoving(windowId: string, moving: boolean) {
  const current = useDockMotion.getState().moving;
  if (!!current[windowId] === moving) return;
  const { [windowId]: _, ...rest } = current;
  useDockMotion.setState({
    moving: moving ? { ...current, [windowId]: true } : rest,
  });
}

// The sidebar's own button with the address bar in the sidebar (Arc's header, sidebar/AddressBar.tsx): after the traffic
// lights (Dia's 70.75 + 27), back, forward and reload right-aligned 7 pt from the edge, 5 pt apart.
export const HEADER_TOOLS = { toggleX: 70.75 + 27, gap: 5, edge: 7 } as const;

/**
 * How many of back, forward and reload fit after the sidebar button in a sidebar `width` wide (buttons `button` wide).
 * The button always shows: it was dropped below 225 pt, so the default 190 pt sidebar had no way to hide itself but ⌘S.
 * Reload goes first, then forward (⌘R and ⌘] still work).
 */
export function navButtonsFitting(width: number, button = 30): number {
  const { toggleX, gap, edge } = HEADER_TOOLS;
  const room = width - (toggleX + button / 2 + gap) - edge;
  return Math.max(0, Math.min(3, Math.floor((room + gap) / (button + gap))));
}
