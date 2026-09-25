import { cancelShortcutRecording, menuShortcuts, recordShortcut, Symbol, type MenuShortcut } from "@netnyahoo/shell";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { IconButton, useHover } from "../../primitives";
import { matchesQuery } from "../../pages/PageLayout";
import { Button, Group, PopUp, Row, SearchField, SectionHeader, useFormColors } from "../controls";

type Combo = { key: string; modifiers: string[] };
type Filter = "all" | "customized" | "conflicts";

const MOD_ORDER = ["control", "option", "shift", "command", "function"];
const MOD_GLYPH: Record<string, string> = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘", function: "🌐" };
const KEY_NAMES: Record<string, string> = {
  "\t": "⇥",
  "\r": "↩",
  "\u0003": "⌤",
  "\u0008": "⌫",
  "\u007f": "⌫",
  "": "⌦",
  "\u001b": "⎋",
  " ": "Space",
  "": "↑",
  "": "↓",
  "": "←",
  "": "→",
  "": "↖",
  "": "↘",
  "": "⇞",
  "": "⇟",
};

/** "⇧⌘B" for a menu key equivalent. */
export function formatShortcut({ key, modifiers }: Combo): string {
  if (!key) return "";
  const mods = MOD_ORDER.filter((m) => modifiers.includes(m)).map((m) => MOD_GLYPH[m]).join("");
  const code = key.charCodeAt(0);
  // F1–F20 are U+F704…
  const name = KEY_NAMES[key] ?? (code >= 0xf704 && code <= 0xf717 ? `F${code - 0xf703}` : key.toUpperCase());
  return mods + name;
}

const comboId = (c: Combo) => (c.key ? `${[...c.modifiers].sort().join("+")}+${c.key.toLowerCase()}` : "");

