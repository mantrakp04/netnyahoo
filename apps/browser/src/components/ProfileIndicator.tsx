import { Symbol, showMenu, type MenuItem } from "@netnyahoo/shell";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { createProfile, switchProfile } from "../lib/actions";
import { PROFILE_COLORS, profileNameColor, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { useIsIncognito, useProfiles, useWindowId, useWindowProfile } from "../store/hooks";
import type { Profile } from "../store/types";
import { useHover } from "./primitives";
import { ProfileBadge, profileSymbol } from "./profiles/icons";
import { openSettings } from "./settings/windows";

/** Dia's SidebarProfileIndicatorButton: 9 pt either side of the name (contentInsets), 34 pt tall, radius 10. */
const PAD = 9;
const HEIGHT = 34;
/** Shows a name cut short (…) only if 52 pt of it fit; else the 14 pt `person.fill` in a 32 pt button. */
const MIN_CUT_NAME = 52;
const ICON_WIDTH = 32;
/**
 * Where the header's stack puts it: 6 pt after the window controls' view, so the name's ink starts at
 * x 94 as in a 2× capture of Dia 1.50.1 (RN's text sets its ink 1 pt further in than Dia's label).
 */
export const PROFILE_INDICATOR_X = 84;

/**
 * The window's profile name, in the sidebar header right of the traffic lights (Dia 1.50's
 * SidebarProfileIndicatorButton): 13 pt semibold in the profile's colour (lib/theme
 * `profileNameColor`), no background until hovered. Like Dia it only appears once there's more than
 * one profile (a 1.50.1 window with one profile has none, one with two shows it), or in an incognito
 * window ("Incognito", in the label colour, no menu). Clicking lists the profiles, New Profile and
 * Edit Profiles…. `room`: the width it may take.
 */
export function ProfileIndicator({ room }: { room: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const incognito = useIsIncognito();
  const profiles = useProfiles();
  const profile = useWindowProfile();
  const { hovered, hoverProps } = useHover();
  const [measured, setMeasured] = useState<{ text: string; width: number } | null>(null);
  if (!incognito && profiles.length < 2) return null;
  if (room < ICON_WIDTH) return null;
  const title = incognito ? "Incognito" : profile.name;
  const color = incognito ? theme.textPrimary : profileNameColor(profile.color, theme.dark);
  const textWidth = measured?.text === title ? measured.width : 0;
  const nameRoom = room - 2 * PAD;
  const showName = textWidth > 0 && (textWidth <= nameRoom || nameRoom >= MIN_CUT_NAME);

  return (
    // 0.5 pt lower than the 34 pt header row's centre puts its baseline on Dia's (y 32).
    <View {...hoverProps} tooltip={incognito ? undefined : "Switch between profiles"} style={{ marginTop: 0.5 }}>
      {/* Measures the name at the label's font. */}
      <View pointerEvents="none" style={{ position: "absolute", width: 1000, height: 0, overflow: "hidden", opacity: 0 }}>
        <Text
          numberOfLines={1}
          style={{ alignSelf: "flex-start", fontSize: 13, fontWeight: "600" }}
          onLayout={(e) => setMeasured({ text: title, width: Math.ceil(e.nativeEvent.layout.width) })}
        >
          {title}
        </Text>
      </View>
      <Pressable onPress={() => !incognito && void openProfileMenu(windowId)} disabled={incognito}>
        {({ pressed }) => (
          <View
            style={{
              height: HEIGHT,
              width: showName ? Math.min(room, textWidth + 2 * PAD) : ICON_WIDTH,
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
            ) : textWidth > 0 ? (
              <Symbol name="person.fill" size={14} weight="semibold" color={color} style={{ width: 16, height: 16 }} />
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

/** The profile's emoji, or its symbol / initial on its theme colour. */
export function ProfileIcon({ profile, size = 16 }: { profile: Profile; size?: number }) {
  if (profile.icon && !profileSymbol(profile.icon)) {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size - 3 }}>{profile.icon}</Text>
      </View>
    );
  }
  return (
    <View style={{ margin: 1 }}>
      <ProfileBadge profile={profile} size={size - 2} />
    </View>
  );
}

/** Dia's profile menu: each profile (checkmark, colour swatch, ⌃1…⌃9), New Profile, Edit Profiles…. */
async function openProfileMenu(windowId: string) {
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
