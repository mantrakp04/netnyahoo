import { displayUrl, fuzzyScore } from "@netnyahoo/core";
import { FadeLabel, Surface, Symbol } from "@netnyahoo/shell";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { switchToTab } from "../../lib/actions";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser, type BrowserState } from "../../store/browser";
import { tabLabel } from "../../store/model";
import { tabTitle } from "./actions";
import { setSidebarUi, useSidebarUi } from "./state";
import { TabIcon } from "./TabIcon";

type Row =
  | { kind: "tab"; id: string; title: string; url: string; favicon: string | null; icon: string | null; where: string | null; current: boolean }
  | { kind: "closed"; id: string; title: string; url: string; favicon: string | null; icon: string | null; detail: string };

const WIDTH = 560;
const ROW = 36;
const MAX_ROWS = 10;

/** Open tabs of the window's profile in every window, most recent first, then recently closed. */
function candidates(s: BrowserState, windowId: string): { open: Row[]; closed: Row[] } {
  const w = s.windows[windowId];
  if (!w) return { open: [], closed: [] };
  const profileId = w.profileId;
  const windowNumber = (id: string) => s.windowOrder.filter((x) => !s.windows[x]?.incognito || x === windowId).indexOf(id) + 1;
  const open: Row[] = Object.values(s.tabs)
    .filter((t) => t.profileId === profileId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .map((t) => ({
      kind: "tab",
      id: t.id,
      title: tabTitle(t),
      url: t.url,
      favicon: t.favicon,
      icon: t.customIcon,
      where: t.windowId === windowId ? null : `Window ${windowNumber(t.windowId)}`,
      current: s.windows[t.windowId]?.activeTabIds[profileId] === t.id,
    }));
  const closed: Row[] = [
    ...s.closedTabs
      .filter((c) => c.tab.profileId === profileId)
      .map((c) => ({ kind: "closed" as const, id: c.id, title: c.tab.customTitle || c.tab.title || tabLabel(c.tab), url: c.tab.url, favicon: c.tab.favicon, icon: c.tab.customIcon, detail: "", at: c.closedAt })),
    ...s.closedGroups.map((c) => ({
      kind: "closed" as const,
      id: c.id,
      title: c.group.name,
      url: c.tabs[0]?.url ?? "",
      favicon: c.tabs[0]?.favicon ?? null,
      icon: c.group.icon,
      detail: c.tabs.length === 1 ? "Group · 1 tab" : `Group · ${c.tabs.length} tabs`,
      at: c.closedAt,
    })),
  ]
    .sort((a, b) => b.at - a.at)
    .map(({ at: _, ...row }) => row);
  return { open, closed };
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Search Tabs (⇧⌘A): find an open tab in any window of this profile, or a recently closed one. */
export function SearchTabs({ windowId, windowWidth }: { windowId: string; windowWidth: number }) {
  const open = useSidebarUi((u) => u.searchTabs === windowId);
  return open ? <Panel windowId={windowId} windowWidth={windowWidth} /> : null;
}

function Panel({ windowId, windowWidth }: { windowId: string; windowWidth: number }) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const tabs = useBrowser((s) => s.tabs);
  const closedTabs = useBrowser((s) => s.closedTabs);
  const closedGroups = useBrowser((s) => s.closedGroups);
  const sections = useMemo(() => {
    const { open, closed } = candidates(useBrowser.getState(), windowId);
    const q = query.trim();
    if (!q) return [{ title: "Open Tabs", rows: open }, { title: "Recently Closed", rows: closed.slice(0, 8) }];
    const rank = (rows: Row[]) =>
      rows
        .map((r) => ({ r, score: Math.max(fuzzyScore(q, r.title), fuzzyScore(q, host(r.url)) * 0.9, fuzzyScore(q, r.url) * 0.6) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.r);
    return [{ title: "Open Tabs", rows: rank(open) }, { title: "Recently Closed", rows: rank(closed).slice(0, 8) }];
  }, [query, tabs, closedTabs, closedGroups, windowId]);
  const rows = sections.flatMap((s) => s.rows);
  const close = () => setSidebarUi({ searchTabs: null });
  const choose = (row: Row | undefined) => {
    if (!row) return;
    close();
    if (row.kind === "tab") switchToTab(row.id);
    else useBrowser.getState().restoreClosed(row.id, windowId);
  };
  const move = (delta: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, selected + delta));
    setSelected(next);
    scroll.current?.scrollTo({ y: Math.max(0, (next - MAX_ROWS + 2) * ROW), animated: false });
  };
  let index = -1;

  return (
    <>
      <Pressable onPress={close} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      <Surface
        fill={hex(theme.panel)}
        cornerRadius={16}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={24}
        shadowOffset={[0, 10]}
        style={{ position: "absolute", top: 56, left: Math.max(12, (windowWidth - WIDTH) / 2), width: Math.min(WIDTH, windowWidth - 24), paddingBottom: 6 }}
      >
        <View style={{ height: 50, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10 }}>
          <Symbol name="magnifyingglass" size={15} weight="medium" color={theme.textPrimary} style={{ width: 18, height: 18 }} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setSelected(0);
              scroll.current?.scrollTo({ y: 0, animated: false });
            }}
            placeholder="Search Tabs"
            placeholderTextColor={theme.placeholder}
            selectionColor={theme.selection}
            enableFocusRing={false}
            onSubmitEditing={() => choose(rows[selected])}
            onBlur={close}
            keyDownEvents={[{ key: "Escape" }, { key: "ArrowUp" }, { key: "ArrowDown" }]}
            onKeyDown={(e) => {
              const key = e.nativeEvent.key;
              if (key === "Escape") close();
              if (key === "ArrowDown") move(1);
              if (key === "ArrowUp") move(-1);
            }}
            style={{ flex: 1, fontSize: 16, color: theme.textPrimary, paddingVertical: 0 }}
          />
        </View>
        <View style={{ height: 0.5, backgroundColor: theme.divider }} />
        <ScrollView ref={scroll} style={{ maxHeight: ROW * MAX_ROWS + 60 }} showsVerticalScrollIndicator={false}>
          {rows.length === 0 ? (
            <Text style={{ paddingHorizontal: 16, paddingVertical: 14, fontSize: 13, color: theme.textTertiary }}>No tabs match “{query.trim()}”</Text>
          ) : null}
          {sections.map((section) =>
            section.rows.length ? (
              <View key={section.title} style={{ paddingHorizontal: 6, paddingTop: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textTertiary, paddingHorizontal: 10, paddingVertical: 4 }}>{section.title}</Text>
                {section.rows.map((row) => {
                  index++;
                  const i = index;
                  return <ResultRow key={`${row.kind}:${row.id}`} row={row} selected={i === selected} onHover={() => setSelected(i)} onPress={() => choose(row)} />;
                })}
              </View>
            ) : null,
          )}
        </ScrollView>
      </Surface>
    </>
  );
}

