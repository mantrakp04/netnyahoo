import { useMemo, useRef } from "react";
import { Animated, Easing, PanResponder, View } from "react-native";
import { useBrowser } from "../../store/browser";
import { setSidebarUi, sidebarUi } from "./state";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./tokens";

/** Past a limit the edge follows the pointer less and less (Dia 1.2x: "rubber-bands, inspired by Things"). */
function rubberBand(width: number): number {
  const band = (over: number) => 36 * (1 - Math.exp(-over / 90));
  if (width > SIDEBAR_MAX_WIDTH) return SIDEBAR_MAX_WIDTH + band(width - SIDEBAR_MAX_WIDTH);
  if (width < SIDEBAR_MIN_WIDTH) return SIDEBAR_MIN_WIDTH - band(SIDEBAR_MIN_WIDTH - width);
  return width;
}

const clamp = (w: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w));

/** The sidebar's trailing edge: drag to resize (saved in settings), double-click for the default width. */
export function ResizeHandle({ windowId, width }: { windowId: string; width: number }) {
  const start = useRef(width);
  const setLive = (w: number) => setSidebarUi({ dragWidth: { ...sidebarUi().dragWidth, [windowId]: Math.round(w * 2) / 2 } });
  const finish = (w: number) => {
    useBrowser.getState().updateSettings({ sidebarWidth: w });
    const { [windowId]: _, ...rest } = sidebarUi().dragWidth;
    setSidebarUi({ dragWidth: rest });
  };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = useBrowser.getState().settings.sidebarWidth ?? 190;
          setLive(start.current);
        },
        onPanResponderMove: (_, g) => setLive(rubberBand(start.current + g.dx)),
        onPanResponderRelease: (_, g) => {
          const raw = rubberBand(start.current + g.dx);
          const target = clamp(raw);
          if (raw === target) return finish(target);
          // Spring back from the rubber band.
          const value = new Animated.Value(raw);
          value.addListener(({ value: v }) => setLive(v));
          Animated.timing(value, { toValue: target, duration: 260, easing: Easing.out(Easing.back(1.2)), useNativeDriver: false }).start(() => {
            value.removeAllListeners();
            finish(target);
          });
        },
        onPanResponderTerminate: () => finish(clamp(sidebarUi().dragWidth[windowId] ?? start.current)),
        onPanResponderTerminationRequest: () => false,
      }),
    [windowId],
  );
  return (
    <View
      {...responder.panHandlers}
      onDoubleClick={() => useBrowser.getState().updateSettings({ sidebarWidth: 190 })}
      style={{ position: "absolute", top: 46, bottom: 0, right: -3, width: 7, cursor: "col-resize" }}
    />
  );
}
