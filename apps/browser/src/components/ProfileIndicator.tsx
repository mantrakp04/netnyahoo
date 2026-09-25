import { FadeLabel, Symbol, showMenu, type MenuItem } from "@netnyahoo/shell";
import { Pressable, Text, View } from "react-native";
import { createProfile, deleteProfile, renameProfile, switchProfile } from "../lib/actions";
import { PROFILE_COLORS, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { useIsIncognito, useProfiles, useWindowId, useWindowProfile } from "../store/hooks";
import type { Profile, ProfileColor } from "../store/types";
import { useHover } from "./primitives";
import { iconMenuItems, ProfileBadge, profileSymbol } from "./profiles/icons";

/**
 * The window's profile, in the sidebar header next to Downloads. Like Dia it
 * only appears once there's more than one profile (or in an incognito window,
 * where it reads "Incognito"). Clicking it switches, creates and edits profiles.
 */
export function ProfileIndicator() {
  const theme = useTheme();
  const windowId = useWindowId();
  const incognito = useIsIncognito();
  const profiles = useProfiles();
  const profile = useWindowProfile();
  const { hovered, hoverProps } = useHover();
  if (!incognito && profiles.length < 2) return null;

  return (
    <View {...hoverProps} tooltip={incognito ? undefined : "Switch between profiles"} style={{ marginTop: 4, marginRight: 2 }}>
      <Pressable onPress={() => !incognito && void openProfileMenu(windowId)} disabled={incognito}>
        {({ pressed }) => (
          <View
            style={{
              height: 26,
              maxWidth: 70,
              borderRadius: 8,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 5,
              paddingRight: 7,
              gap: 5,
              backgroundColor: incognito ? undefined : pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : undefined,
            }}
          >
            {incognito ? (
              <Symbol name="eyeglasses" size={13} weight="medium" color={theme.icon} style={{ width: 16, height: 16 }} />
            ) : (
              <ProfileIcon profile={profile} />
            )}
            <FadeLabel text={profile.name} fontSize={12} weight="medium" color={theme.textTab} fadeWidth={12} style={{ flexShrink: 1, width: labelWidth(profile.name), height: 16 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

/** FadeLabel needs an explicit width; approximate the text's, capped by the pill. */
const labelWidth = (name: string) => Math.min(Math.ceil(name.length * 6.6), 44);

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
  if (choice.startsWith("switch:")) switchProfile(windowId, choice.slice("switch:".length));
  else if (choice === "new") {
    const id = await createProfile(windowId);
    if (id) switchProfile(windowId, id);
  } else if (choice === "rename") void renameProfile(profile.id, windowId);
  else if (choice.startsWith("color:")) s.updateProfile(profile.id, { color: choice.slice("color:".length) as ProfileColor });
  else if (choice.startsWith("icon:")) s.updateProfile(profile.id, { icon: choice.slice("icon:".length) || null });
  else if (choice === "default") s.setDefaultProfile(profile.id);
  else if (choice === "delete") void deleteProfile(profile.id, windowId);
}
