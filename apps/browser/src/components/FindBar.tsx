import { Surface, Symbol } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { hex, useTheme } from "../lib/theme";
import { webviews } from "../lib/webviews";
import { useBrowser } from "../store/browser";
import { useFind } from "../store/hooks";
import type { FindState } from "../store/types";
import { IconButton, useHover } from "./primitives";
import { replaceInField } from "./site/selection";

/**
 * ⌘F: Dia's find bar, floating at the top-right of the page. Magnifier, field,
 * "active | total" counter (or "No results"), previous / next, close. Enter and
 * ⌘G go forward, ⇧Enter and ⇧⌘G back, Esc closes. Each tab keeps its own state.
 * ⌥⌘F adds a replace row for the page's focused text field.
 */
export function FindBar({ tabId }: { tabId: string }) {
  const hasPage = useBrowser((s) => !!s.tabs[tabId]?.url);
  const find = useFind(tabId);
  if (!find.open || !hasPage) return null;
  // Remount per tab so the field's focus and text follow the tab.
  return <FindBarPanel key={tabId} tabId={tabId} find={find} />;
}

/** The last ⌘F each tab's bar answered. */
const handledFocus = new Map<string, number>();

function FindBarPanel({ tabId, find }: { tabId: string; find: FindState }) {
  const theme = useTheme();
  const input = useRef<TextInput>(null);
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, []);
  // Each ⌘F: to the field with its text selected; a kept query finds again (like Chrome).
  // Showing the tab again (the pane remounts) isn't a new request.
  useEffect(() => {
    const request = find.focusRequest;
    if (!request || handledFocus.get(tabId) === request) return;
    handledFocus.set(tabId, request);
    input.current?.focus();
    input.current?.setSelection(0, find.query.length);
    if (find.query) void webviews.get(tabId)?.find(find.query, true, false);
  }, [find.focusRequest]);

  const setFind = (patch: Partial<FindState>) => useBrowser.getState().setFind(tabId, patch);
  // Chromium reports matches asynchronously through onFindResult (ContentCard).
  const run = (backwards: boolean, query = find.query, findNext = true) => {
    if (!query) setFind({ count: null, active: 0 });
    void webviews.get(tabId)?.find(query, !backwards, findNext);
  };
  const close = () => {
    setFind({ open: false, count: null, active: 0 });
    void webviews.get(tabId)?.stopFinding(false);
    void webviews.get(tabId)?.focus();
  };
  const [replacement, setReplacement] = useState("");
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 2200);
    return () => clearTimeout(timer);
  }, [note]);
  const replace = async (all: boolean) => {
    if (!find.query) return;
    const { field, count } = await replaceInField(tabId, find.query, replacement, all);
    if (!field) return setNote({ text: "Not in a text field", error: true });
    if (all || !count) setNote({ text: count ? `${count} replaced` : "No matches", error: !count });
    // Recount what's left on the page.
    run(false, find.query, false);
  };
  const none = find.count === 0 && !!find.query;
  const separator = theme.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"; // FindInPageSeparator
  const error = theme.dark ? "#FF6B63" : "#C93333"; // FindInPageError

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 10,
        right: 12,
        opacity: appear,
        transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
      }}
    >
      <Surface
        fill={hex(theme.panel)}
        cornerRadius={12}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={16}
        shadowOffset={[0, 6]}
        style={{ width: 340 }}
      >
        <View style={{ height: 40, flexDirection: "row", alignItems: "center", paddingLeft: 11, paddingRight: 4, gap: 2 }}>
          <Symbol name="magnifyingglass" size={13} color={theme.textSecondary} style={{ width: 16, height: 16, marginRight: 5 }} />
          <TextInput
            ref={input}
            autoFocus
            value={find.query}
            onChangeText={(query) => {
              setFind({ query });
              run(false, query, false);
            }}
            placeholder="Find on Page"
            placeholderTextColor={theme.placeholder}
            selectionColor={theme.selection}
            enableFocusRing={false}
            onSubmitEditing={() => run(false)}
            keyDownEvents={[{ key: "Escape" }, { key: "Enter", shiftKey: true }]}
            onKeyDown={(e) => {
              if (e.nativeEvent.key === "Escape") close();
              else if (e.nativeEvent.key === "Enter" && e.nativeEvent.shiftKey) run(true);
            }}
            style={{ flex: 1, fontSize: 14, color: theme.textPrimary, paddingVertical: 0 }}
          />
          {none ? (
            <Text style={{ fontSize: 12, color: error, marginRight: 6 }}>No results</Text>
          ) : find.count !== null && !!find.query ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginRight: 6 }}>
              <Text style={{ fontSize: 12, color: theme.textPrimary, fontVariant: ["tabular-nums"] }}>{find.active}</Text>
              <View style={{ width: StyleSheet.hairlineWidth * 2, height: 12, backgroundColor: separator }} />
              <Text style={{ fontSize: 12, color: theme.textSecondary, fontVariant: ["tabular-nums"] }}>{find.count}</Text>
            </View>
          ) : null}
          <IconButton icon="chevron.up" size={12} box={26} radius={6} disabled={!find.count} onPress={() => run(true)} tooltip="Previous (⇧⌘G)" />
          <IconButton icon="chevron.down" size={12} box={26} radius={6} disabled={!find.count} onPress={() => run(false)} tooltip="Next (⌘G)" />
          <View style={{ width: 1, height: 18, marginHorizontal: 3, backgroundColor: separator }} />
          <IconButton icon="xmark" size={11} box={26} radius={6} onPress={close} tooltip="Done (Esc)" />
        </View>
        {find.replace && <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: separator }} />}
        {find.replace && (
          <View style={{ height: 38, flexDirection: "row", alignItems: "center", paddingLeft: 11, paddingRight: 6, gap: 4 }}>
            <Symbol name="arrow.triangle.swap" size={12} color={theme.textSecondary} style={{ width: 16, height: 16, marginRight: 3 }} />
            <TextInput
              value={replacement}
              onChangeText={setReplacement}
              placeholder="Replace"
              placeholderTextColor={theme.placeholder}
              selectionColor={theme.selection}
              enableFocusRing={false}
              onSubmitEditing={() => void replace(false)}
              keyDownEvents={[{ key: "Escape" }]}
              onKeyDown={(e) => e.nativeEvent.key === "Escape" && close()}
              style={{ flex: 1, fontSize: 14, color: theme.textPrimary, paddingVertical: 0 }}
            />
            {note && <Text style={{ fontSize: 12, color: note.error ? error : theme.textSecondary, marginRight: 2 }}>{note.text}</Text>}
            <TextButton title="Replace" disabled={!find.query} onPress={() => void replace(false)} />
            <TextButton title="All" disabled={!find.query} onPress={() => void replace(true)} />
          </View>
        )}
      </Surface>
    </Animated.View>
  );
}

/** The replace row's buttons: text in a toolbar-style hover fill. */
function TextButton({ title, disabled, onPress }: { title: string; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} disabled={disabled}>
        {({ pressed }) => (
          <View
            style={{
              height: 26,
              paddingHorizontal: 8,
              borderRadius: 6,
              justifyContent: "center",
              backgroundColor: disabled ? undefined : pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : undefined,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "500", color: disabled ? theme.iconDisabled : theme.textPrimary }}>{title}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
