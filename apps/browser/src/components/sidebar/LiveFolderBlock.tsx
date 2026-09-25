import { ContextMenuArea, FadeLabel, Surface, Symbol } from "@netnyahoo/shell";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { closeTab } from "../../lib/actions";
import { hex, layout, useTheme } from "../../lib/theme";
import { COMPLETION_MS, errorText, openLiveItem, refreshFolder, statusText } from "../../live/engine";
import { prBadge } from "../../live/github";
import { folderRows, type FolderRow } from "../../live/rows";
import { SOURCES } from "../../live/sources";
import { setLive, updateFolder, useLive, profileFolders } from "../../live/store";
import type { CompletedItem, LiveItem } from "../../live/types";
import { useBrowser } from "../../store/browser";
import { usePageProfileId } from "../../store/hooks";
import { activeTabId, viewTabIds } from "../../store/model";
import { openSettings } from "../settings/windows";
import { IconButton, useHover } from "../primitives";
import { useLiveColors, type LiveColors } from "../live/colors";
import { clickMods, TabRow } from "./TabRow";
import { dismissHover, useRowHover } from "./hover";
import { openLiveFolderMenu, openLiveItemMenu } from "./liveMenus";
import { registerRow } from "./state";
import { TabIcon } from "./TabIcon";
import { useSidebarTokens } from "./tokens";

const PAD = 2;
const EMPTY: LiveItem[] = [];
const NONE: string[] = [];

/** A live item row's key for hover cards and anchoring ("live|<folder>|<item>"). */
export const liveRowKey = (folderId: string, itemId: string) => `live|${folderId}|${itemId}`;

/** The window profile's live folders, between the pinned groups and the tab list. */
export function LiveFolders({ windowId, spaced }: { windowId: string; spaced: boolean }) {
  const page = usePageProfileId();
  const profileId = useBrowser((s) => (s.windows[windowId]?.incognito ? "" : page));
  const ids = useLive(useShallow((s) => profileFolders(s, profileId)));
  if (!ids.length) return null;
  return (
    <View style={{ marginTop: spaced ? 7 : 0, marginBottom: 7, gap: layout.rowGap }}>
      {ids.map((id) => (
        <LiveFolderBlock key={id} folderId={id} windowId={windowId} />
      ))}
    </View>
  );
}

/** Height/opacity animation for a folder or stack opening and closing (GroupBlock's curve). */
function useDisclosure(collapsed: boolean) {
  const open = useRef(new Animated.Value(collapsed ? 0 : 1)).current;
  const [height, setHeight] = useState(0);
  const settled = useRef(collapsed);
  const [animating, setAnimating] = useState(false);
  const moving = animating || settled.current !== collapsed;
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setAnimating(true);
    Animated.timing(open, { toValue: collapsed ? 0 : 1, duration: 240, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: false }).start(({ finished }) => {
      if (!finished) return;
      settled.current = collapsed;
      setAnimating(false);
    });
  }, [collapsed]);
  const style = moving
    ? { height: open.interpolate({ inputRange: [0, 1], outputRange: [0, height] }), opacity: open, overflow: "hidden" as const }
    : collapsed
      ? { height: 0, opacity: 0, overflow: "hidden" as const }
      : null;
  return { style, moving, onLayout: (h: number) => setHeight(h) };
}

/**
 * Dia's live folder: a group-like box whose rows come from a service (pull
 * requests, documents). Rows open as tabs that stay in the folder; a closed
 * folder shows an unread pip when new items arrive.
 */
