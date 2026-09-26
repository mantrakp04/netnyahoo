import { Symbol, VisualEffect, WindowDragRegion } from "@netnyahoo/shell";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { IconButton, useHover } from "../primitives";
import { useFormColors } from "./controls";
import { AdvancedPane } from "./panes/Advanced";
import { AppearancePane } from "./panes/Appearance";
import { CalendarPane } from "./panes/Calendar";
import { GeneralPane } from "./panes/General";
import { LiveFoldersPane } from "./panes/LiveFolders";
import { ExtensionsPane } from "./panes/Extensions";
import { PasswordsPane } from "./panes/Passwords";
import { AutofillPane } from "./panes/Autofill";
import { PrivacyPane } from "./panes/Privacy";
import { ProfileDetailsPane, ProfilesPane } from "./panes/Profiles";
import { SearchPane } from "./panes/Search";
import { ShortcutsPane } from "./panes/Shortcuts";
import { SyncPane } from "./panes/Sync";
import { TabsPane } from "./panes/Tabs";
import { useSettingsSheet } from "./sheet";
import { useSettingsNav, type SettingsPane } from "./windows";

/** Sidebar entries, in Dia's order (its AI, account and billing panes aren't part of Netnyahoo). */
const PANES: { id: SettingsPane; title: string; icon: string }[] = [
  { id: "general", title: "General", icon: "gearshape" },
  { id: "profiles", title: "Profiles", icon: "person.2" },
  { id: "sync", title: "Sync", icon: "arrow.triangle.2.circlepath" },
  { id: "tabs", title: "Tabs", icon: "square.on.square" },
  { id: "appearance", title: "Appearance", icon: "circle.lefthalf.filled" },
  { id: "privacy", title: "Privacy & Security", icon: "hand.raised" },
  { id: "passwords", title: "Passwords", icon: "key" },
  { id: "autofill", title: "Autofill", icon: "creditcard" },
  { id: "extensions", title: "Extensions", icon: "puzzlepiece.extension" },
  { id: "search", title: "Search Engine", icon: "magnifyingglass" },
  { id: "shortcuts", title: "Keyboard Shortcuts", icon: "keyboard" },
  { id: "liveFolders", title: "Live Folders", icon: "dot.radiowaves.left.and.right" },
  { id: "calendar", title: "Calendar", icon: "calendar" },
  { id: "advanced", title: "Advanced", icon: "slider.horizontal.3" },
];

const SIDEBAR = 214;
const TOOLBAR = 52;

/** Settings (⌘,): Dia's sidebar-navigated window, with back/forward and the pane title in the toolbar. */
export function SettingsWindow() {
  const theme = useTheme();
  const nav = useSettingsNav();
  const profileName = useBrowser((s) => (nav.profileId ? s.profiles[nav.profileId]?.name : undefined));
  const title = nav.pane === "profiles" && profileName ? profileName : PANES.find((p) => p.id === nav.pane)!.title;
  const sheet = useSettingsSheet((s) => s.sheet);

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: theme.dark ? "#1E1E1E" : "#F2F2F2" }}>
      <View style={{ width: SIDEBAR }}>
        <VisualEffect material="sidebar" blendingMode="behindWindow" style={StyleSheet.absoluteFill} />
        <WindowDragRegion style={{ height: TOOLBAR }} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 12, gap: 1 }}>
          {PANES.map((p) => (
            <SidebarItem key={p.id} title={p.title} icon={p.icon} selected={nav.pane === p.id} onPress={() => nav.go(p.id)} />
          ))}
        </ScrollView>
      </View>
      <View style={{ width: StyleSheet.hairlineWidth * 2, backgroundColor: theme.dark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.1)" }} />
      <View style={{ flex: 1 }}>
        <View style={{ height: TOOLBAR, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 2 }}>
          <WindowDragRegion style={StyleSheet.absoluteFill} />
          <IconButton icon="chevron.left" size={13} box={28} radius={6} disabled={!nav.back.length} onPress={nav.goBack} tooltip="Back" />
          <IconButton icon="chevron.right" size={13} box={28} radius={6} disabled={!nav.forward.length} onPress={nav.goForward} tooltip="Forward" />
          <Text style={{ marginLeft: 8, fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{title}</Text>
        </View>
        <ScrollView key={`${nav.pane}:${nav.profileId}`} contentContainerStyle={{ alignItems: "center", paddingBottom: 40 }}>
          <View style={{ width: "100%", maxWidth: 600, paddingHorizontal: 24 }}>
            <Pane pane={nav.pane} profileId={nav.profileId} />
          </View>
        </ScrollView>
      </View>
      {sheet}
    </View>
  );
}

function Pane({ pane, profileId }: { pane: SettingsPane; profileId: string | null }): ReactNode {
  switch (pane) {
    case "general":
      return <GeneralPane />;
    case "profiles":
      return profileId ? <ProfileDetailsPane profileId={profileId} /> : <ProfilesPane />;
    case "sync":
      return <SyncPane />;
    case "tabs":
      return <TabsPane />;
    case "appearance":
      return <AppearancePane />;
    case "privacy":
      return <PrivacyPane />;
    case "passwords":
      return <PasswordsPane profileId={profileId} />;
    case "autofill":
      return <AutofillPane profileId={profileId} />;
    case "extensions":
      return <ExtensionsPane />;
    case "search":
      return <SearchPane />;
    case "shortcuts":
      return <ShortcutsPane />;
    case "liveFolders":
      return <LiveFoldersPane />;
    case "calendar":
      return <CalendarPane />;
    case "advanced":
      return <AdvancedPane />;
  }
}

function SidebarItem({ title, icon, selected, onPress }: { title: string; icon: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <View
          style={{
            height: 30,
            borderRadius: 7,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 8,
            gap: 9,
            backgroundColor: selected ? colors.accent : hovered ? colors.selected : undefined,
          }}
        >
          <Symbol name={icon} size={13} color={selected ? "#FFFFFF" : theme.icon} style={{ width: 20, height: 20 }} />
          <Text style={{ fontSize: 13, color: selected ? "#FFFFFF" : theme.textPrimary }}>{title}</Text>
        </View>
      </Pressable>
    </View>
  );
}
