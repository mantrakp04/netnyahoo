import { displayUrl, resolveInput, searchUrl, scopedSearchUrl, type SearchScope, type Suggestion } from "@arcadia/core";
import { ContextMenuArea, Symbol, copyText, pickFiles, showMenu, startDictation } from "@arcadia/shell";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useTheme } from "../lib/theme";
import { journeyBarCommitted, journeyBarFocused, journeyKeystroke, journeyNavigate, journeySuggestions } from "../telemetry/journeys";
import { sampleOmniboxLatency, trackSuggestionChosen } from "../telemetry/track";
import { useBrowser } from "../store/browser";
import { useWindowId, useWindowProfileId } from "../store/hooks";
import { activeTabId, viewTabIds } from "../store/model";
import { defaultSearchEngine } from "../store/settings";
import { runBarAction } from "./omnibox/actions";
import { traceOmnibox, useOmniboxDriver } from "./omnibox/devDriver";
import { registerHeroBar, savedNtpQuery, saveNtpQuery, type BarSnapshot } from "./omnibox/barState";
import { dispositionFor, openFromBar, switchFromBar, type Disposition } from "./omnibox/open";
import { clipboardPasteAction, pasteMenuItem, pasteTarget, readClipboard } from "./omnibox/paste";
import { ScopeChip } from "./omnibox/ScopeChip";
import { SuggestionIcon, SuggestionList, isRemovable, type RowActions } from "./omnibox/SuggestionRow";
import { useDropdownStart } from "./omnibox/dropdownStart";
import { useInlineCompletion } from "./omnibox/useInlineCompletion";
import { keywordScope, scopeFor, useSuggestions } from "./omnibox/useSuggestions";
import { setPopover } from "./layout/pageState";
import { IconButton, useHover } from "./primitives";

type Variant = "panel" | "hero" | "sidebar";
type Selection = { start: number; end: number };

const BASE_KEYS = [
  { key: "Escape" },
  { key: "ArrowUp" },
  { key: "ArrowDown" },
  { key: "PageUp" },
  { key: "PageDown" },
  { key: "Tab" },
  { key: "n", ctrlKey: true },
  { key: "p", ctrlKey: true },
  { key: "Enter", metaKey: true },
  { key: "Enter", altKey: true },
  { key: "Enter", shiftKey: true },
  { key: "Enter", ctrlKey: true },
  { key: "Enter", ctrlKey: true, shiftKey: true },
];
const SCOPE_KEYS = [...BASE_KEYS, { key: "Backspace" }];
// ⇧⌦ is the field's own forward delete unless the selected row can be removed from history (Chrome's TryDeletingPopupLine).
const REMOVE_KEYS = [...BASE_KEYS, { key: "Delete", shiftKey: true }];

