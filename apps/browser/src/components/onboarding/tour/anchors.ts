import type { View } from "react-native";
import { layout } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { activeTabId } from "../../../store/model";
import { splitOf } from "../../../store/splits";
import { toolbarGeometry, type Rect } from "../../layout/geometry";
import { useUrlAnchors } from "../../layout/windowLayout";
import { measureRow } from "../../sidebar/state";

/**
 * Where the tool tour's coach marks point, in window coordinates. Views that the tour points at
 * register themselves (`tourAnchorRef`); the rest are found through what the window already
 * tracks (sidebar rows, the URL field's anchor).
 */
export type TourAnchor = "commandBar" | "page" | "tabs" | "sidebarButton";

const registered = new Map<string, View>();
const key = (windowId: string, id: TourAnchor) => `${windowId}\n${id}`;

/** A ref callback registering the view as `id`'s anchor in the window. */
export const tourAnchorRef = (windowId: string, id: TourAnchor) => (view: View | null) => {
  if (view) registered.set(key(windowId, id), view);
  else registered.delete(key(windowId, id));
};

function measure(view: View | undefined): Promise<Rect | null> {
  if (!view) return Promise.resolve(null);
  return new Promise((resolve) => view.measureInWindow((x, y, width, height) => resolve(width && height ? { x, y, width, height } : null)));
}

export async function locateAnchor(windowId: string, id: TourAnchor): Promise<Rect | null> {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!w) return null;
  const tabLayout = w.tabLayout ?? s.settings.tabLayout;
  switch (id) {
    case "commandBar":
    case "page":
      return measure(registered.get(key(windowId, id)));
    case "tabs": {
      // The selected tab's row (the New Tab page's, right after onboarding).
      const tabId = activeTabId(s, windowId);
      return w.sidebarOpen && tabLayout === "sidebar" && tabId ? measureRow(windowId, tabId) : null;
    }
    case "sidebarButton": {
      // It sits in the leading pane's toolbar, at the geometry ContentCard gives that pane.
      const url = useUrlAnchors.getState()[windowId];
      // None with the address bar in the sidebar (panes have no toolbar).
      if (!url || url.sidebar || tabLayout !== "sidebar" || splitOf(s, activeTabId(s, windowId))) return null;
      const g = toolbarGeometry({ sidebarButton: true, clearTrafficLights: !w.sidebarOpen });
      if (g.sidebarButton === null) return null;
      const size = layout.toolbarButton;
      return { x: url.left - g.urlLeft + g.sidebarButton - size / 2, y: url.top + 21.2 - size / 2, width: size, height: size };
    }
  }
}