function LiveFolderBlock({ folderId, windowId }: { folderId: string; windowId: string }) {
  const tokens = useSidebarTokens();
  const folder = useLive((s) => s.folders[folderId]);
  const items = useLive((s) => s.items[folderId] ?? EMPTY);
  const showAll = useLive((s) => s.showAll);
  const collapsed = !!folder?.collapsed;
  const rows = useMemo(() => (folder ? folderRows(folder, items, showAll) : []), [folder, items, showAll]);
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const profileId = usePageProfileId();
  // Tabs from this folder whose item has left it (merged PR, filter change): shown as plain tabs at the end.
  const strays = useBrowser(
    useShallow((s) => viewTabIds(s, windowId, profileId).filter((id) => s.tabs[id]?.liveItem?.folderId === folderId && !itemIds.has(s.tabs[id]!.liveItem!.itemId))),
  );
  // Closed, the folder still shows the selected tab's row.
  const activeItem = useBrowser((s) => {
    const t = s.tabs[activeTabId(s, windowId, profileId) ?? ""];
    return t?.liveItem?.folderId === folderId ? t.liveItem.itemId : null;
  });
  const { style, moving, onLayout } = useDisclosure(collapsed);
  if (!folder) return null;
  const peek = collapsed && !moving && activeItem ? items.find((i) => i.id === activeItem) : undefined;
  const peekStray = collapsed && !moving && activeItem && !peek ? strays.find((id) => useBrowser.getState().tabs[id]?.liveItem?.itemId === activeItem) : undefined;

  return (
    <View style={{ borderRadius: 12, backgroundColor: tokens.groupFill, borderWidth: 0.5, borderColor: tokens.groupStroke, paddingHorizontal: PAD }}>
      <FolderHeader folderId={folderId} windowId={windowId} collapsed={collapsed} />
      {peek ? (
        <View style={{ paddingBottom: PAD }}>
          <LiveItemRow folderId={folderId} item={peek} windowId={windowId} />
        </View>
      ) : peekStray ? (
        <View style={{ paddingBottom: PAD }}>
          <TabRow tabId={peekStray} />
        </View>
      ) : null}
      <Animated.View style={style} pointerEvents={collapsed ? "none" : "auto"}>
        <View onLayout={(e) => onLayout(e.nativeEvent.layout.height)} style={{ gap: layout.rowGap, paddingBottom: PAD }}>
          <FolderBody folderId={folderId} windowId={windowId} rows={rows} hidden={peek?.id} />
          {strays.map((id) => (id === peekStray ? null : <TabRow key={id} tabId={id} />))}
          <CompletedFooter folderId={folderId} windowId={windowId} />
        </View>
      </Animated.View>
    </View>
  );
}

function FolderBody({ folderId, windowId, rows, hidden }: { folderId: string; windowId: string; rows: FolderRow[]; hidden?: string }) {
  const status = useLive((s) => s.status[folderId]);
  const kind = useLive((s) => s.folders[folderId]?.kind);
  if (!rows.length) {
    if (!status || status.state === "initializing" || (status.state === "updating" && !status.lastFetch)) return <NoteRow text="Loading…" spinner />;
    if (status.error) return <NoteRow text={errorText(status.error.kind, status.error.source)} onPress={() => openSettings("liveFolders")} icon="exclamationmark.triangle.fill" />;
    return <NoteRow text={kind === "pullRequests" ? "No open pull requests" : "No recent documents"} />;
  }
  return (
    <>
      {rows.map((row) => {
        switch (row.kind) {
          case "header":
            return <SectionTitle key={row.key} title={row.title} />;
          case "more":
            return <MoreRow key={row.key} folderId={folderId} section={row.section} count={row.count} />;
          case "stack":
            return <StackRow key={row.key} folderId={folderId} windowId={windowId} stack={row} />;
          case "item":
            return row.item.id === hidden ? null : <LiveItemRow key={row.key} folderId={folderId} item={row.item} windowId={windowId} />;
        }
      })}
    </>
  );
}

