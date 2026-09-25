import { Surface, Symbol } from "@netnyahoo/shell";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { useLive } from "../../live/store";
import { useBrowser } from "../../store/browser";
import { setIcon } from "./actions";
import { setSidebarUi, useSidebarUi } from "./state";
import { SYMBOL_PREFIX } from "./TabIcon";
import { useSidebarTokens } from "./tokens";

/** Emoji with search words (Dia's picker has emoji and icons). */
const EMOJI: [string, string][] = [
  ["⭐️", "star favorite"], ["🔥", "fire hot"], ["❤️", "heart love"], ["✅", "check done"], ["📌", "pin"], ["🚀", "rocket launch ship"],
  ["💡", "idea bulb"], ["📝", "note memo write"], ["📚", "books read study"], ["📖", "book read"], ["🎓", "school graduate"], ["💼", "work briefcase"],
  ["🏠", "home house"], ["🛒", "shopping cart"], ["💰", "money"], ["💳", "card pay"], ["📈", "chart growth stocks"], ["📊", "chart data"],
  ["🗓️", "calendar date"], ["⏰", "alarm time"], ["📧", "email mail"], ["💬", "chat message"], ["📞", "phone call"], ["🎥", "video camera"],
  ["🎵", "music song"], ["🎧", "headphones music"], ["🎮", "game play"], ["🎨", "art design paint"], ["📷", "photo camera"], ["🎬", "movie film"],
  ["📺", "tv watch"], ["🍿", "popcorn movie"], ["✈️", "travel plane"], ["🗺️", "map travel"], ["🏖️", "beach holiday"], ["🌍", "world earth globe"],
  ["🍕", "pizza food"], ["🍔", "burger food"], ["☕️", "coffee"], ["🍷", "wine"], ["🍎", "apple fruit"], ["🥗", "salad food healthy"],
  ["🏋️", "gym fitness"], ["⚽️", "football soccer sport"], ["🏀", "basketball sport"], ["🚴", "bike cycling"], ["🧘", "yoga calm"], ["💊", "health pill"],
  ["🐶", "dog pet"], ["🐱", "cat pet"], ["🦊", "fox"], ["🐼", "panda"], ["🦄", "unicorn"], ["🐙", "octopus github"],
  ["🌱", "plant grow"], ["🌸", "flower blossom"], ["🌈", "rainbow"], ["☀️", "sun"], ["🌙", "moon night"], ["❄️", "snow cold"],
  ["⚡️", "lightning fast"], ["💎", "gem diamond"], ["🎁", "gift present"], ["🎉", "party celebrate"], ["🏆", "trophy win"], ["🎯", "target goal"],
  ["🧠", "brain think"], ["👀", "eyes look"], ["🤖", "robot ai bot"], ["👾", "alien game"], ["💻", "laptop computer code"], ["🖥️", "desktop computer"],
  ["⌨️", "keyboard type"], ["🛠️", "tools build"], ["⚙️", "settings gear"], ["🔧", "wrench fix"], ["🧪", "test lab science"], ["🔬", "science research"],
  ["🐛", "bug"], ["🔒", "lock secure"], ["🔑", "key"], ["🧩", "puzzle extension"], ["📦", "package box"], ["🗂️", "folder files"],
  ["📁", "folder"], ["🗃️", "archive"], ["📰", "news paper"], ["🔗", "link"], ["🔍", "search find"], ["🧭", "compass explore"],
  ["🏷️", "tag label"], ["💭", "thought"], ["❓", "question"], ["❗️", "important"], ["⚠️", "warning"], ["🚧", "construction wip"],
  ["🟥", "red square"], ["🟧", "orange square"], ["🟨", "yellow square"], ["🟩", "green square"], ["🟦", "blue square"], ["🟪", "purple square"],
  ["🔴", "red circle"], ["🟠", "orange circle"], ["🟡", "yellow circle"], ["🟢", "green circle"], ["🔵", "blue circle"], ["🟣", "purple circle"],
];

const SYMBOLS = [
  "star", "heart", "bookmark", "flag", "pin", "bolt", "flame", "leaf", "globe", "house", "briefcase", "cart", "bag", "creditcard",
  "dollarsign.circle", "chart.bar", "chart.line.uptrend.xyaxis", "calendar", "clock", "alarm", "envelope", "bubble.left", "phone", "video",
  "music.note", "headphones", "gamecontroller", "paintbrush", "camera", "film", "tv", "airplane", "map", "car", "fork.knife", "cup.and.saucer",
  "figure.run", "sportscourt", "pawprint", "tree", "sun.max", "moon", "cloud", "snowflake", "sparkles", "gift", "trophy", "target", "brain",
  "eye", "laptopcomputer", "desktopcomputer", "keyboard", "hammer", "wrench.and.screwdriver", "gearshape", "testtube.2", "ant", "lock",
  "key", "puzzlepiece", "shippingbox", "folder", "archivebox", "newspaper", "link", "magnifyingglass", "safari", "tag", "lightbulb",
  "questionmark.circle", "exclamationmark.triangle", "book", "graduationcap", "doc.text", "list.bullet", "checkmark.circle", "person.2",
];

