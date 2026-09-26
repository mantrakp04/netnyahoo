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
 * Arc's sidebar dropdown, from a 2× capture of Arc (228 pt sidebar, 212 pt field): its top-left
 * corner on the field's, 349 pt wide (the field plus 137), radius about 13.5. Ours keeps Dia's
 * panel material and popover radius (12).
 */
const DROPDOWN_MIN_WIDTH = 350;
const DROPDOWN_PAST_FIELD = 137;
const DROPDOWN_RADIUS = 12;

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

  const room = (left: number, fallback: number) => (windowWidth > 0 ? windowWidth - left - WINDOW_MARGIN : fallback);
  const onCancel = () => useBrowser.getState().closePanel(windowId);

  // The sidebar's field (Settings › Appearance › Address Bar): Arc's dropdown, which opens where
  // the field is and reaches a little way into the page.
  if (anchor.sidebar) {
    const width = Math.min(Math.max(DROPDOWN_MIN_WIDTH, anchor.width + DROPDOWN_PAST_FIELD), room(anchor.left, DROPDOWN_MIN_WIDTH));
    return (
      <Surface
        fill={hex(theme.panel)}
        cornerRadius={DROPDOWN_RADIUS}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={24}
        shadowOffset={[0, 10]}
        style={{ position: "absolute", top: anchor.top, left: anchor.left, width }}
      >
        <Omnibox key={active.id} variant="sidebar" tabId={active.id} initialText={panel.initialText} onCancel={onCancel} />
      </Surface>
    );
  }

  const left = Math.max(WINDOW_MARGIN, anchor.left - LEFT_OF_URL);
  const top = Math.max(0.5, anchor.top - ABOVE_PANE);
  // Right edge where the pane's URL field ends (12pt in from the pane), like Dia's single pane.
  const fitted = Math.min(MAX_WIDTH, anchor.width + LEFT_OF_URL);
  const width = Math.min(Math.max(fitted, MIN_WIDTH), room(left, fitted));
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
      style={{ position: "absolute", top, left, width }}
    >
      <Omnibox key={active.id} variant="panel" tabId={active.id} initialText={panel.initialText} onCancel={onCancel} />
    </Surface>
  );
}