function FolderHeader({ folderId, windowId, collapsed }: { folderId: string; windowId: string; collapsed: boolean }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const colors = useLiveColors();
  const folder = useLive((s) => s.folders[folderId]);
  const count = useLive((s) => s.items[folderId]?.length ?? 0);
  const unread = useLive((s) => (s.unread[folderId]?.length ?? 0) > 0);
  const status = useLive((s) => s.status[folderId]);
  const { hovered, hoverProps } = useHover();
  if (!folder) return null;
  const updating = status?.state === "updating" || status?.state === "initializing";
  const sourceSite = SOURCES[folder.sources[0] ?? "github"].site;
  // A folder fed by several services gets a neutral glyph instead of one service's icon.
  const icon = folder.icon ?? (folder.sources.length > 1 && folder.kind === "documents" ? "symbol:doc.text" : null);

  return (
    <View ref={(v) => registerRow(windowId, `livefolder|${folderId}`, v)} {...hoverProps}>
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openLiveFolderMenu(windowId, folderId);
        }}
      >
        <Pressable
          onPress={() => {
            dismissHover();
            updateFolder(folderId, { collapsed: !collapsed });
          }}
        >
          {({ pressed }) => (
            <Surface
              fill={hex(pressed ? theme.tabPressed : hovered ? tokens.groupHeaderHover : "rgba(0,0,0,0)")}
              cornerRadius={10}
              style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 6 - PAD }}
            >
              <TabIcon url={sourceSite} icon={icon} />
              <FadeLabel text={folder.name} fontSize={13} weight="medium" color={tokens.groupTitle} style={{ flex: 1, height: 18, marginLeft: 5 }} />
              {status?.error ? (
                <Pressable onPress={() => openSettings("liveFolders")} tooltip={errorText(status.error.kind, status.error.source)} style={{ marginRight: 2 }}>
                  <Symbol name="exclamationmark.triangle.fill" size={10} color={colors.pending} style={{ width: 18, height: 18 }} />
                </Pressable>
              ) : null}
              {hovered || updating ? (
                <RefreshButton spinning={updating} tooltip={statusText(folderId)} onPress={() => void refreshFolder(folderId)} />
              ) : collapsed ? (
                <View style={{ flexDirection: "row", alignItems: "center", marginRight: 2, gap: 5 }}>
                  {unread ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.pip }} /> : null}
                  <View style={{ minWidth: 20, height: 18, borderRadius: 9, paddingHorizontal: 6, backgroundColor: tokens.countPill, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textTab, fontVariant: ["tabular-nums"] }}>{count}</Text>
                  </View>
                </View>
              ) : null}
            </Surface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

/** Refresh ↻ (Dia's "Button to refresh this live folder"); spins while fetching. */
function RefreshButton({ spinning, tooltip, onPress }: { spinning: boolean; tooltip: string; onPress(): void }) {
  const theme = useTheme();
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning) return;
    turn.setValue(0);
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [spinning]);
  if (!spinning) return <IconButton icon="arrow.clockwise" size={10} weight="semibold" box={22} radius={6} onPress={onPress} tooltip={tooltip} />;
  return (
    <View tooltip={tooltip} style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>
        <Symbol name="arrow.clockwise" size={10} weight="semibold" color={theme.textSecondary} style={{ width: 14, height: 14 }} />
      </Animated.View>
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <View style={{ height: 22, justifyContent: "flex-end", paddingLeft: 9, paddingBottom: 2 }}>
      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: theme.textSecondary }}>
        {title}
      </Text>
    </View>
  );
}

function NoteRow({ text, icon, spinner, onPress }: { text: string; icon?: string; spinner?: boolean; onPress?: () => void }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const { hovered, hoverProps } = useHover();
  const body = (
    <View style={{ height: 28, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 6, gap: 6, borderRadius: 8, backgroundColor: onPress && hovered ? theme.rowHover : undefined }}>
      {spinner ? <Spinner /> : icon ? <Symbol name={icon} size={10} color={colors.pending} style={{ width: 16, height: 16 }} /> : null}
      <Text numberOfLines={2} style={{ flex: 1, fontSize: 12, color: theme.textSecondary }}>
        {text}
      </Text>
    </View>
  );
  return (
    <View {...hoverProps}>
      {onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body}
    </View>
  );
}

function Spinner() {
  const theme = useTheme();
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center", transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>
      <Symbol name="arrow.triangle.2.circlepath" size={10} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
    </Animated.View>
  );
}