const COLUMNS = 8;
const CELL = 30;
const WIDTH = COLUMNS * CELL + 16;

/** Change Icon…: emoji or SF Symbol for a tab or group, next to its row. */
export function IconPicker({ windowId, sidebarWidth }: { windowId: string; sidebarWidth: number }) {
  const picker = useSidebarUi((u) => (u.iconPicker?.windowId === windowId ? u.iconPicker : null));
  return picker ? <PickerPanel key={picker.id} picker={picker} sidebarWidth={sidebarWidth} /> : null;
}

type Picker = NonNullable<ReturnType<typeof useSidebarUi.getState>["iconPicker"]>;

function PickerPanel({ picker, sidebarWidth }: { picker: Picker; sidebarWidth: number }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const liveIcon = useLive((s) => (picker.kind === "live" ? s.folders[picker.id.split("|")[1] ?? ""]?.icon : null));
  const current = useBrowser((s) => (picker.kind === "tab" ? s.tabs[picker.id]?.customIcon : picker.kind === "live" ? liveIcon : s.groups[picker.id]?.icon) ?? null);
  const [tab, setTab] = useState<"emoji" | "symbols">(current?.startsWith(SYMBOL_PREFIX) ? "symbols" : "emoji");
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tab === "emoji"
      ? EMOJI.filter(([, words]) => !q || words.includes(q)).map(([e]) => e)
      : SYMBOLS.filter((name) => !q || name.includes(q)).map((name) => SYMBOL_PREFIX + name);
  }, [tab, query]);
  const close = () => setSidebarUi({ iconPicker: null });
  const choose = (icon: string | null) => {
    setIcon(picker, icon);
    close();
  };
  const top = Math.max(8, (picker.anchor?.y ?? 60) - 8);
  const left = picker.anchor ? Math.max(8, Math.min(sidebarWidth + 6, picker.anchor.x + picker.anchor.width + 6)) : sidebarWidth + 6;

  return (
    <>
      {/* Clicking anywhere else dismisses it. */}
      <Pressable onPress={close} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      <Surface
        fill={hex(theme.panel)}
        cornerRadius={14}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={20}
        shadowOffset={[0, 8]}
        style={{ position: "absolute", top, left, width: WIDTH, padding: 8, gap: 8 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ flex: 1, height: 26, borderRadius: 8, backgroundColor: theme.urlPill, flexDirection: "row", alignItems: "center", paddingHorizontal: 7 }}>
            <Symbol name="magnifyingglass" size={11} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder={tab === "emoji" ? "Search emoji" : "Search icons"}
              placeholderTextColor={theme.placeholder}
              enableFocusRing={false}
              keyDownEvents={[{ key: "Escape" }]}
              onKeyDown={(e) => e.nativeEvent.key === "Escape" && close()}
              onSubmitEditing={() => items[0] && choose(items[0])}
              style={{ flex: 1, fontSize: 12, marginLeft: 5, color: theme.textPrimary, paddingVertical: 0 }}
            />
          </View>
          {(["emoji", "symbols"] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)}>
              <View style={{ width: 28, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: tab === t ? tokens.pickerCellHover : undefined }}>
                <Symbol name={t === "emoji" ? "face.smiling" : "star.square.on.square"} size={13} color={theme.icon} style={{ width: 16, height: 16 }} />
              </View>
            </Pressable>
          ))}
        </View>
        <ScrollView style={{ maxHeight: CELL * 6 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {items.map((icon) => (
              <Cell key={icon} icon={icon} selected={icon === current} onPress={() => choose(icon)} />
            ))}
            {items.length === 0 ? <Text style={{ padding: 8, fontSize: 12, color: theme.textTertiary }}>No matches</Text> : null}
          </View>
        </ScrollView>
        {current ? (
          <Pressable onPress={() => choose(null)}>
            {({ pressed }) => (
              <View style={{ height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? tokens.pickerCellHover : theme.urlPill }}>
                <Text style={{ fontSize: 12, color: theme.textPrimary }}>Reset Icon</Text>
              </View>
            )}
          </Pressable>
        ) : null}
      </Surface>
    </>
  );
}

function Cell({ icon, selected, onPress }: { icon: string; selected: boolean; onPress(): void }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable onPress={onPress}>
      <View
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: CELL,
          height: CELL,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: hovered || selected ? tokens.pickerCellHover : undefined,
        }}
      >
        {icon.startsWith(SYMBOL_PREFIX) ? (
          <Symbol name={icon.slice(SYMBOL_PREFIX.length)} size={15} color={theme.icon} style={{ width: 20, height: 20 }} />
        ) : (
          <Text style={{ fontSize: 18 }}>{icon}</Text>
        )}
      </View>
    </Pressable>
  );
}
