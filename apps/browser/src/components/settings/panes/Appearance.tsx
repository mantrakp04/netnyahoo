import { appIcons, currentAppIcon, isLiquidGlass, setAppearance, setAppIcon, Symbol, type AppIcon } from "@netnyahoo/shell";
import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import type { Settings } from "../../../store/settings";
import { useHover } from "../../primitives";
import { SectionHeader, useFormColors } from "../controls";

const MODES: { value: Settings["appearance"]; title: string; description: string }[] = [
  { value: "auto", title: "Automatic", description: "Follow the system appearance setting" },
  { value: "light", title: "Light", description: "Use the light application appearance" },
  { value: "dark", title: "Dark", description: "Use the dark application appearance" },
];

export function AppearancePane() {
  const appearance = useBrowser((s) => s.settings.appearance);
  const choose = (mode: Settings["appearance"]) => {
    useBrowser.getState().updateSettings({ appearance: mode });
    void setAppearance(mode);
  };
  return (
    <View>
      <SectionHeader title="Appearance Theme" description="Also in View › Appearance. Incognito windows are always dark." />
      <View style={{ flexDirection: "row", gap: 14 }}>
        {MODES.map((m) => (
          <ModeChoice key={m.value} mode={m.value} title={m.title} description={m.description} selected={appearance === m.value} onPress={() => choose(m.value)} />
        ))}
      </View>
      <SidebarStylePicker />
      <AddressBarPicker />
      <AppIconPicker />
    </View>
  );
}

/** The sidebar's material: Dia's tinted window, or Arc's layout on Liquid Glass (components/sidebar/Glass). */
function SidebarStylePicker() {
  const style = useBrowser((s) => s.settings.sidebarStyle);
  const topTabs = useBrowser((s) => s.settings.tabLayout === "top");
  const glass = isLiquidGlass();
  const choose = (value: Settings["sidebarStyle"]) => useBrowser.getState().updateSettings({ sidebarStyle: value });
  return (
    <>
      <SectionHeader
        title="Sidebar Style"
        description={[
          "Liquid Glass puts the sidebar on glass over your desktop, with Arc’s header and divider, and the page edge to edge.",
          glass ? null : "It needs macOS 26; on this Mac the sidebar uses the system’s sidebar material.",
          topTabs ? "With tabs across the top of the window, the window keeps Dia’s look." : null,
        ]
          .filter(Boolean)
          .join(" ")}
      />
      <View style={{ flexDirection: "row", gap: 14 }}>
        <SidebarStyleChoice value="dia" title="Dia" selected={style !== "glass"} onPress={() => choose("dia")} />
        <SidebarStyleChoice value="glass" title={glass ? "Liquid Glass" : "Liquid Glass (macOS 26)"} selected={style === "glass"} onPress={() => choose("glass")} />
      </View>
    </>
  );
}

/** A miniature window: Dia's tinted sidebar beside an inset page, or a glass sidebar beside a flush one. */
function SidebarStyleChoice({ value, title, selected, onPress }: { value: Settings["sidebarStyle"]; title: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const glass = value === "glass";
  const row = theme.dark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.12)";
  const tile = glass ? (theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)") : row;
  const page = theme.dark ? "#1A1618" : "#FFFFFF";
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: "center", gap: 7 }}>
      <View
        style={{
          width: "100%",
          height: 84,
          borderRadius: 9,
          overflow: "hidden",
          flexDirection: "row",
          borderWidth: selected ? 2.5 : 1,
          borderColor: selected ? colors.accent : colors.groupBorder,
          backgroundColor: glass ? (theme.dark ? "#3A3C42" : "#D3D6DB") : theme.dark ? "#2B2226" : "#EDE6EA",
        }}
      >
        <View style={{ width: "30%", padding: 5, gap: 3 }}>
          <View style={{ flexDirection: "row", gap: 2, marginBottom: 2 }}>
            {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
              <View key={c} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c }} />
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 2 }}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 2.5,
                  backgroundColor: glass && i === 0 ? (theme.dark ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.55)") : tile,
                  borderWidth: glass && i === 0 ? 0.5 : 0,
                  borderColor: theme.dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.12)",
                }}
              />
            ))}
          </View>
          {[0, 1].map((i) => (
            <View key={i} style={{ height: 4, borderRadius: 2, backgroundColor: row }} />
          ))}
          {glass ? <View style={{ height: 1, marginVertical: 1, backgroundColor: row }} /> : null}
          <View style={{ height: 4, borderRadius: 2, backgroundColor: row }} />
        </View>
        <View style={{ flex: 1, backgroundColor: page, ...(glass ? null : { margin: 5, marginLeft: 0, borderRadius: 4 }) }} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {selected && <Symbol name="checkmark.circle.fill" size={12} color={colors.accent} style={{ width: 14, height: 14 }} />}
        <Text style={{ fontSize: 12, color: selected ? theme.textPrimary : theme.textSecondary }}>{title}</Text>
      </View>
    </Pressable>
  );
}

/** Where the address bar and back / forward / reload go: the page's toolbar, or the top of the sidebar (Arc). */
function AddressBarPicker() {
  const addressBar = useBrowser((s) => s.settings.addressBar);
  const topTabs = useBrowser((s) => s.settings.tabLayout === "top");
  const choose = (value: Settings["addressBar"]) => useBrowser.getState().updateSettings({ addressBar: value });
  return (
    <>
      <SectionHeader
        title="Address Bar"
        description={
          topTabs
            ? "Tabs are across the top of the window, so the address bar stays in the toolbar. Also in View › Show Address Bar in Sidebar."
            : "In the sidebar, the page gets the toolbar’s height. While the sidebar is hidden, the address bar is in the toolbar. Also in View › Show Address Bar in Sidebar."
        }
      />
      <View style={{ flexDirection: "row", gap: 14 }}>
        <AddressBarChoice value="toolbar" title="In the toolbar" selected={addressBar !== "sidebar"} onPress={() => choose("toolbar")} />
        <AddressBarChoice value="sidebar" title="In the sidebar" selected={addressBar === "sidebar"} onPress={() => choose("sidebar")} />
      </View>
    </>
  );
}