/** "Show N More" (Dia's cell that reveals more items in a live folder). */
function MoreRow({ folderId, section, count }: { folderId: string; section: string; count: number }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={() => setLive((s) => ({ showAll: { ...s.showAll, [`${folderId}:${section}`]: true } }))}>
        <View style={{ height: 26, borderRadius: 8, flexDirection: "row", alignItems: "center", paddingLeft: 9, backgroundColor: hovered ? theme.rowHover : undefined }}>
          <Symbol name="ellipsis" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
          <Text style={{ marginLeft: 5, fontSize: 12, color: theme.textSecondary }}>Show {count} More</Text>
        </View>
      </Pressable>
    </View>
  );
}

/** Stacked PRs (Dia's "Pull request stack"): a disclosure row over its members, each with its position. */
function StackRow({ folderId, windowId, stack }: { folderId: string; windowId: string; stack: Extract<FolderRow, { kind: "stack" }> }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const collapsed = useLive((s) => s.expandedStacks[stack.id] === false);
  const { style, onLayout } = useDisclosure(collapsed);
  const { hovered, hoverProps } = useHover();
  const repo = stack.repo.split("/")[1] ?? stack.repo;
  return (
    <View>
      <View {...hoverProps}>
        <Pressable
          onPress={() => setLive((s) => ({ expandedStacks: { ...s.expandedStacks, [stack.id]: collapsed } }))}
          accessibilityLabel={collapsed ? "Expand pull request stack" : "Collapse pull request stack"}
        >
          <View style={{ height: 26, borderRadius: 8, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 8, backgroundColor: hovered ? theme.rowHover : undefined }}>
            <Symbol name="square.stack.3d.up" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
            <Text numberOfLines={1} style={{ flex: 1, marginLeft: 5, fontSize: 12, fontWeight: "500", color: theme.textSecondary }}>
              {repo} stack
            </Text>
            <View style={{ minWidth: 18, height: 16, borderRadius: 8, paddingHorizontal: 5, backgroundColor: tokens.countPill, alignItems: "center", justifyContent: "center", marginRight: 4 }}>
              <Text style={{ fontSize: 10, fontWeight: "600", color: theme.textTab, fontVariant: ["tabular-nums"] }}>{stack.items.length}</Text>
            </View>
            <Symbol name={collapsed ? "chevron.right" : "chevron.down"} size={9} weight="semibold" color={theme.textSecondary} style={{ width: 12, height: 12 }} />
          </View>
        </Pressable>
      </View>
      <Animated.View style={style} pointerEvents={collapsed ? "none" : "auto"}>
        <View onLayout={(e) => onLayout(e.nativeEvent.layout.height)} style={{ gap: layout.rowGap, paddingTop: layout.rowGap }}>
          {stack.items.map((item) => (
            <LiveItemRow key={item.id} folderId={folderId} item={item} windowId={windowId} indent={10} />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * One item: its tab when open (selected like a tab row), else a row that opens
 * it. PRs show their most urgent state at the trailing edge; the hover card has
 * the details. A merged / reviewed PR pops a check, then folds away.
 */
function LiveItemRow({ folderId, item, windowId, indent = 0 }: { folderId: string; item: LiveItem; windowId: string; indent?: number }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const key = liveRowKey(folderId, item.id);
  const profileId = usePageProfileId();
  const tabId = useBrowser((s) => viewTabIds(s, windowId, profileId).find((id) => s.tabs[id]?.liveItem?.itemId === item.id && s.tabs[id]?.liveItem?.folderId === folderId) ?? null);
  const active = useBrowser((s) => !!tabId && activeTabId(s, windowId, profileId) === tabId);
  const unread = useLive((s) => !!s.unread[folderId]?.includes(item.id));
  const completion = useLive((s) => (s.completing[folderId]?.includes(item.id) ? (s.completed[folderId]?.find((c) => c.item.id === item.id)?.state ?? "merged") : null));
  const { hovered, hoverProps } = useRowHover(windowId, completion ? null : { kind: "live", id: key });
  const fold = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!completion) return;
    fold.setValue(1);
    // Hold on the check, then fold the row away just before it leaves the list.
    Animated.sequence([
      Animated.delay(COMPLETION_MS - 420),
      Animated.timing(fold, { toValue: 0, duration: 360, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: false }),
    ]).start();
  }, [completion]);
  const fill = active ? theme.tabSelected : hovered ? theme.tabHover : "rgba(0,0,0,0)";

  return (
    <Animated.View style={completion ? { height: fold.interpolate({ inputRange: [0, 1], outputRange: [0, layout.rowHeight] }), opacity: fold, overflow: "hidden" } : null}>
      <View ref={(v) => registerRow(windowId, key, v)} {...hoverProps}>
        <ContextMenuArea
          onContextMenu={() => {
            dismissHover();
            void openLiveItemMenu(windowId, folderId, item, tabId);
          }}
        >
          <Pressable
            onPress={(e) => {
              dismissHover();
              openLiveItem(windowId, folderId, item, { background: clickMods(e).metaKey });
            }}
          >
            {({ pressed }) => (
              <Surface
                fill={hex(!active && pressed ? theme.tabPressed : fill)}
                cornerRadius={10}
                borderWidth={active ? 1 : 0}
                borderColors={active ? theme.tabSelectedBorder.map(hex) : undefined}
                shadowColor={active ? hex(theme.tabSelectedShadow) : undefined}
                shadowOpacity={active ? 1 : 0}
                shadowRadius={theme.tabSelectedShadowRadius}
                shadowOffset={[0, 0.5]}
                style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9 + indent, paddingRight: 6 }}
              >
                {unread ? <View style={{ position: "absolute", left: 2 + indent, width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.pip }} /> : null}
                <ItemIcon item={item} completion={completion} colors={colors} />
                <FadeLabel
                  text={item.title}
                  fontSize={13}
                  weight={unread ? "medium" : undefined}
                  color={active ? theme.tabSelectedText : completion ? theme.textSecondary : theme.textTab}
                  style={{ flex: 1, height: 18, marginLeft: 5 }}
                />
                {item.pr?.stack ? <PositionChip position={item.pr.stack.position} /> : null}
                {hovered && tabId && !completion ? (
                  <IconButton icon="xmark" size={10} weight="semibold" box={22} radius={6} onPress={() => void closeTab(tabId)} tooltip="Close Tab (⌘W)" />
                ) : (
                  <Trailing item={item} completion={completion} colors={colors} />
                )}
              </Surface>
            )}
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}

function PositionChip({ position }: { position: number }) {
  const theme = useTheme();
  const colors = useLiveColors();
  return (
    <View style={{ minWidth: 16, height: 16, borderRadius: 5, paddingHorizontal: 4, marginLeft: 4, backgroundColor: colors.chip, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 10, fontWeight: "600", color: theme.textSecondary, fontVariant: ["tabular-nums"] }}>{position}</Text>
    </View>
  );
}

const COMPLETION_GLYPH: Record<CompletedItem["state"], { symbol: string; color: keyof LiveColors }> = {
  merged: { symbol: "checkmark.circle.fill", color: "merged" },
  reviewed: { symbol: "checkmark.circle.fill", color: "success" },
  closed: { symbol: "xmark.circle.fill", color: "draft" },
};

function ItemIcon({ item, completion, colors }: { item: LiveItem; completion: CompletedItem["state"] | null; colors: LiveColors }) {
  const pop = useRef(new Animated.Value(completion ? 0 : 1)).current;
  useEffect(() => {
    if (!completion) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, speed: 14, bounciness: 14, useNativeDriver: false }).start();
  }, [completion]);
  if (completion) {
    const glyph = COMPLETION_GLYPH[completion];
    return (
      <Animated.View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center", transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
        <Symbol name={glyph.symbol} size={14} weight="semibold" color={colors[glyph.color]} style={{ width: 16, height: 16 }} />
      </Animated.View>
    );
  }
  if (item.pr) {
    return <Symbol name="arrow.triangle.pull" size={12} weight="semibold" color={item.pr.draft ? colors.draft : colors.success} style={{ width: 16, height: 16 }} />;
  }
  if (item.icon && /^https?:/.test(item.icon)) return <TabIcon url={item.url} favicon={item.icon} direct />;
  // Confluence sites are custom domains without a favicon the service knows: use Atlassian's.
  return <TabIcon url={item.source === "confluence" && !item.icon ? SOURCES.confluence.site : item.url} icon={item.icon} />;
}

