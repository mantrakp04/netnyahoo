import { appIcons, currentAppIcon, setAppearance, setAppIcon, Symbol, type AppIcon } from "@netnyahoo/shell";
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
      <AppIconPicker />
    </View>
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
