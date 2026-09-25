import { killTask, listTasks, type EngineTask } from "@netnyahoo/cef";
import { Symbol, WindowDragRegion } from "@netnyahoo/shell";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { switchToTab } from "../../lib/actions";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { tabForBrowser, usePages } from "../layout/pageState";
import { Favicon, useHover } from "../primitives";
import { Button, useFormColors } from "../settings/controls";

const ICON = require("../../../assets/app-icon.png");
const POLL_MS = 1500;
const TOOLBAR = 44;
const ROW = 24;

type SortKey = "task" | "memory" | "cpu" | "gpu";
type Column = { key: SortKey; title: string; width?: number };

const COLUMNS: Column[] = [
  { key: "task", title: "Task" },
  { key: "memory", title: "Memory Footprint", width: 130 },
  { key: "cpu", title: "CPU", width: 70 },
  { key: "gpu", title: "GPU Memory", width: 110 },
];

/** A task as shown: its tabs (renderers host one or more) resolved through the store. */
type Row = EngineTask & { label: string; tabIds: string[]; favicon: { url: string; favicon: string | null; profileId: string } | null };

const TYPE_ICONS: Partial<Record<EngineTask["type"], string>> = {
  gpu: "cpu",
  utility: "gearshape",
  zygote: "gearshape",
  sandboxHelper: "gearshape",
  extension: "puzzlepiece.extension",
  plugin: "puzzlepiece",
  dedicatedWorker: "gearshape.2",
  sharedWorker: "gearshape.2",
  serviceWorker: "gearshape.2",
};

const bytes = (n: number) =>
  n < 0 ? "–" : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

/** Window › Task Manager: every engine process with live memory / CPU, like Chrome's and Dia's. */
export function TaskManagerWindow() {
  const theme = useTheme();
  const colors = useFormColors();
  const [tasks, setTasks] = useState<EngineTask[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "memory", descending: true });
  const [selected, setSelected] = useState<number | null>(null);
  const tabs = useBrowser((s) => s.tabs);
  // Re-resolve rows when a tab's browser id becomes known.
  const browsers = usePages((s) => s.browsers);

  useEffect(() => {
    let live = true;
    const poll = () => void listTasks().then((list) => live && setTasks(list), () => {});
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const rows = useMemo(() => {
    const resolved: Row[] = tasks.map((task) => {
      const tabIds = task.browserIds.map(tabForBrowser).filter((id): id is string => !!id && !!tabs[id]);
      const first = tabIds[0] ? tabs[tabIds[0]] : undefined;
      const name = first ? first.customTitle || first.title || first.url || "New Tab" : "";
      const label = first
        ? `Tab: ${name}${tabIds.length > 1 ? ` (and ${tabIds.length - 1} more)` : ""}`
        : task.type === "browser"
          ? "Netnyahoo"
          : task.title;
      return { ...task, label, tabIds, favicon: first ? { url: first.url, favicon: first.favicon, profileId: first.profileId } : null };
    });
    const value = (r: Row) => (sort.key === "memory" ? r.memory : sort.key === "cpu" ? r.cpu : sort.key === "gpu" ? r.gpuMemory : 0);
    return resolved.sort((a, b) => {
      const order = sort.key === "task" ? a.label.localeCompare(b.label) : value(a) - value(b);
      return (sort.descending ? -order : order) || a.id - b.id;
    });
  }, [tasks, tabs, browsers, sort]);

  const selectedRow = rows.find((r) => r.id === selected);
  useEffect(() => {
    if (selected !== null && tasks.length && !tasks.some((t) => t.id === selected)) setSelected(null);
  }, [tasks]);

  const endProcess = () => {
    if (!selectedRow?.killable) return;
    void killTask(selectedRow.id).then(() => listTasks().then(setTasks, () => {}));
    setSelected(null);
  };

  const totalMemory = tasks.reduce((sum, t) => sum + Math.max(0, t.memory), 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.dark ? "#1E1E1E" : "#FFFFFF" }}>
      <View style={{ height: TOOLBAR, alignItems: "center", justifyContent: "center" }}>
        <WindowDragRegion style={StyleSheet.absoluteFill} />
        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>Task Manager</Text>
      </View>
      <View
        style={{
          flexDirection: "row",
          height: 26,
          alignItems: "center",
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          borderBottomWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.separator,
          backgroundColor: theme.dark ? "#262626" : "#FAFAFA",
        }}
      >
        {COLUMNS.map((c, i) => (
          <HeaderCell
            key={c.key}
            column={c}
            first={i === 0}
            active={sort.key === c.key}
            descending={sort.descending}
            onPress={() => setSort((s) => (s.key === c.key ? { key: c.key, descending: !s.descending } : { key: c.key, descending: c.key !== "task" }))}
          />
        ))}
      </View>
      <ScrollView style={{ flex: 1 }}>
        {rows.map((row, i) => (
          <TaskRow
            key={row.id}
            row={row}
            stripe={i % 2 === 1}
            selected={row.id === selected}
            onSelect={() => setSelected(row.id)}
            onOpen={() => row.tabIds[0] && switchToTab(row.tabIds[0])}
          />
        ))}
      </ScrollView>
      <View
        style={{
          height: 48,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 14,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.separator,
        }}
      >
        <Text style={{ flex: 1, fontSize: 12, color: theme.textSecondary }}>
          {tasks.length ? `${tasks.length} tasks · ${bytes(totalMemory)} in use` : "Loading…"}
        </Text>
        <Button title="End Process" onPress={endProcess} disabled={!selectedRow?.killable} />
      </View>
    </View>
  );
}

