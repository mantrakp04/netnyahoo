import { OutsidePressArea, Surface } from "@netnyahoo/shell";
import { hex, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { useWindowId, useWindowUi } from "../store/hooks";
import { activeTabId } from "../store/model";
import { useUrlAnchors } from "./layout/windowLayout";
import { Omnibox } from "./Omnibox";

// Dia: 37.4pt offset, 5.5pt rise, 888pt max, 12pt margin/radius.
const LEFT_OF_URL = 37.4;
const ABOVE_PANE = 5.5;
const MAX_WIDTH = 888;
const MIN_WIDTH = 420;
const WINDOW_MARGIN = 12;
const DROPDOWN_MIN_WIDTH = 350;
const DROPDOWN_PAST_FIELD = 137;
const DROPDOWN_RADIUS = 12;

export function CommandPanel({ windowWidth }: { windowWidth: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const { panel } = useWindowUi();
  // The active tab's id, and only while the panel is open: a closed panel doesn't re-render on tab switches.
  const activeId = useBrowser((s) => (panel.open ? activeTabId(s, windowId) : undefined));
  const anchor = useUrlAnchors((s) => (panel.open ? s[windowId] : undefined));
  if (!panel.open || !activeId || !anchor) return null;

  const room = (left: number, fallback: number) => (windowWidth > 0 ? windowWidth - left - WINDOW_MARGIN : fallback);
  // A click anywhere outside the bar closes it, as Esc does (its field's blur alone misses clicks on the sidebar).
  const onCancel = () => useBrowser.getState().closePanel(windowId);

  if (anchor.sidebar) {
    // A hidden sidebar (Arc's layout keeps the bar in it) is out of the window: the bar drops from the window's corner.
    const left = Math.max(WINDOW_MARGIN, anchor.left);
    const width = Math.min(Math.max(DROPDOWN_MIN_WIDTH, anchor.width + DROPDOWN_PAST_FIELD), room(left, DROPDOWN_MIN_WIDTH));
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
        style={{ position: "absolute", top: anchor.top, left, width }}
      >
        <OutsidePressArea onOutsidePress={onCancel}>
          <Omnibox key={activeId} variant="sidebar" tabId={activeId} initialText={panel.initialText} onCancel={onCancel} />
        </OutsidePressArea>
      </Surface>
    );
  }

  const left = Math.max(WINDOW_MARGIN, anchor.left - LEFT_OF_URL);
  const top = Math.max(0.5, anchor.top - ABOVE_PANE);
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
      <OutsidePressArea onOutsidePress={onCancel}>
        <Omnibox key={activeId} variant="panel" tabId={activeId} initialText={panel.initialText} onCancel={onCancel} />
      </OutsidePressArea>
    </Surface>
  );
}
