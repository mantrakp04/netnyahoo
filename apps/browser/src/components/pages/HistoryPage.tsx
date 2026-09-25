import { cleanUrl } from "@netnyahoo/core";
import { confirm, ContextMenuArea, copyText, MouseArea, showMenu, Symbol } from "@netnyahoo/shell";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import type { HistoryEntry } from "../../store/types";
import { openModeFor, openUrl } from "../bookmarks/actions";
import { Favicon, IconButton, useHover } from "../primitives";
import { Button, Checkbox, useFormColors } from "../settings/controls";
import { ClearDataDialog, useClearDataRequest } from "./ClearDataDialog";
import { dayLabel, dayStart, EmptyState, hostLabel, matchesQuery, PAGE_WIDTH, PageHeader, timeLabel } from "./PageLayout";

const ROW = 38;
const HEADER = 44;
const NO_HISTORY: HistoryEntry[] = [];

type Item =
  | { type: "day"; key: string; label: string; offset: number }
  | { type: "row"; key: string; entry: HistoryEntry; first: boolean; last: boolean; offset: number };

/** History (⌘Y): the profile's visits grouped by day, searchable, with bulk delete. */
export function HistoryPage({ tabId, profileId, initialQuery }: { tabId: string; profileId: string; initialQuery: string }) {
  const theme = useTheme();
  const windowId = useBrowser((s) => s.tabs[tabId]?.windowId ?? "");
  const history = useBrowser((s) => s.history[profileId] ?? NO_HISTORY);
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clearOpen, setClearOpen] = useState(false);
  const lastClicked = useRef<string | null>(null);

  // History › Clear Browsing Data… opens the dialog here.
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
    let day = -1;
    const matches = history.filter((h) => matchesQuery(query, h.title, h.url));
    matches.forEach((entry, i) => {
      const start = dayStart(entry.lastVisit);
      if (start !== day) {
        day = start;
        out.push({ type: "day", key: `d${start}`, label: dayLabel(start), offset });
        offset += HEADER;
      }
      const next = matches[i + 1];
      out.push({
        type: "row",
        key: entry.url,
        entry,
        first: out.at(-1)?.type === "day",
        last: !next || dayStart(next.lastVisit) !== start,
        offset,
      });
      offset += ROW;
    });
    return out;
  }, [history, query]);

  const rowUrls = useMemo(() => items.flatMap((i) => (i.type === "row" ? [i.entry.url] : [])), [items]);

  const toggle = (url: string, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      // ⇧-click selects the range from the last clicked row, like Chrome.
      if (shift && lastClicked.current && rowUrls.includes(lastClicked.current)) {
        const [a, b] = [rowUrls.indexOf(lastClicked.current), rowUrls.indexOf(url)].sort((x, y) => x - y);
        rowUrls.slice(a!, b! + 1).forEach((u) => next.add(u));
      } else if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
    lastClicked.current = url;
  };

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
        <FlatList
          data={items}
          keyExtractor={(i) => i.key}
          getItemLayout={(_, index) => {
            const item = items[index]!;
            return { length: item.type === "day" ? HEADER : ROW, offset: item.offset, index };
          }}
          initialNumToRender={30}
          windowSize={8}
          contentContainerStyle={{ paddingBottom: 40, alignItems: "center" }}
          renderItem={({ item }) =>
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
                selecting={selected.size > 0}
                windowId={windowId}
                onToggle={(shift) => toggle(item.entry.url, shift)}
                onMoreFromSite={() => setQuery(hostLabel(item.entry.url))}
                onRemove={() => useBrowser.getState().removeHistory(profileId, [item.entry.url])}
              />
            )
          }
        />
      )}
      {clearOpen && <ClearDataDialog profileId={profileId} onClose={() => setClearOpen(false)} />}
    </View>
  );
}

function HistoryRow({
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
  onToggle: (shift: boolean) => void;
  onMoreFromSite: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
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
    if (choice === "more") onMoreFromSite();
    if (choice === "remove") onRemove();
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
          <View style={{ width: 14, opacity: hovered || selecting ? 1 : 0 }}>
            <Checkbox value={selected} onChange={() => onToggle(false)} />
          </View>
          <Text style={{ width: 64, fontSize: 12, color: theme.textSecondary }}>{timeLabel(entry.lastVisit)}</Text>
          <MouseArea style={{ flex: 1 }} onMiddleClick={() => openUrl(entry.url, windowId, "background")}>
            <Pressable
              onPress={(e) => {
                const ev = e.nativeEvent as unknown as { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };
                if (selecting) return onToggle(!!ev.shiftKey);
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
          <View style={{ opacity: hovered ? 1 : 0 }}>
            <IconButton icon="ellipsis" size={13} box={26} radius={6} onPress={() => void menu()} tooltip="More actions" />
          </View>
        </View>
      </ContextMenuArea>
      {!last && <View style={{ position: "absolute", left: 16 + 12, right: 16 + 12, bottom: 0, height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.separator }} />}
    </View>
  );
}
