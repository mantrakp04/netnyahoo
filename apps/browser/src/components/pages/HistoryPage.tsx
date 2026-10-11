import { cleanUrl } from "@arcadia/core";
import { confirm, ContextMenuArea, copyText, MouseArea, showMenu, Symbol } from "@arcadia/shell";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { markHoverProps } from "../../lib/hoverShift";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import type { HistoryEntry } from "../../store/types";
import { openModeFor, openUrl } from "../bookmarks/actions";
import { HoverSlot } from "../HoverSlot";
import { Favicon, IconButton } from "../primitives";
import { Button, Checkbox, useFormColors } from "../settings/controls";
import { ClearDataDialog, useClearDataRequest } from "./ClearDataDialog";
import { dayLabel, EmptyState, hostLabel, matchesQuery, PAGE_WIDTH, PageHeader, timeLabel } from "./PageLayout";
import { RecycledList } from "./RecycledList";

const ROW = 38;
const HEADER = 44;
const NO_HISTORY: HistoryEntry[] = [];

type Item =
  | { type: "day"; kind: "day"; key: string; label: string; offset: number; height: number }
  | { type: "row"; kind: "row"; key: string; entry: HistoryEntry; first: boolean; last: boolean; offset: number; height: number };

export function HistoryPage({ tabId, profileId, initialQuery }: { tabId: string; profileId: string; initialQuery: string }) {
  const theme = useTheme();
  const windowId = useBrowser((s) => s.tabs[tabId]?.windowId ?? "");
  const history = useBrowser((s) => s.history[profileId] ?? NO_HISTORY);
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clearOpen, setClearOpen] = useState(false);
  const lastClicked = useRef<string | null>(null);

  const clearRequest = useClearDataRequest((r) => r.windowId);
  const activeHere = useBrowser((s) => s.windows[windowId]?.activeTabIds[s.windows[windowId]!.profileId] === tabId);
  useEffect(() => {
    if (clearRequest === windowId && activeHere) {
      setClearOpen(true);
      useClearDataRequest.getState().request(null);
    }
  }, [clearRequest, activeHere]);

  useEffect(() => setQuery(initialQuery), [initialQuery]);

  const items = useMemo(() => {
    const out: Item[] = [];
    let offset = 0;
    // The day being listed, [start, end): Hermes's local-time Dates are slow, so they're made once per day, not per row.
    let start = Infinity;
    let end = -Infinity;
    const matches = query.trim() ? history.filter((h) => matchesQuery(query, h.title, h.url)) : history;
    matches.forEach((entry, i) => {
      if (entry.lastVisit < start || entry.lastVisit >= end) {
        const d = new Date(entry.lastVisit);
        start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
        out.push({ type: "day", kind: "day", key: `d${start}`, label: dayLabel(start), offset, height: HEADER });
        offset += HEADER;
      }
      const next = matches[i + 1];
      out.push({
        type: "row",
        kind: "row",
        key: entry.url,
        entry,
        first: out.at(-1)?.type === "day",
        last: !next || next.lastVisit < start || next.lastVisit >= end,
        offset,
        height: ROW,
      });
      offset += ROW;
    });
    return out;
  }, [history, query]);

  const rowUrls = useRef<string[]>([]);
  rowUrls.current = useMemo(() => items.flatMap((i) => (i.type === "row" ? [i.entry.url] : [])), [items]);

  // Stable callbacks: a row re-renders only when its own props change, not for every selection or visit.
  const toggle = useCallback((url: string, shift: boolean) => {
    // Read before the update: React may run the updater later, after lastClicked has moved on to `url`.
    const from = lastClicked.current;
    const urls = rowUrls.current;
    lastClicked.current = url;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && from && urls.includes(from)) {
        const [a, b] = [urls.indexOf(from), urls.indexOf(url)].sort((x, y) => x - y);
        urls.slice(a!, b! + 1).forEach((u) => next.add(u));
      } else if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);
  const moreFromSite = useCallback((url: string) => setQuery(hostLabel(url)), []);
  const remove = useCallback((url: string) => useBrowser.getState().removeHistory(profileId, [url]), [profileId]);
  const selecting = selected.size > 0;
  const renderItem = useCallback(
    (item: Item) =>
      item.type === "day" ? (
        <View style={{ width: PAGE_WIDTH, maxWidth: "100%", height: HEADER, justifyContent: "flex-end", paddingBottom: 8, paddingHorizontal: 30 }}>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.textSecondary }}>{item.label}</Text>
        </View>
      ) : (
        <HistoryRow
          entry={item.entry}
          profileId={profileId}
          first={item.first}
          last={item.last}
          selected={selected.has(item.entry.url)}
          selecting={selecting}
          windowId={windowId}
          onToggle={toggle}
          onMoreFromSite={moreFromSite}
          onRemove={remove}
        />
      ),
    [theme, profileId, selected, selecting, windowId, toggle, moreFromSite, remove],
  );

  const deleteSelected = async () => {
    const { confirmed } = await confirm({
      title: "Remove selected items?",
      message: "Are you sure you want to delete these pages from your history?",
      confirmTitle: "Remove",
      destructive: true,
      windowId,
    });
    if (!confirmed) return;
    useBrowser.getState().removeHistory(profileId, [...selected]);
    setSelected(new Set());
  };

  const actions =
    selected.size > 0 ? (
      <>
        <Text style={{ fontSize: 12, color: theme.textSecondary }}>{`${selected.size} selected`}</Text>
        <Button title="Cancel" onPress={() => setSelected(new Set())} />
        <Button title="Delete" kind="primary" onPress={() => void deleteSelected()} />
      </>
    ) : (
      <Button title="Clear Browsing Data…" onPress={() => setClearOpen(true)} />
    );

  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="History" query={query} onQuery={setQuery} placeholder="Search history" actions={actions} />
      {items.length === 0 ? (
        <EmptyState
          icon={<Symbol name="clock" size={30} color={theme.textTertiary} style={{ width: 40, height: 40 }} />}
          title={query ? "No search results found" : "Your browsing history appears here"}
        />
      ) : (
        <RecycledList items={items} renderItem={renderItem} paddingBottom={40} />
      )}
      {clearOpen && <ClearDataDialog profileId={profileId} onClose={() => setClearOpen(false)} />}
    </View>
  );
}

