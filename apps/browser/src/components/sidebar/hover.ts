import { useState } from "react";
import { measureRow, setSidebarUi, sidebarUi, type Target } from "./state";

/**
 * Hover cards (a tab's title, URL and actions; a collapsed group's peek) appear
 * after a short rest on a row and follow the pointer between rows once shown,
 * like tooltips. Moving onto the card keeps it open.
 */
const SHOW_DELAY_MS = 650;
const HIDE_DELAY_MS = 160;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
/** No cards while dragging. */
let suppressed = false;

export function suppressHover(value: boolean) {
  suppressed = value;
  if (value) dismissHover();
}

async function show(windowId: string, target: Target) {
  const anchor = await measureRow(windowId, target.id);
  if (anchor && !sidebarUi().iconPicker && !sidebarUi().renaming) setSidebarUi({ hover: { windowId, ...target, anchor } });
}

export function hoverEnter(windowId: string, target: Target) {
  if (suppressed) return;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  const current = sidebarUi().hover;
  if (current?.id === target.id) return;
  if (current) void show(windowId, target);
  else showTimer = setTimeout(() => void show(windowId, target), SHOW_DELAY_MS);
}

export function hoverLeave() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => setSidebarUi({ hover: null }), HIDE_DELAY_MS);
}

/** The card itself: entering it cancels the pending hide. */
export const keepHover = () => clearTimeout(hideTimer);

export function dismissHover() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (sidebarUi().hover) setSidebarUi({ hover: null });
}

/** Local hover state for a row, plus its hover card. `target` null = no card. */
export function useRowHover(windowId: string, target: Target | null) {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    hoverProps: {
      onMouseEnter: () => {
        setHovered(true);
        if (target) hoverEnter(windowId, target);
      },
      onMouseLeave: () => {
        setHovered(false);
        if (target) hoverLeave();
      },
    },
  };
}