const BADGES: Record<NonNullable<ReturnType<typeof prBadge>>, { symbol: string | null; color: keyof LiveColors; tip: string }> = {
  conflict: { symbol: "exclamationmark.triangle.fill", color: "conflict", tip: "Merge conflicts" },
  failing: { symbol: "xmark.circle.fill", color: "failure", tip: "Checks are failing" },
  changesRequested: { symbol: "arrow.uturn.backward.circle.fill", color: "failure", tip: "Changes Requested" },
  pending: { symbol: null, color: "pending", tip: "Some checks haven't completed yet" },
  approved: { symbol: "checkmark.circle.fill", color: "success", tip: "Approved" },
  passed: { symbol: "checkmark", color: "success", tip: "All checks have passed" },
};

function Trailing({ item, completion, colors }: { item: LiveItem; completion: CompletedItem["state"] | null; colors: LiveColors }): ReactNode {
  const theme = useTheme();
  if (completion) {
    return <Text style={{ fontSize: 11, fontWeight: "500", color: colors[COMPLETION_GLYPH[completion].color], marginRight: 4 }}>{completion === "merged" ? "Merged" : completion === "reviewed" ? "Reviewed" : "Closed"}</Text>;
  }
  const badge = item.pr ? prBadge(item.pr) : null;
  if (!badge) return <View style={{ width: 4 }} />;
  const spec = BADGES[badge];
  return (
    <View tooltip={spec.tip} style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
      {spec.symbol ? (
        <Symbol name={spec.symbol} size={11} weight="semibold" color={colors[spec.color]} style={{ width: 16, height: 16 }} />
      ) : (
        <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors[spec.color], borderWidth: 0.5, borderColor: theme.dark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.1)" }} />
      )}
    </View>
  );
}