export function Omnibox({
  variant,
  tabId,
  initialText = "",
  onCancel,
}: {
  variant: Variant;
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
  const dropdown = variant === "sidebar";

  const [restored] = useState(() => (hero ? savedNtpQuery(tabId) : null));
  const [typed, setTyped] = useState(restored?.typed ?? initialText);
  const [edited, setEdited] = useState(restored?.edited ?? false);
  const [suppressCompletion, setSuppressCompletion] = useState(true);
  const [selected, setSelected] = useState(restored?.selected ?? 0);
  const [scope, setScope] = useState<SearchScope | null>(restored?.scope ?? null);
  const scopeFrom = useRef("");
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(
    restored?.selection ?? (initialText ? { start: 0, end: initialText.length } : null),
  );
  const selection = useRef<Selection>(restored?.selection ?? { start: 0, end: typed.length });
  // The selection before the latest change to it: RN reports the caret after an edit before the edit's text, so a
  // text change finds the selection it replaced here (Chrome's just_deleted_text and paste rules need it).
  const selectionBefore = useRef<Selection>(selection.current);
  const selectionAt = useRef(0);
  const noteSelection = (next: Selection) => {
    const now = selection.current;
    if (now.start !== next.start || now.end !== next.end) {
      selectionBefore.current = now;
      selectionAt.current = Date.now();
    }
    selection.current = next;
  };
  const input = useRef<TextInput>(null);
  const root = useRef<View>(null);

  const { items: suggested, completion } = useSuggestions({
    text: typed,
    active: edited || !!scope,
    windowId,
    profileId,
    currentTabId: tabId,
    currentUrl: currentUrl || undefined,
    scope,
    preventInline: suppressCompletion,
  });
  const start = useDropdownStart(dropdown && !edited && !scope, tabId, profileId);
  const items = dropdown && !edited && !scope ? start : suggested;
  const inline = useInlineCompletion(input, typed, suppressCompletion || scope ? "" : completion);
  const shownCompletion = inline.shown;
  const value = typed + shownCompletion;
  const selectedIndex = Math.min(selected, items.length - 1);
  const current = items[selectedIndex];
  const canScope = !scope && edited && !!typed.trim() && !/\s/.test(typed.trim());
  const tabScope = useMemo(() => (canScope ? scopeFor(value, windowId) : null), [canScope, value, windowId]);

  const snapshot = useRef<BarSnapshot | null>(null);
  snapshot.current = { typed, edited, selection: selection.current, selected, scope };
  const fieldText = useRef(value);
  fieldText.current = value;
  // Focusing a field that isn't being edited reports AppKit's select-all and then the caret at the end (RN's
  // reactFocus), after the selection the bar applies with it: those two would leave `selection` wrong for the
  // first key (⌘L, then a letter the address starts with, read as a deletion).
  const editing = useRef(false);
  const focusEcho = useRef(false);
  const focusField = () => {
    if (!editing.current && fieldText.current) focusEcho.current = true;
    input.current?.focus();
  };
  useEffect(() => {
    if (!hero) return;
    const focus = () => {
      focusField();
      // Everything in the field, the shown completion too.
      setPendingSelection({ start: 0, end: fieldText.current.length });
    };
    const unregister = registerHeroBar(windowId, focus);
    return () => {
      unregister();
      saveNtpQuery(tabId, snapshot.current);
    };
  }, [hero, windowId, tabId]);

  // Apply selection imperatively; RN macOS can restore a stale caret when its selection prop clears.
  useLayoutEffect(() => {
    if (!pendingSelection) return;
    input.current?.setSelection(pendingSelection.start, pendingSelection.end);
    noteSelection(pendingSelection);
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

  const dismiss = () => (hero ? reset() : onCancel?.());

  const go = (url: string, disposition: Disposition = "current") => {
    if (!url) return;
    if (disposition === "current") journeyNavigate(tabId);
    openFromBar(url, tabId, disposition);
    if (disposition !== "current") dismiss();
  };

  const choose = (s: Suggestion | undefined, disposition: Disposition = "current") => {
    // Opt-in telemetry records the suggestion kind only, never its text.
    if (s || !scope) trackSuggestionChosen(s);
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

  // ↑ and ↓ wrap around the rows, as in Chrome (OmniboxPopupSelection::GetNextSelection).
  const move = (delta: 1 | -1) =>
    setSelected((i) => (items.length ? (Math.min(i, items.length - 1) + delta + items.length) % items.length : 0));

  const onKeyDown = (e: { nativeEvent: { key: string; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean } }) => {
    const { key, metaKey, altKey, shiftKey, ctrlKey } = e.nativeEvent;
    if (key === "Escape") {
      if (scope) return leaveScope(false);
      if (!hero) return onCancel?.();
      if (shownCompletion) return setSuppressCompletion(true);
      return reset();
    }
    if (key === "ArrowDown" || (ctrlKey && key === "n")) return move(1);
    if (key === "ArrowUp" || (ctrlKey && key === "p")) return move(-1);
    if (key === "PageUp") return setSelected(0);
    if (key === "PageDown") return setSelected(Math.max(0, items.length - 1));
    if (key === "Delete" && shiftKey) return isRemovable(current) ? rowActions.remove(current.url) : undefined;
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
      if (ctrlKey && !/[\s./:]/.test(typed.trim()) && typed.trim())
        return go(`https://www.${typed.trim()}.com`, shiftKey ? "newWindow" : "current");
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
    focusField();
  };

  // Opt-in field timing (telemetry/journeys.ts): a new tab's bar, and its first suggestions.
  useLayoutEffect(() => journeyBarCommitted(tabId), []);
  useLayoutEffect(() => {
    if (items.length) journeySuggestions(tabId);
  }, [items]);

  const heardAt = useRef(0);
  const keyAt = useRef(0);
  useLayoutEffect(() => {
    if (__DEV__) traceOmnibox({ bar: `${windowId}:${variant}`, typed, heard: heardAt.current, committed: Date.now() });
    if (keyAt.current) {
      sampleOmniboxLatency(Date.now() - keyAt.current);
      keyAt.current = 0;
    }
  });

  const onChangeText = (next: string) => {
    if (__DEV__) heardAt.current = Date.now();
    // An edit's caret arrives just before its text. An edit that leaves the caret where it was (⌦) has none, so a
    // selection that changed earlier (a click) is what it started from.
    const fresh = Date.now() - selectionAt.current < 100;
    const change = inline.read(next, { before: fresh ? selectionBefore.current : selection.current, after: selection.current });
    if (change.echo) {
      if (!change.stale) noteSelection({ start: change.inline.typed.length, end: next.length });
      return;
    }
    focusEcho.current = false;
    keyAt.current = Date.now();
    journeyKeystroke(tabId);
    // Space right after an exact keyword or site host (youtube.com␣) enters its search, as Tab does.
    const keyword = !scope && next === typed + " " ? keywordScope(typed, windowId) : null;
    if (keyword) return enterScope(keyword);
    setEdited(true);
    setTyped(change.typed);
    setSuppressCompletion(change.suppress);
    setSelected(0);
  };

  useOmniboxDriver(`${windowId}:${variant}`, {
    // As the field reports a keystroke: the caret after the edit first, then the text.
    type: (text) => {
      noteSelection({ start: text.length, end: text.length });
      onChangeText(text);
    },
    clear: reset,
    key: (key, mods) => onKeyDown({ nativeEvent: { key, ...mods } }),
    select: (start, end) => noteSelection({ start, end }),
    submit: () => choose(current),
    measure: () => new Promise((resolve) => root.current?.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }))),
    state: () => ({ typed, value, selection: selection.current, completion: shownCompletion, suggested: completion, preventInline: suppressCompletion, selectionBefore: selectionBefore.current, selected: selectedIndex, scope, scopeFrom: scopeFrom.current, tabScope, items }),
  });

  const leadingIcon =
    current && (typed || scope) && current.kind !== "search" ? (
      <SuggestionIcon suggestion={current} color={theme.textPrimary} />
    ) : (
      <Symbol name="magnifyingglass" size={15} weight="medium" color={hero ? theme.textSecondary : theme.textPrimary} style={{ width: 18, height: 18 }} />
    );

  // Focus once the field has its frame: autoFocus hands the window's shared field editor a
  // zero-width field, and the editor then stays wider than the field (its text draws past the
  // edge and never scrolls).
  const focused = useRef(false);
  const focusOnce = () => {
    if (focused.current) return;
    focused.current = true;
    focusField();
    const { start, end } = selection.current;
    input.current?.setSelection(start, end);
    journeyBarFocused(tabId);
  };

  const field = (
    <TextInput
      ref={input}
      onLayout={focusOnce}
      value={value}
      onSelectionChange={(e) => {
        const next = e.nativeEvent.selection;
        if (focusEcho.current) {
          const atEnd = next.start === value.length && next.end === value.length;
          if (atEnd || (next.start === 0 && next.end === value.length)) {
            if (atEnd) focusEcho.current = false;
            return;
          }
          focusEcho.current = false;
        }
        noteSelection(next);
        // → and ⌘→ (or a click at the end) accept the completion: it is typed text from here on (the next ⌫ deletes from it).
        if (inline.accepts(next)) {
          setTyped(value);
          setSuppressCompletion(true);
          setSelected(0);
        }
      }}
      onChangeText={onChangeText}
      placeholder={scope ? `Search ${scope.name}` : hero ? "Ask anything…" : "Search or enter address"}
      placeholderTextColor={theme.placeholder}
      selectionColor={theme.selection}
      enableFocusRing={false}
      onSubmitEditing={() => choose(current)}
      onFocus={() => {
        editing.current = true;
      }}
      onBlur={() => {
        editing.current = false;
        focusEcho.current = false;
        onCancel?.();
      }}
      keyDownEvents={scope && !typed ? SCOPE_KEYS : isRemovable(current) ? REMOVE_KEYS : BASE_KEYS}
      onKeyDown={onKeyDown}
      style={{
        flex: 1,
        fontSize: hero ? 17 : dropdown ? 14 : 15,
        color: theme.textPrimary,
        paddingVertical: 0,
      }}
    />
  );

  const latest = useRef({ choose, profileId, go, current, onCancel, tabId });
  latest.current = { choose, profileId, go, current, onCancel, tabId };
  // The bar's buttons take these, so they stay as they are while the field re-renders on each key.
  const [barActions] = useState(() => ({
    go: (url: string) => latest.current.go(url),
    choose: () => latest.current.choose(latest.current.current),
    dictate: () => {
      focusField();
      startDictation();
    },
    siteControls: () => {
      latest.current.onCancel?.();
      setPopover(latest.current.tabId, "siteControls");
    },
  }));
  const [rowActions] = useState<RowActions>(() => ({
    choose: (s) => latest.current.choose(s),
    hover: setSelected,
    remove: (url) => useBrowser.getState().removeHistory(latest.current.profileId, [url]),
  }));
  const suggestionList = (
    <SuggestionList
      items={items}
      selectedIndex={selectedIndex}
      trailing={tabScope ? `Search ${tabScope.name}  ⇥` : null}
      dropdown={dropdown}
      actions={rowActions}
    />
  );

  const bottomRow = (
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
      <AddChip tabId={tabId} onGo={barActions.go} />
      <View style={{ flex: 1 }} />
      <IconButton icon="mic" size={14} color={theme.textTertiary} tooltip="Dictation" onPress={barActions.dictate} />
      {hero ? (
        <SendButton active={!!typed.trim()} onPress={barActions.choose} />
      ) : (
        <GoButton label={destinationLabel(current)} onPress={barActions.choose} />
      )}
    </View>
  );

  if (dropdown) {
    return (
      <View ref={root}>
        <ContextMenuArea captureDescendants onContextMenu={() => void onContextMenu()}>
          <View style={{ flexDirection: "row", alignItems: "center", height: 44, paddingLeft: 13, paddingRight: 9, gap: 9 }}>
            <View style={{ width: 18, alignItems: "center" }}>{leadingIcon}</View>
            {scope && <ScopeChip scope={scope} large={false} />}
            {field}
            {currentUrl ? (
              <IconButton
                icon="info.circle"
                size={15}
                box={26}
                radius={13}
                color={theme.textSecondary}
                tooltip="Site Controls"
                onPress={barActions.siteControls}
              />
            ) : null}
          </View>
        </ContextMenuArea>
        {suggestionList}
      </View>
    );
  }

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

function destinationLabel(s: Suggestion | undefined): string {
  if (s?.kind === "search") return s.engine;
  if (s?.kind === "calc") return "Copy";
  return "Go";
}

const AddChip = memo(function AddChip({ tabId, onGo }: { tabId: string; onGo(url: string): void }) {
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
});

const GoButton = memo(function GoButton({ label, onPress }: { label: string; onPress(): void }) {
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
});

const SendButton = memo(function SendButton({ active, onPress }: { active: boolean; onPress(): void }) {
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
});