function HeaderCell({
  column,
  first,
  active,
  descending,
  onPress,
}: {
  column: Column;
  first: boolean;
  active: boolean;
  descending: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={column.width ? { width: column.width } : { flex: 1 }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Sort by ${column.title}`}>
        <View
          style={{
            height: 24,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: column.key === "task" ? "flex-start" : "flex-end",
            gap: 4,
            paddingLeft: first ? 14 : 8,
            paddingRight: 12,
            borderLeftWidth: first ? 0 : StyleSheet.hairlineWidth * 2,
            borderColor: colors.separator,
            backgroundColor: hovered ? colors.selected : undefined,
          }}
        >
          <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: active ? "600" : "500", color: active ? theme.textPrimary : theme.textSecondary }}>
            {column.title}
          </Text>
          {active ? (
            <Symbol name={descending ? "chevron.down" : "chevron.up"} size={8} weight="semibold" color={theme.textSecondary} style={{ width: 10, height: 10 }} />
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

function TaskRow({ row, stripe, selected, onSelect, onOpen }: { row: Row; stripe: boolean; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const lastPress = useRef(0);
  const text = selected ? "#FFFFFF" : theme.textPrimary;
  const detail = selected ? "rgba(255,255,255,0.85)" : theme.textSecondary;
  const icon = TYPE_ICONS[row.type] ?? "app.dashed";
  const press = () => {
    // Double-click a tab's task to go to the tab, like Chrome.
    const now = Date.now();
    if (now - lastPress.current < 350) onOpen();
    lastPress.current = now;
    onSelect();
  };
  return (
    <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={row.label} accessibilityState={{ selected }}>
      <View
        style={{
          height: ROW,
          flexDirection: "row",
          alignItems: "center",
          marginHorizontal: 6,
          borderRadius: 5,
          backgroundColor: selected ? colors.accent : stripe ? (theme.dark ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.028)") : undefined,
        }}
      >
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 8, paddingRight: 8 }}>
          {row.favicon ? (
            <Favicon url={row.favicon.url} favicon={row.favicon.favicon} size={16} profileId={row.favicon.profileId} />
          ) : row.type === "browser" ? (
            <Image source={ICON} style={{ width: 16, height: 16 }} />
          ) : (
            <Symbol name={icon} size={12} color={detail} style={{ width: 16, height: 16 }} />
          )}
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: text }}>
            {row.label}
          </Text>
        </View>
        <Cell width={COLUMNS[1]!.width!} color={text} value={bytes(row.memory)} />
        <Cell width={COLUMNS[2]!.width!} color={text} value={row.cpu < 0 ? "–" : row.cpu.toFixed(1)} />
        <Cell width={COLUMNS[3]!.width! - 6} color={text} value={row.gpuMemory > 0 ? bytes(row.gpuMemory) : "–"} />
      </View>
    </Pressable>
  );
}

function Cell({ width, value, color }: { width: number; value: string; color: string }) {
  return (
    <Text numberOfLines={1} style={{ width, paddingRight: 12, textAlign: "right", fontSize: 12, fontVariant: ["tabular-nums"], color }}>
      {value}
    </Text>
  );
}
