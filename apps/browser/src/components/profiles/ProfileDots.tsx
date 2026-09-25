import { Animated, Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../lib/actions";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsIncognito } from "../../store/hooks";
import { usePagerPages, type PagerPage } from "../layout/profilePager";
import { useHover } from "../primitives";

/** Dia's sidebar footer (SidebarContainerFooterView) is 41 pt tall with a space switcher in it. */
export const PROFILE_DOTS_HEIGHT = 41;
/** SpaceSwitcherLayout: a 12 pt cell per item, a 6 pt dot centred in it. */
const CELL = 12;
const DOT = 6;
/** The switcher band: 28 pt tall, centred in the footer above its bottom 3 pt. */
const BAND = 28;
/** SpaceSwitcherItemView.updateLayer: labelColor at 0.85 selected, 0.4 hovered, 0.2 otherwise. */
const SELECTED = 0.85;
const HOVERED = 0.4;
const IDLE = 0.2;

/** Whether the window shows the page dots (more than one profile, not incognito). */
export function useProfileDotsShown() {
  const incognito = useIsIncognito();
  const count = useBrowser((s) => s.profileOrder.length);
  return !incognito && count > 1;
}

/**
 * Dia's space switcher: a dot per profile. The selected dot follows the pages while they move
 * (a swipe brightens the next dot as its page comes in); clicking a dot pages to that profile.
 */
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
  // Brightness follows how much of this profile's page is in view.
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
