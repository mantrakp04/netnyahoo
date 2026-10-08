import { displayUrl, type Suggestion } from "@netnyahoo/core";
import { Symbol } from "@netnyahoo/shell";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { Favicon, IconButton, useHover } from "../primitives";

export function SuggestionIcon({ suggestion: s, color }: { suggestion: Suggestion; color?: string }) {
  const theme = useTheme();
  const tint = color ?? theme.textSecondary;
  switch (s.kind) {
    case "page":
      return <Favicon url={s.url} favicon={s.favicon} />;
    case "create":
      return <Favicon url={`https://${s.site}`} />;
    case "search":
      return <Symbol name="magnifyingglass" size={13} color={tint} style={{ width: 16, height: 16 }} />;
    case "calc":
      return <Symbol name="equal.circle" size={14} color={tint} style={{ width: 16, height: 16 }} />;
    case "action":
      return <Symbol name={s.icon ?? "command"} size={13} color={tint} style={{ width: 16, height: 16 }} />;
  }
}

function labels(s: Suggestion): [string, string | null] {
  switch (s.kind) {
    case "page":
      if (s.tabId) return [s.title || displayUrl(s.url), "Switch to Tab"];
      return s.title ? [s.title, displayUrl(s.url)] : [displayUrl(s.url), null];
    case "search":
      return [s.query, null];
    case "calc":
      return [s.value, s.expression];
    case "action":
    case "create":
      return [s.title, null];
  }
}

export type RowActions = {
  choose(s: Suggestion): void;
  hover(index: number): void;
  remove(url: string): void;
};

export const SuggestionList = memo(function SuggestionList({
  items,
  selectedIndex,
  trailing,
  dropdown,
  actions,
}: {
  items: Suggestion[];
  selectedIndex: number;
  trailing: string | null;
  dropdown: boolean;
  actions: RowActions;
}) {
  if (!items.length) return null;
  return (
    <View style={{ paddingHorizontal: dropdown ? 6 : 9, paddingBottom: dropdown ? 6 : 2 }}>
      {items.map((s, i) => (
        <SuggestionRow
          key={i}
          index={i}
          suggestion={s}
          selected={i === selectedIndex}
          trailing={i === 0 ? trailing : null}
          actions={actions}
        />
      ))}
    </View>
  );
});

function sameSuggestion(a: Suggestion, b: Suggestion): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as (keyof Suggestion)[];
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

// A visited page row that isn't an open tab: the hover ✕ and ⇧⌦ remove it from history.
export const isRemovable = (s: Suggestion | undefined): s is Extract<Suggestion, { kind: "page" }> => s?.kind === "page" && !!s.visited && !s.tabId;

const SuggestionRow = memo(
  function SuggestionRow({
    suggestion: s,
    index,
    selected,
    trailing,
    actions,
  }: {
    suggestion: Suggestion;
    index: number;
    selected: boolean;
    trailing: string | null;
    actions: RowActions;
  }) {
    const theme = useTheme();
    const { hovered, hoverProps } = useHover();
    const [title, accessory] = labels(s);
    const hint = trailing ?? (s.kind === "action" ? s.hint : null);
    const onRemove = isRemovable(s) ? () => actions.remove(s.url) : undefined;
    const removable = !!onRemove && (hovered || selected);
    return (
      <View
        onMouseEnter={() => {
          hoverProps.onMouseEnter();
          actions.hover(index);
        }}
        onMouseLeave={hoverProps.onMouseLeave}
      >
        <Pressable onPress={() => actions.choose(s)}>
          <View
            style={{
              height: 35,
              marginVertical: 2.5,
              borderRadius: 11,
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 13,
              gap: 11,
              backgroundColor: selected ? theme.rowSelected : hovered ? theme.rowHover : undefined,
            }}
          >
            <SuggestionIcon suggestion={s} />
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, color: theme.textPrimary }}>
              {title}
              {accessory ? (
                <Text style={{ color: theme.textSecondary }}>
                  {" — "}
                  {accessory}
                </Text>
              ) : null}
            </Text>
            <View style={{ flex: 1 }} />
            {hint && !removable ? <Text style={{ fontSize: 12, color: theme.textTertiary }}>{hint}</Text> : null}
            {removable ? (
              <IconButton icon="xmark" size={10} box={22} radius={6} color={theme.textSecondary} tooltip="Remove from History" onPress={onRemove} />
            ) : null}
          </View>
        </Pressable>
      </View>
    );
  },
  (a, b) => a.index === b.index && a.selected === b.selected && a.trailing === b.trailing && a.actions === b.actions && sameSuggestion(a.suggestion, b.suggestion),
);
