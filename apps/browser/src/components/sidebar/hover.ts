import { useState } from "react";
import { measureRow, setSidebarUi, sidebarUi, type Target } from "./state";

const SHOW_DELAY_MS = 650;
const HIDE_DELAY_MS = 160;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
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

export const keepHover = () => clearTimeout(hideTimer);

export function dismissHover() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (sidebarUi().hover) setSidebarUi({ hover: null });
}

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