// Memoized, with the hover-only controls (checkbox, ⋯) made only while shown: the list mounts several screens of rows.
const HistoryRow = memo(function HistoryRow({
  entry,
  profileId,
  first,
  last,
  selected,
  selecting,
  windowId,
  onToggle,
  onMoreFromSite,
  onRemove,
}: {
  entry: HistoryEntry;
  profileId: string;
  first: boolean;
  last: boolean;
  selected: boolean;
  selecting: boolean;
  windowId: string;
  onToggle: (url: string, shift: boolean) => void;
  onMoreFromSite: (url: string) => void;
  onRemove: (url: string) => void;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  // The list reuses a row for another page as it scrolls: hover belongs to the page that was under the mouse.
  const url = useRef(entry.url);
  url.current = entry.url;
  const [hoveredUrl, setHoveredUrl] = useState<string | null>(null);
  const [hoverProps] = useState(() =>
    markHoverProps({ onMouseEnter: () => setHoveredUrl(url.current), onMouseLeave: () => setHoveredUrl(null) }),
  );
  const hovered = hoveredUrl === entry.url;
  const menu = async () => {
    const choice = await showMenu([
      { id: "tab", title: "Open in New Tab" },
      { id: "window", title: "Open in New Window" },
      { id: "incognito", title: "Open in Incognito Window" },
      { separator: true },
      { id: "copy", title: "Copy Link" },
      { id: "more", title: "More from This Site" },
      { separator: true },
      { id: "remove", title: "Remove from History" },
    ]);
    if (choice === "tab") openUrl(entry.url, windowId, "foreground");
    if (choice === "window") openUrl(entry.url, windowId, "window");
    if (choice === "incognito") openUrl(entry.url, windowId, "incognito");
    if (choice === "copy") copyText(cleanUrl(entry.url));
    if (choice === "more") onMoreFromSite(entry.url);
    if (choice === "remove") onRemove(entry.url);
  };
  const r = 10;
  return (
    <View
      {...hoverProps}
      style={{
        width: PAGE_WIDTH,
        maxWidth: "100%",
        height: ROW,
        paddingHorizontal: 16,
      }}
    >
      <ContextMenuArea onContextMenu={() => void menu()} style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 12,
            gap: 12,
            backgroundColor: selected ? colors.selected : hovered ? theme.rowHover : colors.group,
            borderTopLeftRadius: first ? r : 0,
            borderTopRightRadius: first ? r : 0,
            borderBottomLeftRadius: last ? r : 0,
            borderBottomRightRadius: last ? r : 0,
          }}
        >
          <HoverSlot hovered={hovered || selecting} width={14} hover={<Checkbox value={selected} onChange={() => onToggle(entry.url, false)} />} />
          <Text style={{ width: 64, fontSize: 12, color: theme.textSecondary }}>{timeLabel(entry.lastVisit)}</Text>
          <MouseArea style={{ flex: 1 }} onMiddleClick={() => openUrl(entry.url, windowId, "background")}>
            <Pressable
              onPress={(e) => {
                const ev = e.nativeEvent as unknown as { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };
                if (selecting) return onToggle(entry.url, !!ev.shiftKey);
                openUrl(entry.url, windowId, openModeFor(ev));
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Favicon url={entry.url} favicon={entry.favicon} profileId={profileId} />
              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, color: theme.textPrimary }}>
                {entry.title || entry.url}
              </Text>
              <Text numberOfLines={1} style={{ flexShrink: 0, maxWidth: 220, fontSize: 12, color: theme.textTertiary }}>
                {hostLabel(entry.url)}
              </Text>
            </Pressable>
          </MouseArea>
          <HoverSlot hovered={hovered} width={26} hover={<IconButton icon="ellipsis" size={13} box={26} radius={6} onPress={() => void menu()} tooltip="More actions" />} />
        </View>
      </ContextMenuArea>
      {!last && <View style={{ position: "absolute", left: 16 + 12, right: 16 + 12, bottom: 0, height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.separator }} />}
    </View>
  );
});