/** A miniature window with the address bar over the page, or at the top of the sidebar. */
function AddressBarChoice({ value, title, selected, onPress }: { value: Settings["addressBar"]; title: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const bar = theme.dark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.16)";
  const field = theme.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)";
  const page = theme.dark ? "rgba(255,255,255,0.08)" : "#FFFFFF";
  const sidebar = value === "sidebar";
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: "center", gap: 7 }}>
      <View
        style={{
          width: "100%",
          height: 84,
          borderRadius: 9,
          padding: 6,
          flexDirection: "row",
          gap: 5,
          borderWidth: selected ? 2.5 : 1,
          borderColor: selected ? colors.accent : colors.groupBorder,
          backgroundColor: theme.dark ? "#2A2A2C" : "#E9E9EB",
        }}
      >
        <View style={{ width: "28%", gap: 3, paddingTop: sidebar ? 3 : 8 }}>
          {sidebar && <View style={{ height: 8, borderRadius: 3, marginBottom: 2, backgroundColor: field, borderWidth: 1, borderColor: colors.accent }} />}
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ height: 5, borderRadius: 2.5, backgroundColor: bar }} />
          ))}
        </View>
        <View style={{ flex: 1, borderRadius: 4, backgroundColor: page, overflow: "hidden" }}>
          {!sidebar && (
            <View style={{ height: 13, flexDirection: "row", alignItems: "center", paddingHorizontal: 5, gap: 5, borderBottomWidth: 1, borderBottomColor: field }}>
              <View style={{ width: 14, height: 4, borderRadius: 2, backgroundColor: bar }} />
              <View style={{ flex: 1, height: 7, borderRadius: 2.5, backgroundColor: field, borderWidth: 1, borderColor: colors.accent }} />
            </View>
          )}
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {selected && <Symbol name="checkmark.circle.fill" size={12} color={colors.accent} style={{ width: 14, height: 14 }} />}
        <Text style={{ fontSize: 12, color: selected ? theme.textPrimary : theme.textSecondary }}>{title}</Text>
      </View>
    </Pressable>
  );
}

/** Dia's App Icon section: the icon in the Dock and the app switcher (kept in the Dock after quitting). */
function AppIconPicker() {
  const [icons, setIcons] = useState<AppIcon[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([appIcons(ICON_SIZE), currentAppIcon()]).then(([list, id]) => {
      setIcons(list);
      setCurrent(id);
    });
  }, []);
  if (icons.length < 2) return null;
  const choose = (id: string) => {
    setCurrent(id);
    void setAppIcon(id);
  };
  return (
    <>
      <SectionHeader title="App Icon" description="Shown in the Dock and the app switcher. The Dock keeps it after you quit." />
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 6, rowGap: 10 }}>
        {icons.map((icon) => (
          <IconChoice key={icon.id} icon={icon} selected={icon.id === current} onPress={() => choose(icon.id)} />
        ))}
      </View>
    </>
  );
}

const ICON_SIZE = 56;

function IconChoice({ icon, selected, onPress }: { icon: AppIcon; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable onPress={onPress} {...hoverProps} style={{ width: 72, alignItems: "center", gap: 5 }} tooltip={icon.name}>
      <View
        style={{
          width: 70,
          height: 70,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2.5,
          borderColor: selected ? colors.accent : "transparent",
          backgroundColor: hovered && !selected ? colors.selected : "transparent",
        }}
      >
        {icon.preview ? <Image source={{ uri: icon.preview }} style={{ width: ICON_SIZE, height: ICON_SIZE }} /> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {selected && <Symbol name="checkmark.circle.fill" size={11} color={colors.accent} style={{ width: 13, height: 13 }} />}
        <Text numberOfLines={1} style={{ fontSize: 12, color: selected ? theme.textPrimary : theme.textSecondary }}>
          {icon.name}
        </Text>
      </View>
    </Pressable>
  );
}

/** A miniature window in each appearance (Automatic is half light, half dark). */
function ModeChoice({
  mode,
  title,
  description,
  selected,
  onPress,
}: {
  mode: Settings["appearance"];
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const window = (dark: boolean) => (
    <View style={{ flex: 1, backgroundColor: dark ? "#2B2226" : "#EDE6EA", padding: 6, flexDirection: "row", gap: 5 }}>
      <View style={{ width: "24%", gap: 3, paddingTop: 8 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ height: 5, borderRadius: 2.5, backgroundColor: dark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.12)" }} />
        ))}
      </View>
      <View style={{ flex: 1, borderRadius: 4, backgroundColor: dark ? "#1A1618" : "#FFFFFF" }} />
    </View>
  );
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: "center", gap: 7 }} tooltip={description}>
      <View
        style={{
          width: "100%",
          height: 84,
          borderRadius: 9,
          overflow: "hidden",
          flexDirection: "row",
          borderWidth: selected ? 2.5 : 1,
          borderColor: selected ? colors.accent : colors.groupBorder,
        }}
      >
        {mode === "auto" ? (
          <>
            {window(false)}
            {window(true)}
          </>
        ) : (
          window(mode === "dark")
        )}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {selected && <Symbol name="checkmark.circle.fill" size={12} color={colors.accent} style={{ width: 14, height: 14 }} />}
        <Text style={{ fontSize: 12, color: selected ? theme.textPrimary : theme.textSecondary }}>{title}</Text>
      </View>
    </Pressable>
  );
}