/**
 * "N Completed": PRs that were merged, closed or reviewed recently. Hovering
 * pulls them back into view (Dia 1.23) — click one to open it.
 */
function CompletedFooter({ folderId, windowId }: { folderId: string; windowId: string }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const completing = useLive((s) => s.completing[folderId] ?? NONE);
  const completed = useLive(useShallow((s) => (s.completed[folderId] ?? []).filter((c) => Date.now() - c.at < 24 * 3_600_000)));
  const [open, setOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = completed.filter((c) => !completing.includes(c.item.id));
  if (!shown.length) return null;
  const enter = () => {
    clearTimeout(hideTimer.current);
    setOpen(true);
  };
  const leave = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), 250);
  };
  return (
    <View onMouseEnter={enter} onMouseLeave={leave} style={{ gap: layout.rowGap }}>
      <View style={{ height: 24, flexDirection: "row", alignItems: "center", paddingLeft: 9, borderRadius: 8, backgroundColor: open ? theme.rowHover : undefined }}>
        <Symbol name="checkmark.circle" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
        <Text style={{ marginLeft: 5, fontSize: 12, color: theme.textSecondary }}>{shown.length} Completed</Text>
      </View>
      {open
        ? shown.slice(0, 8).map((c) => (
            <Pressable key={c.item.id} onPress={() => openLiveItem(windowId, folderId, c.item)}>
              {({ pressed }) => (
                <View style={{ height: 28, borderRadius: 8, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 8, backgroundColor: pressed ? theme.tabPressed : undefined, opacity: 0.75 }}>
                  <Symbol name={COMPLETION_GLYPH[c.state].symbol} size={12} color={colors[COMPLETION_GLYPH[c.state].color]} style={{ width: 16, height: 16 }} />
                  <FadeLabel text={c.item.title} fontSize={12.5} color={theme.textSecondary} style={{ flex: 1, height: 17, marginLeft: 5 }} />
                </View>
              )}
            </Pressable>
          ))
        : null}
    </View>
  );
}