function ResultRow({ row, selected, onHover, onPress }: { row: Row; selected: boolean; onHover(): void; onPress(): void }) {
  const theme = useTheme();
  const detail = row.kind === "tab" ? (row.current && !row.where ? "Current Tab" : row.where) : row.detail;
  return (
    <Pressable onPress={onPress}>
      <View
        onMouseEnter={onHover}
        style={{ height: ROW, borderRadius: 10, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 10, backgroundColor: selected ? theme.rowSelected : undefined }}
      >
        <TabIcon url={row.url} favicon={row.favicon} icon={row.icon} />
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 }}>
          {/* FadeLabel has no intrinsic width: split the row between title and URL. */}
          <FadeLabel text={row.title} fontSize={14} color={theme.textPrimary} style={{ flex: 3, height: 19 }} />
          {row.url ? <FadeLabel text={`— ${displayUrl(row.url)}`} fontSize={14} color={theme.textSecondary} style={{ flex: 2, height: 19, marginLeft: 5 }} /> : null}
        </View>
        {detail ? <Text style={{ fontSize: 12, color: theme.textTertiary }}>{detail}</Text> : null}
        {row.kind === "closed" ? <Symbol name="clock.arrow.circlepath" size={12} color={theme.textTertiary} style={{ width: 16, height: 16 }} /> : null}
      </View>
    </Pressable>
  );
}
