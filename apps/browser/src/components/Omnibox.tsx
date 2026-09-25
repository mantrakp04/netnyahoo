import { displayUrl, resolveInput, searchUrl, scopedSearchUrl, type SearchScope, type Suggestion } from "@netnyahoo/core";
import { ContextMenuArea, Symbol, copyText, pickFiles, showMenu, startDictation } from "@netnyahoo/shell";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { useWindowId, useWindowProfileId } from "../store/hooks";
import { activeTabId, viewTabIds } from "../store/model";
import { defaultSearchEngine } from "../store/settings";
import { runBarAction } from "./omnibox/actions";
import { useOmniboxDriver } from "./omnibox/devDriver";
import { registerHeroBar, savedNtpQuery, saveNtpQuery, type BarSnapshot } from "./omnibox/barState";
import { dispositionFor, openFromBar, switchFromBar, type Disposition } from "./omnibox/open";
import { clipboardPasteAction, pasteMenuItem, pasteTarget, readClipboard } from "./omnibox/paste";
import { ScopeChip } from "./omnibox/ScopeChip";
import { SuggestionIcon, SuggestionRow } from "./omnibox/SuggestionRow";
import { useInlineCompletion } from "./omnibox/useInlineCompletion";
import { scopeFor, useSuggestions } from "./omnibox/useSuggestions";
import { IconButton, useHover } from "./primitives";

type Variant = "panel" | "hero";
type Selection = { start: number; end: number };

/** Keys the bar handles itself (the text field never sees them). */
const BASE_KEYS = [
  { key: "Escape" },
  { key: "ArrowUp" },
  { key: "ArrowDown" },
  { key: "Tab" },
  // ⌃N / ⌃P move through the rows, as in every macOS text field.
  { key: "n", ctrlKey: true },
  { key: "p", ctrlKey: true },
  // ⌘↩ / ⌥↩ new tab, ⇧⌘↩ force search, ⇧↩ new window, ⌃↩ www.….com. Plain ↩ submits.
  { key: "Enter", metaKey: true },
  { key: "Enter", altKey: true },
  { key: "Enter", shiftKey: true },
  { key: "Enter", ctrlKey: true },
];
const SCOPE_KEYS = [...BASE_KEYS, { key: "Backspace" }];

/**
 * Dia's command bar. `panel` is the one anchored over the toolbar (URL click, ⌘L); `hero` is
 * the New Tab page bar. Both share suggestions and keyboard handling, and open things in `tabId`.
 */
