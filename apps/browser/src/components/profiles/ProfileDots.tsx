import { Animated, Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../lib/actions";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsIncognito } from "../../store/hooks";
import { usePagerPages, type PagerPage } from "../layout/profilePager";
import { useHover } from "../primitives";

// Dia: 41pt height; 12pt cell, 6pt dot, 28pt band; opacity 0.85/0.4/0.2.
export const PROFILE_DOTS_HEIGHT = 41;
const CELL = 12;
const DOT = 6;
const BAND = 28;
const SELECTED = 0.85;
const HOVERED = 0.4;
const IDLE = 0.2;

export function useProfileDotsShown() {
  const incognito = useIsIncognito();
  const count = useBrowser((s) => s.profileOrder.length);
  return !incognito && count > 1;
}

export function ProfileDots({ windowId }: { windowId: string }) {
  const ids = useBrowser(useShallow((s) => s.profileOrder));
  const { pages, pager } = usePagerPages(windowId);
  return (
    <View style={{ height: PROFILE_DOTS_HEIGHT, alignItems: "center" }}>
      <View style={{ marginTop: (PROFILE_DOTS_HEIGHT - 3 - BAND) / 2, height: BAND, flexDirection: "row" }}>
        {ids.map((id) => (
          <Dot key={id} id={id} windowId={windowId} page={pages.find((p) => p.id === id)} pos={pager.pos} />
        ))}
      </View>
    </View>
  );
}

function Dot({ id, windowId, page, pos }: { id: string; windowId: string; page: PagerPage | undefined; pos: Animated.Value }) {
  const theme = useTheme();
  const name = useBrowser((s) => s.profiles[id]?.name ?? "");
  const { hovered, hoverProps } = useHover();
  const rest = hovered ? HOVERED : IDLE;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, SELECTED, rest], extrapolate: "clamp" })
    : rest;
  return (
    <View {...hoverProps} tooltip={name}>
      <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={() => switchProfile(windowId, id, true)}>
        <View style={{ width: CELL, height: BAND, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.dark ? "#FFFFFF" : "#000000", opacity }} />
        </View>
      </Pressable>
    </View>
  );
}
