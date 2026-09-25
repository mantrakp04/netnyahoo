import { ContextMenuArea, hapticTick, showMenu, Symbol } from "@netnyahoo/shell";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { createProfile, deleteProfile } from "../../../lib/actions";
import { hex, PROFILE_COLORS, useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { useProfiles } from "../../../store/hooks";
import { plural } from "../../../store/model";
import { sharingProfiles } from "../../../store/profiles";
import type { Profile, ProfileColor } from "../../../store/types";
import { ClearDataDialog } from "../../pages/ClearDataDialog";
import { useHover } from "../../primitives";
import { ColorStack } from "../../profiles/CreateProfile";
import { iconMenuItems, PROFILE_SYMBOLS, ProfileBadge, profileSymbol } from "../../profiles/icons";
import { Button, Group, PopUp, Row, SectionHeader, TextField, useFormColors } from "../controls";
import { closeSettingsSheet, showSettingsSheet } from "../sheet";
import { useSettingsNav } from "../windows";

export { ProfileBadge };

/** "Personal and Work", "A, B, and C". */
const listOf = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`);

/** Everyone in a profile's shared-data set, itself included, in profile order (just itself when it shares nothing). */
function useSharedWith(profileId: string): string[] {
  const order = useBrowser((s) => s.profileOrder);
  const profiles = useBrowser((s) => s.profiles);
  return useMemo(() => {
    const others = sharingProfiles({ profiles, profileOrder: order }, profileId);
    return others.length ? order.filter((id) => id === profileId || others.includes(id)) : [profileId];
  }, [order, profiles, profileId]);
}

export function ProfilesPane() {
  const theme = useTheme();
  const profiles = useProfiles();
  const defaultId = useBrowser((s) => s.settings.defaultProfileId);

  return (
    <View>
      <Text style={{ marginTop: 20, fontSize: 12.5, lineHeight: 17, color: theme.textSecondary }}>
        Profiles keep your browsing organized — keep history, logins, cookies, and extensions separate per profile, or share them across selected
        profiles with a toggle.
      </Text>

      <SectionHeader title="New windows open with" />
      <Group>
        <Row title="Default profile" description="Used for new windows and links opened from other apps.">
          <PopUp
            value={defaultId}
            options={profiles.map((p) => ({ value: p.id, title: p.name }))}
            onChange={(id) => useBrowser.getState().setDefaultProfile(id)}
            minWidth={160}
          />
        </Row>
      </Group>

      <SectionHeader
        title="Profiles"
        description="Drag to reorder. ⌃1–⌃9 switch to the first nine."
        action={<Button title="Create Profile" icon="plus" onPress={() => void createProfile()} />}
      />
      <ProfileList />
    </View>
  );
}

const ROW_HEIGHT = 46;
const settle = (value: Animated.Value, toValue: number) =>
  Animated.timing(value, { toValue, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: false });

/**
 * The profile list, reordered by dragging a row (Dia's Profiles pane has a grabber on
 * each row). The dragged row follows the pointer; the others slide aside.
 */
function ProfileList() {
  const colors = useFormColors();
  const order = useBrowser((s) => s.profileOrder);
  const offsets = useRef(new Map<string, Animated.Value>()).current;
  const offsetOf = (id: string) => {
    let v = offsets.get(id);
    if (!v) offsets.set(id, (v = new Animated.Value(0)));
    return v;
  };
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef({ id: "", from: 0, to: 0, reorderPending: false });

  // After a reorder lands, rows snap back from their offsets in the same frame as the new order.
  useLayoutEffect(() => {
    if (!drag.current.reorderPending) return;
    drag.current.reorderPending = false;
    offsets.forEach((v) => v.setValue(0));
  }, [order]);

  const controller = useRef({
    start(id: string) {
      const ids = useBrowser.getState().profileOrder;
      const from = ids.indexOf(id);
      drag.current = { id, from, to: from, reorderPending: false };
      setDragging(id);
    },
    move(dy: number) {
      const { id, from } = drag.current;
      const ids = useBrowser.getState().profileOrder;
      const max = ids.length - 1;
      offsetOf(id).setValue(Math.max(-from * ROW_HEIGHT - 6, Math.min((max - from) * ROW_HEIGHT + 6, dy)));
      const to = Math.max(0, Math.min(max, Math.round(from + dy / ROW_HEIGHT)));
      if (to === drag.current.to) return;
      drag.current.to = to;
      hapticTick();
      ids.forEach((other, j) => {
        if (other === id) return;
        settle(offsetOf(other), from < j && j <= to ? -ROW_HEIGHT : to <= j && j < from ? ROW_HEIGHT : 0).start();
      });
    },
    end(commit: boolean) {
      const { id, from, to } = drag.current;
      setDragging(null);
      if (!commit || from === to) {
        offsets.forEach((v) => settle(v, 0).start());
        return;
      }
      const ids = useBrowser.getState().profileOrder.filter((x) => x !== id);
      ids.splice(to, 0, id);
      drag.current.reorderPending = true;
      useBrowser.getState().reorderProfiles(ids);
    },
  }).current;

  return (
    <View style={{ borderRadius: 10, backgroundColor: colors.group, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.groupBorder }}>
      {order.map((id, i) => (
        <ProfileRow key={id} profileId={id} first={i === 0} offset={offsetOf(id)} lifted={dragging === id} controller={controller} />
      ))}
    </View>
  );
}

type DragController = { start(id: string): void; move(dy: number): void; end(commit: boolean): void };

function ProfileRow({
  profileId,
  first,
  offset,
  lifted,
  controller,
}: {
  profileId: string;
  first: boolean;
  offset: Animated.Value;
  lifted: boolean;
  controller: DragController;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const profile = useBrowser((s) => s.profiles[profileId]);
  const isDefault = useBrowser((s) => s.settings.defaultProfileId === profileId);
  const shared = useSharedWith(profileId);
  const names = useBrowser(useShallow((s) => shared.filter((id) => id !== profileId).map((id) => s.profiles[id]?.name ?? "")));
  const { hovered, hoverProps } = useHover();
  const go = useSettingsNav((n) => n.go);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 3,
      onPanResponderGrant: () => controller.start(profileId),
      onPanResponderMove: (_, g) => controller.move(g.dy),
      onPanResponderRelease: () => controller.end(true),
      onPanResponderTerminate: () => controller.end(false),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;
  if (!profile) return null;

  const description = [isDefault ? "Default" : null, names.length ? `Shares data with ${listOf(names)}` : null].filter(Boolean).join(" · ");
  const openMenu = async () => {
    const s = useBrowser.getState();
    const choice = await showMenu([
      { id: "details", title: "Show Profile Details" },
      { id: "default", title: "Make Default Profile", enabled: !isDefault },
      { separator: true },
      { id: "delete", title: "Delete Profile…", enabled: s.profileOrder.length > 1 },
    ]);
    if (choice === "details") go("profiles", profileId);
    else if (choice === "default") s.setDefaultProfile(profileId);
    else if (choice === "delete") void deleteProfile(profileId);
  };

  return (
    <Animated.View
      {...pan.panHandlers}
      style={{
        zIndex: lifted ? 1 : 0,
        transform: [{ translateY: offset }],
        borderRadius: lifted ? 8 : 0,
        backgroundColor: lifted ? hex(theme.panel) : undefined,
        borderWidth: lifted ? StyleSheet.hairlineWidth * 2 : 0,
        borderColor: colors.groupBorder,
      }}
    >
      {!first && !lifted && <View style={{ height: StyleSheet.hairlineWidth * 2, marginHorizontal: 12, backgroundColor: colors.separator }} />}
      <ContextMenuArea onContextMenu={() => void openMenu()}>
        <View {...hoverProps}>
          <Pressable onPress={() => go("profiles", profileId)}>
            <View
              style={{
                height: ROW_HEIGHT - (first ? 0 : StyleSheet.hairlineWidth * 2),
                paddingLeft: 8,
                paddingRight: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                backgroundColor: hovered && !lifted ? colors.selected : undefined,
              }}
            >
              <View tooltip="Drag to reorder">
                <Symbol name="line.3.horizontal" size={11} color={theme.textTertiary} style={{ width: 14, height: 14 }} />
              </View>
              <ProfileBadge profile={profile} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: theme.textPrimary }}>{profile.name}</Text>
                {description ? <Text style={{ fontSize: 11.5, marginTop: 2, color: theme.textSecondary }}>{description}</Text> : null}
              </View>
              <Symbol name="chevron.right" size={11} weight="semibold" color={theme.textTertiary} style={{ width: 12, height: 14 }} />
            </View>
          </Pressable>
        </View>
      </ContextMenuArea>
    </Animated.View>
  );
}

/** What the icon row shows for the current icon. */
function iconTitle(icon: string | null): string {
  const symbol = profileSymbol(icon);
  if (symbol) return PROFILE_SYMBOLS.find((s) => s.name === symbol)?.title ?? "Symbol";
  return icon ?? "Initial";
}

/** Profiles › a profile: name, colour, icon, shared data, default, clear browsing data, delete. */
export function ProfileDetailsPane({ profileId }: { profileId: string }) {
  const theme = useTheme();
  const profile = useBrowser((s) => s.profiles[profileId]);
  const isDefault = useBrowser((s) => s.settings.defaultProfileId === profileId);
  const only = useBrowser((s) => s.profileOrder.length <= 1);
  const shared = useSharedWith(profileId);
  const sharedNames = useBrowser(useShallow((s) => shared.map((id) => s.profiles[id]?.name ?? "")));
  const sharedColors = useBrowser(useShallow((s) => shared.map((id) => PROFILE_COLORS[s.profiles[id]?.color ?? "plum"]?.swatch ?? "#888888")));
  const stats = useBrowser((s) => {
    const roots = s.bookmarks.roots[profileId];
    let bookmarks = 0;
    const walk = (id: string) => {
      const n = s.bookmarks.nodes[id];
      if (n?.kind === "url") bookmarks++;
      if (n?.kind === "folder") n.children.forEach(walk);
    };
    if (roots) [roots.bar, roots.other].forEach(walk);
    return `${plural((s.history[profileId] ?? []).length, "page")} in history · ${plural(bookmarks, "bookmark")}`;
  });
  const [name, setName] = useState(profile?.name ?? "");
  if (!profile) return null;
  const update = (patch: Partial<Pick<Profile, "name" | "color" | "icon">>) => useBrowser.getState().updateProfile(profileId, patch);
  const commitName = () => (name.trim() ? update({ name: name.trim() }) : setName(profile.name));
  const sharing = shared.length > 1;

  const pickIcon = async () => {
    const choice = await showMenu(iconMenuItems(profile.icon));
    if (choice?.startsWith("icon:")) update({ icon: choice.slice("icon:".length) || null });
  };

  return (
    <View>
      <View style={{ alignItems: "center", marginTop: 24, gap: 10 }}>
        <Pressable onPress={() => void pickIcon()} tooltip="Change Icon">
          <ProfileBadge profile={profile} size={64} />
        </Pressable>
        <Text style={{ fontSize: 12, color: theme.textSecondary }}>{stats}</Text>
      </View>

      <SectionHeader title="Profile" />
      <Group>
        <Row title="Name">
          <TextField value={name} onChangeText={setName} onSubmit={commitName} onBlur={commitName} style={{ width: 220 }} />
        </Row>
        <Row title="Icon" description={iconTitle(profile.icon)}>
          <Button title="Change…" onPress={() => void pickIcon()} />
        </Row>
        <Row title="Theme colour" description="Tints this profile's windows and New Tab page.">
          <View style={{ flexDirection: "row", gap: 7 }}>
            {(Object.keys(PROFILE_COLORS) as ProfileColor[]).map((c) => (
              <Pressable key={c} onPress={() => update({ color: c })} tooltip={PROFILE_COLORS[c].name}>
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    padding: 2,
                    borderWidth: 2,
                    borderColor: profile.color === c ? PROFILE_COLORS[c].swatch : "transparent",
                  }}
                >
                  <View style={{ flex: 1, borderRadius: 8, backgroundColor: PROFILE_COLORS[c].swatch }} />
                </View>
              </Pressable>
            ))}
          </View>
        </Row>
      </Group>

      <SectionHeader title="Data" />
      <Group>
        {sharing ? (
          <Row
            icon={<ColorStack colors={sharedColors} size={14} />}
            title="Shared data"
            description={`${listOf(sharedNames)} share Cookies, Passwords, Extensions, Bookmarks, and History. Each keeps its own tabs.`}
          />
        ) : null}
        <Row title="Make Default Profile" description={isDefault ? "New windows already open with this profile." : "Open new windows with this profile."}>
          <Button title="Make Default" disabled={isDefault} onPress={() => useBrowser.getState().setDefaultProfile(profileId)} />
        </Row>
        <Row
          title="Clear Browsing Data"
          description={sharing ? "History, cookies, site data and cached files, for every profile that shares them." : "History, cookies, site data and cached files for this profile."}
        >
          <Button title="Clear…" onPress={() => showSettingsSheet(<ClearDataDialog profileId={profileId} onClose={closeSettingsSheet} />)} />
        </Row>
        <Row
          title="Delete Selected Profile"
          description={only ? "You can't delete your only profile." : sharing ? "Removes its tabs. The data it shares stays." : "Removes its tabs, history, bookmarks and site data."}
        >
          <Button
            title="Delete…"
            kind="destructive"
            disabled={only}
            onPress={() =>
              void deleteProfile(profileId).then(() => {
                if (!useBrowser.getState().profiles[profileId]) useSettingsNav.getState().go("profiles");
              })
            }
          />
        </Row>
      </Group>
    </View>
  );
}