export function Omnibox({
  variant,
  tabId,
  initialText = "",
  onCancel,
}: {
  variant: Variant;
  /** The tab the bar navigates (the active tab for the panel, the New Tab page's tab). */
  tabId: string;
  initialText?: string;
  onCancel?(): void;
}) {
  const theme = useTheme();
  const windowId = useWindowId();
  const profileId = useWindowProfileId();
  const engine = useBrowser((s) => defaultSearchEngine(s.settings));
  const currentUrl = useBrowser((s) => s.tabs[tabId]?.url ?? "");
  const hero = variant === "hero";

  // The New Tab page restores its last query (Dia 1.28); the panel opens on the page URL,
  // shown without its scheme, fully selected, with no suggestions until you type.
  const [restored] = useState(() => (hero ? savedNtpQuery(tabId) : null));
  const initial = initialText ? initialText.replace(/^https?:\/\//, "") : "";
  const [typed, setTyped] = useState(restored?.typed ?? initial);
  const [edited, setEdited] = useState(restored?.edited ?? false);
  const [suppressCompletion, setSuppressCompletion] = useState(true);
  const [selected, setSelected] = useState(restored?.selected ?? 0);
  const [scope, setScope] = useState<SearchScope | null>(restored?.scope ?? null);
  /** What was typed before entering a scope, put back when it's removed. */
  const scopeFrom = useRef("");
  /** A selection to apply once (restore, Select All, the panel's preselected URL), then leave to the user. */
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(
    restored?.selection ?? (initial ? { start: 0, end: initial.length } : null),
  );
  const selection = useRef<Selection>(restored?.selection ?? { start: 0, end: typed.length });
  const input = useRef<TextInput>(null);
  const root = useRef<View>(null);

  const { items, completion } = useSuggestions({
    text: typed,
    active: edited || !!scope,
    windowId,
    profileId,
    currentTabId: tabId,
    currentUrl: currentUrl || undefined,
    scope,
  });
  const inline = useInlineCompletion(input, typed, suppressCompletion || scope ? "" : completion);
  const shownCompletion = inline.shown;
  const value = typed + shownCompletion;
  // The highlighted row (the list can shrink under the selection as you type).
  const selectedIndex = Math.min(selected, items.length - 1);
  const current = items[selectedIndex];
  // Tab would scope the query to this site / engine ("youtube.com ⇥").
  const canScope = !scope && edited && !!typed.trim() && !/\s/.test(typed.trim());
  const tabScope = useMemo(() => (canScope ? scopeFor(value, windowId) : null), [canScope, value, windowId]);

  // Remember the New Tab page's query for when it comes back.
  const snapshot = useRef<BarSnapshot | null>(null);
  snapshot.current = { typed, edited, selection: selection.current, selected, scope };
  useEffect(() => {
    if (!hero) return;
    const focus = () => {
      input.current?.focus();
      setPendingSelection({ start: 0, end: (snapshot.current?.typed ?? "").length });
    };
    const unregister = registerHeroBar(windowId, focus);
    return () => {
      unregister();
      saveNtpQuery(tabId, snapshot.current);
    };
  }, [hero, windowId, tabId]);

  // Selections are applied once, imperatively, after the text they belong to. Never through
  // TextInput's `selection` prop: react-native-macos puts the caret back where it was when the prop
  // was first set whenever the prop goes away, so typing over a completion ("m" + "ail.google.com",
  // then "f") left the caret after the "m" and the next keys landed before the "f".
  useLayoutEffect(() => {
    if (!pendingSelection) return;
    input.current?.setSelection(pendingSelection.start, pendingSelection.end);
    selection.current = pendingSelection;
    setPendingSelection(null);
  }, [pendingSelection]);

  const reset = () => {
    setTyped("");
    setEdited(false);
    setScope(null);
    setSelected(0);
    setSuppressCompletion(true);
    selection.current = { start: 0, end: 0 };
  };

  /** Closes the panel; the New Tab page's bar just clears. */
  const dismiss = () => (hero ? reset() : onCancel?.());

  const go = (url: string, disposition: Disposition = "current") => {
    if (!url) return;
    openFromBar(url, tabId, disposition);
    // A new tab / window leaves this bar behind: clear it.
    if (disposition !== "current") dismiss();
  };

  const choose = (s: Suggestion | undefined, disposition: Disposition = "current") => {
    if (!s) {
      if (scope) return;
      const text = edited ? value : initialText || value;
      return go(resolveInput(text, engine.url), disposition);
    }
    switch (s.kind) {
      case "page":
        if (s.tabId) {
          switchFromBar(s.tabId, s.url, tabId, disposition);
          if (hero && disposition === "current") reset();
          return;
        }
        return go(s.url, disposition);
      case "search":
      case "create":
        return go(s.url, disposition);
      case "calc":
        // ↩ copies the answer (and puts it in the bar); with a modifier, search the expression.
        if (disposition !== "current") return go(s.url, disposition);
        copyText(s.value);
        setTyped(s.value);
        setSuppressCompletion(true);
        setPendingSelection({ start: 0, end: s.value.length });
        return;
      case "action":
        dismiss();
        return runBarAction(s.id, windowId);
    }
  };

  /** ⇧⌘↩: search exactly what was typed (no completion, no top hit). */
  const forceSearch = () => {
    const text = typed.trim();
    if (!text) return;
    go(scope ? scopedSearchUrl(scope, text, engine) : searchUrl(engine, text));
  };

  const enterScope = (next: SearchScope) => {
    scopeFrom.current = typed;
    setScope(next);
    setTyped("");
    setEdited(true);
    setSelected(0);
    setSuppressCompletion(true);
  };

  const leaveScope = (restoreText: boolean) => {
    setScope(null);
    if (restoreText) setTyped(scopeFrom.current);
    setSelected(0);
    setSuppressCompletion(true);
  };

  const move = (delta: 1 | -1) => setSelected((i) => Math.max(0, Math.min(Math.min(i, items.length - 1) + delta, items.length - 1)));

  const onKeyDown = (e: { nativeEvent: { key: string; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean } }) => {
    const { key, metaKey, altKey, shiftKey, ctrlKey } = e.nativeEvent;
    if (key === "Escape") {
      if (scope) return leaveScope(false);
      if (!hero) return onCancel?.();
      // The New Tab page's bar: Esc first drops the completion / suggestions, then the text.
      if (shownCompletion) return setSuppressCompletion(true);
      return reset();
    }
    if (key === "ArrowDown" || (ctrlKey && key === "n")) return move(1);
    if (key === "ArrowUp" || (ctrlKey && key === "p")) return move(-1);
    if (key === "Tab") {
      if (shiftKey) return move(-1);
      if (tabScope) return enterScope(tabScope);
      if (shownCompletion) {
        setTyped(value);
        setSuppressCompletion(true);
        setPendingSelection({ start: value.length, end: value.length });
        return;
      }
      return move(1);
    }
    if (key === "Backspace" && scope && !typed) return leaveScope(true);
    if (key === "Enter") {
      if (metaKey && shiftKey) return forceSearch();
      // ⌃↩: "apple" → www.apple.com, like Chrome.
      if (ctrlKey && !/[\s./:]/.test(typed.trim()) && typed.trim()) return go(`https://www.${typed.trim()}.com`);
      if (metaKey || altKey || shiftKey) return choose(current, dispositionFor({ metaKey, altKey, shiftKey }));
    }
  };

  const onContextMenu = async () => {
    const paste = await clipboardPasteAction();
    const { start, end } = selection.current;
    const hasSelection = end > start;
    const choice = await showMenu([
      ...pasteMenuItem(paste),
      ...(paste ? [{ separator: true as const }] : []),
      { id: "cut", title: "Cut", enabled: hasSelection },
      { id: "copy", title: "Copy", enabled: hasSelection },
      { id: "paste", title: "Paste", enabled: !!paste },
      { separator: true },
      { id: "selectAll", title: "Select All", enabled: !!value },
    ]);
    if (choice === "pasteAndGo" && paste) return go(pasteTarget(paste));
    if (choice === "copy" || choice === "cut") copyText(value.slice(start, end));
    if (choice === "cut" || choice === "paste") {
      const insert = choice === "paste" ? (await readClipboard()).replace(/\s*\n\s*/g, " ") : "";
      const next = value.slice(0, start) + insert + value.slice(end);
      setTyped(next);
      setEdited(true);
      setSuppressCompletion(true);
      setSelected(0);
      setPendingSelection({ start: start + insert.length, end: start + insert.length });
    }
    if (choice === "selectAll") setPendingSelection({ start: 0, end: value.length });
    input.current?.focus();
  };

  const onChangeText = (next: string) => {
    const change = inline.read(next);
    if (change.echo) {
      if (!change.stale) selection.current = { start: change.inline.typed.length, end: next.length };
      return;
    }
    setEdited(true);
    setTyped(change.typed);
    setSuppressCompletion(change.suppress);
    setSelected(0);
  };

  useOmniboxDriver(`${windowId}:${variant}`, {
    type: onChangeText,
    clear: reset,
    key: (key, mods) => onKeyDown({ nativeEvent: { key, ...mods } }),
    submit: () => choose(current),
    measure: () => new Promise((resolve) => root.current?.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }))),
    state: () => ({ typed, value, completion: shownCompletion, suggested: completion, selected: selectedIndex, scope, scopeFrom: scopeFrom.current, tabScope, items }),
  });

  const leadingIcon =
    current && (typed || scope) && current.kind !== "search" ? (
      <SuggestionIcon suggestion={current} color={theme.textPrimary} />
    ) : (
      <Symbol name="magnifyingglass" size={15} weight="medium" color={hero ? theme.textSecondary : theme.textPrimary} style={{ width: 18, height: 18 }} />
    );

  const field = (
    <TextInput
      ref={input}
      autoFocus
      value={value}
      onSelectionChange={(e) => {
        selection.current = e.nativeEvent.selection;
      }}
      onChangeText={onChangeText}
      placeholder={scope ? `Search ${scope.name}` : hero ? "Ask anything…" : "Search or enter address"}
      placeholderTextColor={theme.placeholder}
      selectionColor={theme.selection}
      enableFocusRing={false}
      onSubmitEditing={() => choose(current)}
      onBlur={onCancel}
      keyDownEvents={scope && !typed ? SCOPE_KEYS : BASE_KEYS}
      onKeyDown={onKeyDown}
      style={{
        flex: 1,
        fontSize: hero ? 17 : 15,
        color: theme.textPrimary,
        paddingVertical: 0,
      }}
    />
  );

  const suggestionList = items.length > 0 && (
    <View style={{ paddingHorizontal: 9, paddingBottom: 2 }}>
      {items.map((s, i) => (
        <SuggestionRow
          key={`${s.kind}-${"url" in s ? s.url : s.id}-${i}`}
          suggestion={s}
          selected={i === selectedIndex}
          trailing={i === 0 && tabScope ? `Search ${tabScope.name}  ⇥` : null}
          onPress={() => choose(s)}
          onHover={() => setSelected(i)}
          onRemove={s.kind === "page" && s.visited && !s.tabId ? () => useBrowser.getState().removeHistory(profileId, [s.url]) : undefined}
        />
      ))}
    </View>
  );

  const bottomRow = (
    // Hero: measured on Dia 1.50.1's New Tab bar, the chip row's centre is 30.5pt above the bar's bottom edge
    // (the input row's is 30pt below its top), so the row is 43 tall with 8 below it.
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: hero ? 13 : 14,
        paddingRight: hero ? 15 : 13,
        height: hero ? 43 : 52,
        marginBottom: hero ? 8 : 0,
      }}
    >
      <AddChip tabId={tabId} onGo={(url) => go(url)} />
      <View style={{ flex: 1 }} />
      <IconButton icon="mic" size={14} color={theme.textTertiary} tooltip="Dictation" onPress={() => { input.current?.focus(); startDictation(); }} />
      {hero ? (
        <SendButton active={!!typed.trim()} onPress={() => choose(current)} />
      ) : (
        <GoButton label={destinationLabel(current)} onPress={() => choose(current)} />
      )}
    </View>
  );

  return (
    <View ref={root}>
      <ContextMenuArea captureDescendants onContextMenu={() => void onContextMenu()}>
        <View style={{ flexDirection: "row", alignItems: "center", height: hero ? 60 : 55, paddingLeft: hero ? 18 : 20, paddingRight: 18, gap: hero ? 8 : 10 }}>
          <View style={{ width: 18, alignItems: "center" }}>{leadingIcon}</View>
          {scope && <ScopeChip scope={scope} large={hero} />}
          {field}
        </View>
      </ContextMenuArea>
      {suggestionList}
      {bottomRow}
    </View>
  );
}

