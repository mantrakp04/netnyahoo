import { Symbol, showMenu, type MenuItem } from "@netnyahoo/shell";
import { Pressable, Text, View } from "react-native";
import { createProfile, switchProfile } from "../lib/actions";
import { PROFILE_COLORS, profileNameColor, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { useIsIncognito, useProfiles, useWindowId, useWindowProfile } from "../store/hooks";
import { setMeasuredWidth, useMeasuredWidth } from "./layout/measuredWidths";
import { useHover } from "./primitives";
import { openSettings } from "./settings/windows";

const PAD = 9;
const HEIGHT = 34;
const MIN_CUT_NAME = 52;
const ICON_WIDTH = 32;
export const PROFILE_INDICATOR_X = 84;

function useIndicator(room: number) {
  const theme = useTheme();
  const incognito = useIsIncognito();
  const profiles = useProfiles();
  const profile = useWindowProfile();
  const title = incognito ? "Incognito" : profile.name;
  const textWidth = useMeasuredWidth(`profile-name|${title}`);
  const shown = (incognito || profiles.length >= 2) && room >= ICON_WIDTH;
  const nameRoom = room - 2 * PAD;
  const showName = !!textWidth && (textWidth <= nameRoom || nameRoom >= MIN_CUT_NAME);
  const width = !shown ? 0 : showName ? Math.min(room, textWidth + 2 * PAD) : ICON_WIDTH;
  const color = incognito ? theme.textPrimary : profileNameColor(profile.color, theme.dark);
  return { incognito, title, textWidth, shown, showName, width, color };
}

/** The indicator's width at `room` (0 when it isn't shown), known before it lays out: the tab strip sizes its tabs by it. */
export const useProfileIndicatorWidth = (room: number) => useIndicator(room).width;

export function ProfileIndicator({ room }: { room: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const { hovered, hoverProps } = useHover();
  const { incognito, title, textWidth, shown, showName, width, color } = useIndicator(room);
  if (!shown) return null;

  return (
    <View {...hoverProps} tooltip={incognito ? undefined : "Switch between profiles"} style={{ marginTop: 0.5 }}>
      <View pointerEvents="none" style={{ position: "absolute", width: 1000, height: 0, overflow: "hidden", opacity: 0 }}>
        <Text
          numberOfLines={1}
          style={{ alignSelf: "flex-start", fontSize: 13, fontWeight: "600" }}
          onLayout={(e) => setMeasuredWidth(`profile-name|${title}`, Math.ceil(e.nativeEvent.layout.width))}
        >
          {title}
        </Text>
      </View>
      <Pressable onPress={() => !incognito && void openProfileMenu(windowId)} disabled={incognito}>
        {({ pressed }) => (
          <View
            style={{
              height: HEIGHT,
              width,
              borderRadius: 10,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: showName ? PAD : 0,
              backgroundColor: incognito ? undefined : pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
            }}
          >
            {showName ? (
              <Text numberOfLines={1} ellipsizeMode="tail" style={{ flexShrink: 1, fontSize: 13, fontWeight: "600", color }}>
                {title}
              </Text>
            ) : textWidth ? (
              <Symbol name="person.fill" size={14} weight="semibold" color={color} style={{ width: 16, height: 16 }} />
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

export async function openProfileMenu(windowId: string) {
  const s = useBrowser.getState();
  const current = s.windows[windowId]?.profileId;
  const items: MenuItem[] = [
    ...s.profileOrder.map((id, i) => ({
      id: `switch:${id}`,
      title: s.profiles[id]!.name,
      checked: id === current,
      swatch: PROFILE_COLORS[s.profiles[id]!.color]?.swatch,
      ...(i < 9 ? { key: String(i + 1), modifiers: ["control" as const] } : {}),
    })),
    { separator: true },
    { id: "new", title: "New Profile", symbol: "plus" },
    { id: "edit", title: "Edit Profiles…", symbol: "pencil" },
  ];
  const choice = await showMenu(items);
  if (!choice) return;
  if (choice.startsWith("switch:")) switchProfile(windowId, choice.slice("switch:".length), true);
  else if (choice === "new") {
    const id = await createProfile(windowId);
    if (id) switchProfile(windowId, id);
  } else if (choice === "edit") openSettings("profiles", current);
}
