import { Surface } from "@netnyahoo/shell";
import { hex, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { useActiveTab, useWindowId, useWindowUi } from "../store/hooks";
import { useUrlAnchor } from "./layout/windowLayout";
import { Omnibox } from "./Omnibox";

/** Measured on Dia: the panel starts 37.4pt left of the URL text and 5.5pt above the pane's top. */
const LEFT_OF_URL = 37.4;
const ABOVE_PANE = 5.5;
const MAX_WIDTH = 888;
/** A narrow split pane still gets a usable panel (it may overhang the pane, never the window). */
const MIN_WIDTH = 420;
const WINDOW_MARGIN = 12;

/**
 * URL click / ⌘L: the command bar expands in place over the focused pane's toolbar, with no
 * scrim. Measured on Dia: 888pt wide, top at the window edge, left 107.6pt into the card; it
 * overhangs the card, so it's rendered at window level. The pane's URL field position comes
 * from the layout (`useUrlAnchor`), so it follows the sidebar width, the top tab strip and splits.
 */
export function CommandPanel({ windowWidth }: { windowWidth: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const { panel } = useWindowUi();
  const active = useActiveTab();
  const anchor = useUrlAnchor(windowId);
  // An empty split pane (no URL yet) opens the panel too: it has no New Tab page bar of its own.
  if (!panel.open || !active || !anchor) return null;

  const left = Math.max(WINDOW_MARGIN, anchor.left - LEFT_OF_URL);
  // Right edge where the pane's URL field ends (12pt in from the pane), like Dia's single pane.
  const fitted = Math.min(MAX_WIDTH, anchor.width + LEFT_OF_URL);
  const room = windowWidth > 0 ? windowWidth - left - WINDOW_MARGIN : fitted;
  const width = Math.min(Math.max(fitted, MIN_WIDTH), room);
  return (
    <Surface
      fill={hex(theme.panel)}
      cornerRadius={17}
      borderColor={hex(theme.panelBorder)}
      borderWidth={0.5}
      shadowColor="#000000"
      shadowOpacity={theme.panelShadowOpacity}
      shadowRadius={24}
      shadowOffset={[0, 10]}
      style={{ position: "absolute", top: Math.max(0.5, anchor.top - ABOVE_PANE), left, width }}
    >
      <Omnibox
        key={active.id}
        variant="panel"
        tabId={active.id}
        initialText={panel.initialText}
        onCancel={() => useBrowser.getState().closePanel(windowId)}
      />
    </Surface>
  );
}