/** The Go pill names where ↩ goes: the search engine for searches (Dia shows the matched engine). */
function destinationLabel(s: Suggestion | undefined): string {
  if (s?.kind === "search") return s.engine;
  if (s?.kind === "calc") return "Copy";
  return "Go";
}

function AddChip({ tabId, onGo }: { tabId: string; onGo(url: string): void }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const { hovered, hoverProps } = useHover();
  const open = async () => {
    const s = useBrowser.getState();
    const active = activeTabId(s, windowId);
    const others = viewTabIds(s, windowId)
      .map((id) => s.tabs[id]!)
      .filter((t) => t.id !== active && t.url)
      .slice(0, 12);
    const choice = await showMenu([
      ...others.map((t) => ({ id: `tab:${t.id}`, title: t.title || displayUrl(t.url) })),
      ...(others.length ? [{ separator: true as const }] : []),
      { id: "files", title: "Open File…", symbol: "doc" },
    ]);
    if (choice?.startsWith("tab:")) switchFromBar(choice.slice(4), "", tabId, "current");
    if (choice === "files") {
      const [file] = await pickFiles();
      if (file) onGo(file);
    }
  };
  return (
    <View {...hoverProps}>
    <Pressable onPress={open}>
      <View
        style={{
          height: 32,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.chipBorder,
          backgroundColor: hovered ? theme.rowHover : undefined,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 9,
          paddingRight: 12,
          gap: 5,
        }}
      >
        <Symbol name="plus" size={11} weight="medium" color={theme.chipText} style={{ width: 14, height: 14 }} />
        <Text style={{ fontSize: 13, color: theme.chipText }}>Add tabs or files</Text>
      </View>
    </Pressable>
    </View>
  );
}

function GoButton({ label, onPress }: { label: string; onPress(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ marginLeft: 8 }}>
    <Pressable onPress={onPress}>
      <View
        style={{
          minWidth: 99,
          height: 32,
          paddingHorizontal: 16,
          borderRadius: 16,
          backgroundColor: theme.goButton,
          opacity: hovered ? 0.9 : 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: theme.goButtonText }}>{label}</Text>
        <Symbol name="return" size={11} weight="medium" color={theme.goButtonText + "99"} style={{ width: 14, height: 14 }} />
      </View>
    </Pressable>
    </View>
  );
}

function SendButton({ active, onPress }: { active: boolean; onPress(): void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!active} style={{ marginLeft: 11.5 }}>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: active ? theme.goButton : theme.sendIdle,
        }}
      >
        <Symbol name="arrow.up" size={13} weight="semibold" color={active ? theme.goButtonText : theme.textTertiary} style={{ width: 16, height: 16 }} />
      </View>
    </Pressable>
  );
}
