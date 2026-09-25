import { FadeLabel, Symbol, showMenu, type MenuItem } from "@netnyahoo/shell";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { createProfile, deleteProfile, renameProfile, switchProfile } from "../lib/actions";
import { PROFILE_COLORS, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { useIsIncognito, useProfiles, useWindowId, useWindowProfile } from "../store/hooks";
import type { Profile, ProfileColor } from "../store/types";
import { useHover } from "./primitives";
import { iconMenuItems, ProfileBadge, profileSymbol } from "./profiles/icons";

/** The pill around the name: 5 pt in, the 16 pt icon, 5 pt, the name, 5 pt (7 pt after the text: FadeLabel pads it 2 pt). */
const PILL_OVERHEAD = 5 + 16 + 5 + 5;
/** Dia's SidebarProfileIndicatorButton shows a name cut short only if 52 pt of it fit; else just the icon. */
const MIN_CUT_NAME = 52;

/**
 * The window's profile, in the sidebar header next to Downloads. Like Dia it
 * only appears once there's more than one profile (or in an incognito window,
 * where it reads "Incognito"). Clicking it switches, creates and edits profiles.
 * `room`: the width the pill may take (the header between the traffic lights and Downloads).
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
  // Not even the icon fits beside back / forward / reload (address bar in the sidebar): hidden, the footer's dots still switch profiles.
  if (room < PILL_OVERHEAD - 5) return null;
  // The whole name when it fits; cut short (fading) when at least 52 pt of it fit; else only the icon.
  // FadeLabel's text field pads the text 2 pt on each side.
  const textWidth = measured?.text === profile.name ? measured.width + 4 : 0;
  const nameRoom = Math.max(0, room - PILL_OVERHEAD);
  const showName = textWidth > 0 && (textWidth <= nameRoom || nameRoom >= MIN_CUT_NAME);

  return (
    <View {...hoverProps} tooltip={incognito ? undefined : "Switch between profiles"} style={{ marginTop: 4, marginRight: 2 }}>
      {/* Measures the name at the label's font (FadeLabel needs an explicit width). */}
      <View pointerEvents="none" style={{ position: "absolute", width: 1000, height: 0, overflow: "hidden", opacity: 0 }}>
        <Text
          numberOfLines={1}
          style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: "500" }}
          onLayout={(e) => setMeasured({ text: profile.name, width: Math.ceil(e.nativeEvent.layout.width) })}
        >
          {profile.name}
        </Text>
      </View>
      <Pressable onPress={() => !incognito && void openProfileMenu(windowId)} disabled={incognito}>
        {({ pressed }) => (
          <View
            style={{
              height: 26,
              borderRadius: 8,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 5,
              paddingRight: 5,
              gap: 5,
              backgroundColor: incognito ? undefined : pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : undefined,
            }}
          >
            {incognito ? (
              <Symbol name="eyeglasses" size={13} weight="medium" color={theme.icon} style={{ width: 16, height: 16 }} />
            ) : (
              <ProfileIcon profile={profile} />
            )}
            {showName ? (
              <FadeLabel text={profile.name} fontSize={12} weight="medium" color={theme.textTab} fadeWidth={12} style={{ width: Math.min(textWidth, nameRoom), height: 16 }} />
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

async function openProfileMenu(windowId: string) {
  const s = useBrowser.getState();
  const current = s.windows[windowId]?.profileId;
  const profile = current ? s.profiles[current] : undefined;
  if (!profile) return;
  const colors = Object.keys(PROFILE_COLORS) as ProfileColor[];
  const items: MenuItem[] = [
    ...s.profileOrder.map((id, i) => ({
      id: `switch:${id}`,
      title: s.profiles[id]!.name,
      checked: id === current,
      swatch: PROFILE_COLORS[s.profiles[id]!.color]?.swatch,
      ...(i < 9 ? { key: String(i + 1), modifiers: ["control" as const] } : {}),
    })),
    { separator: true },
    { id: "new", title: "New Profile…", symbol: "plus" },
    {
      id: "edit",
      title: `Edit “${profile.name}”`,
      symbol: "pencil",
      children: [
        { id: "rename", title: "Rename…" },
        {
          id: "color",
          title: "Theme Color",
          children: colors.map((c) => ({ id: `color:${c}`, title: PROFILE_COLORS[c].name, swatch: PROFILE_COLORS[c].swatch, checked: profile.color === c })),
        },
        { id: "icon", title: "Icon", children: iconMenuItems(profile.icon) },
        { id: "default", title: "Make Default Profile", checked: s.settings.defaultProfileId === profile.id, enabled: s.settings.defaultProfileId !== profile.id },
        { separator: true },
        { id: "delete", title: "Delete Profile…", enabled: s.profileOrder.length > 1 },
      ],
    },
  ];
  const choice = await showMenu(items);
  if (!choice) return;
  if (choice.startsWith("switch:")) switchProfile(windowId, choice.slice("switch:".length), true);
  else if (choice === "new") {
    const id = await createProfile(windowId);
    if (id) switchProfile(windowId, id);
  } else if (choice === "rename") void renameProfile(profile.id, windowId);
  else if (choice.startsWith("color:")) s.updateProfile(profile.id, { color: choice.slice("color:".length) as ProfileColor });
  else if (choice.startsWith("icon:")) s.updateProfile(profile.id, { icon: choice.slice("icon:".length) || null });
  else if (choice === "default") s.setDefaultProfile(profile.id);
  else if (choice === "delete") void deleteProfile(profile.id, windowId);
}
