import { View } from "react-native";
import { useBrowser } from "../../store/browser";
import { useResizeDrag } from "../layout/useResizeDrag";
import { setSidebarUi, sidebarUi } from "./state";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./tokens";

export function ResizeHandle({ windowId }: { windowId: string }) {
  const handlers = useResizeDrag({
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
    direction: 1,
    saved: () => useBrowser.getState().settings.sidebarWidth ?? 190,
    onLive: (w) => {
      const { [windowId]: _, ...rest } = sidebarUi().dragWidth;
      setSidebarUi({ dragWidth: w === null ? rest : { ...rest, [windowId]: Math.round(w * 2) / 2 } });
    },
    onCommit: (w) => useBrowser.getState().updateSettings({ sidebarWidth: w }),
  });
  return (
    <View
      {...handlers}
      onDoubleClick={() => useBrowser.getState().updateSettings({ sidebarWidth: 190 })}
      style={{ position: "absolute", top: 46, bottom: 0, right: -3, width: 7, cursor: "col-resize" }}
    />
  );
}
