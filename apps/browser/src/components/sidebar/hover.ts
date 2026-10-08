import { useContext, useRef, useState } from "react";
import { markHoverProps } from "../../lib/hoverShift";
import { useBrowser } from "../../store/browser";
import { PageProfileContext } from "../../store/hooks";
import { measureRow, setSidebarUi, sidebarUi, type Target } from "./state";

const SHOW_DELAY_MS = 650;
const HIDE_DELAY_MS = 160;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let suppressed = false;
// Bumped by everything that ends or replaces a hover: a card measured for an older one never shows.
let ticket = 0;

export function suppressHover(value: boolean) {
  suppressed = value;
  if (value) dismissHover();
}

async function show(windowId: string, target: Target, mine: number) {
  const anchor = await measureRow(windowId, target.id);
  if (mine !== ticket || suppressed || !anchor || sidebarUi().iconPicker || sidebarUi().renaming) return;
  setSidebarUi({ hover: { windowId, ...target, anchor } });
}

export function hoverEnter(windowId: string, target: Target) {
  if (suppressed) return;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  const current = sidebarUi().hover;
  if (current?.id === target.id) return;
  const mine = ++ticket;
  if (current) void show(windowId, target, mine);
  else showTimer = setTimeout(() => void show(windowId, target, mine), SHOW_DELAY_MS);
}

export function hoverLeave() {
  ticket++;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => setSidebarUi({ hover: null }), HIDE_DELAY_MS);
}

export const keepHover = () => clearTimeout(hideTimer);

// Clicks, menus, drags, scrolling and profile switches: the card's anchor no longer holds.
export function dismissHover() {
  ticket++;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (sidebarUi().hover) setSidebarUi({ hover: null });
}

export function useRowHover(windowId: string, target: Target | null) {
  const [hovered, setHovered] = useState(false);
  const page = useContext(PageProfileContext);
  const latest = useRef({ windowId, target, page });
  latest.current = { windowId, target, page };
  // Another profile's page is moved aside by a transform, which AppKit's hover tracking ignores: its rows still hover
  // under the current page's, and the last one entered took the card (another profile's tab over the one pointed at).
  const onCurrentPage = () => {
    const { windowId, page } = latest.current;
    return !page || useBrowser.getState().windows[windowId]?.profileId === page;
  };
  const [hoverProps] = useState(() =>
    markHoverProps({
      onMouseEnter: () => {
        if (!onCurrentPage()) return;
        setHovered(true);
        const { windowId, target } = latest.current;
        if (target) hoverEnter(windowId, target);
      },
      onMouseLeave: () => {
        setHovered(false);
        if (latest.current.target && onCurrentPage()) hoverLeave();
      },
    }),
  );
  return { hovered, hoverProps };
}