/** Keyboard Shortcuts: every menu action, remappable with conflict detection (Dia's pane). */
export function ShortcutsPane() {
  const theme = useTheme();
  const overrides = useBrowser((s) => s.settings.shortcuts);
  const [items, setItems] = useState<MenuShortcut[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [recording, setRecording] = useState<string | null>(null);

  useEffect(() => {
    void menuShortcuts().then(setItems);
    return () => void cancelShortcutRecording();
  }, []);

  const effective = (item: MenuShortcut): Combo => {
    const o = overrides[item.id];
    return o ? { key: o[0] ?? "", modifiers: o.slice(1) } : { key: item.defaultKey, modifiers: item.defaultModifiers };
  };

  // Every combo used by more than one action.
  const conflicts = useMemo(() => {
    const byCombo = new Map<string, MenuShortcut[]>();
    for (const item of items ?? []) {
      const id = comboId(effective(item));
      if (id) byCombo.set(id, [...(byCombo.get(id) ?? []), item]);
    }
    return byCombo;
  }, [items, overrides]);
  const conflictsOf = (item: MenuShortcut) => (conflicts.get(comboId(effective(item))) ?? []).filter((x) => x.id !== item.id);

  const setShortcut = (id: string, combo: Combo | null) => {
    const next = { ...useBrowser.getState().settings.shortcuts };
    if (combo) next[id] = [combo.key, ...combo.modifiers];
    else delete next[id];
    useBrowser.getState().updateSettings({ shortcuts: next });
  };

  const record = async (item: MenuShortcut) => {
    setRecording(item.id);
    const combo = await recordShortcut();
    setRecording(null);
    if (!combo) return;
    const isDefault = combo.key === item.defaultKey && comboId(combo) === comboId({ key: item.defaultKey, modifiers: item.defaultModifiers });
    setShortcut(item.id, isDefault ? null : combo);
  };

  const shown = (items ?? []).filter((item) => {
    if (!matchesQuery(query, item.title, item.path.join(" "), formatShortcut(effective(item)))) return false;
    if (filter === "customized") return !!overrides[item.id];
    if (filter === "conflicts") return conflictsOf(item).length > 0;
    return true;
  });
  const menus = [...new Set(shown.map((i) => i.path[0] ?? ""))];
  const customizedCount = Object.keys(overrides).length;

  return (
    <View>
      <Text style={{ marginTop: 20, fontSize: 12.5, lineHeight: 17, color: theme.textSecondary }}>
        Perform common actions in Netnyahoo faster and from anywhere. Select an action to customize its keyboard shortcut.
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 }}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search actions" style={{ flex: 1 }} />
        <PopUp
          value={filter}
          options={[
            { value: "all", title: "All Shortcuts" },
            { value: "customized", title: "Customized Shortcuts" },
            { value: "conflicts", title: "Conflicting Shortcuts" },
          ]}
          onChange={setFilter}
          minWidth={170}
        />
        <Button title="Reset All Shortcuts" disabled={!customizedCount} onPress={() => useBrowser.getState().updateSettings({ shortcuts: {} })} />
      </View>
      {items !== null && shown.length === 0 && (
        <Text style={{ marginTop: 30, textAlign: "center", fontSize: 13, color: theme.textTertiary }}>No matching actions</Text>
      )}
      {menus.map((menu) => (
        <View key={menu}>
          <SectionHeader title={menu} />
          <Group>
            {shown
              .filter((i) => (i.path[0] ?? "") === menu)
              .map((item) => {
                const others = conflictsOf(item);
                return (
                  <Row
                    key={item.id}
                    title={item.title}
                    description={
                      others.length ? (
                        <Text style={{ fontSize: 11.5, marginTop: 2, color: "#FF9F0A" }}>
                          {`${others.length === 1 ? "This shortcut conflicts with another shortcut:" : "This shortcut conflicts with other shortcuts:"} ${others.map((o) => o.title).join(", ")}`}
                        </Text>
                      ) : item.path.length > 1 ? (
                        item.path.slice(1).join(" › ")
                      ) : undefined
                    }
                  >
                    {overrides[item.id] && (
                      <IconButton icon="arrow.uturn.backward" size={11} box={24} radius={6} onPress={() => setShortcut(item.id, null)} tooltip="Reset to Default" />
                    )}
                    <ShortcutField
                      combo={effective(item)}
                      remappable={item.remappable}
                      recording={recording === item.id}
                      onRecord={() => void record(item)}
                      onClear={() => setShortcut(item.id, item.defaultKey ? { key: "", modifiers: [] } : null)}
                    />
                  </Row>
                );
              })}
          </Group>
        </View>
      ))}
    </View>
  );
}

function ShortcutField({
  combo,
  remappable,
  recording,
  onRecord,
  onClear,
}: {
  combo: Combo;
  remappable: boolean;
  recording: boolean;
  onRecord: () => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  const text = recording ? "Type Shortcut" : formatShortcut(combo);
  if (!remappable) {
    return (
      <View style={{ minWidth: 110, alignItems: "flex-end" }} tooltip="(not remappable)">
        <Text style={{ fontSize: 13, color: theme.textTertiary }}>{text || "—"}</Text>
      </View>
    );
  }
  return (
    <View {...hoverProps}>
      <Pressable onPress={onRecord}>
        <View
          style={{
            minWidth: 110,
            height: 24,
            paddingHorizontal: 8,
            borderRadius: 6,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            backgroundColor: recording ? `${colors.accent}33` : hovered ? colors.controlHover : colors.control,
            borderWidth: recording ? 1.5 : 1,
            borderColor: recording ? colors.accent : colors.controlBorder,
          }}
        >
          <Text style={{ flex: 1, textAlign: "center", fontSize: 13, color: recording ? colors.accent : text ? theme.textPrimary : theme.textTertiary }}>
            {text || "None"}
          </Text>
          {hovered && !recording && combo.key ? (
            <Pressable onPress={onClear} tooltip="Remove Shortcut">
              <Symbol name="xmark.circle.fill" size={11} color={theme.textTertiary} style={{ width: 14, height: 14 }} />
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}
