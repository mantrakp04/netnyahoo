import { ContextMenuArea, FadeLabel, raiseView, setTrafficLightsCenter, Surface, Symbol, WindowDragRegion } from "@arcadia/shell";
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, findNodeHandle, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { closeTab, toggleMute } from "../../lib/actions";
import { hex, layout, ThemeScope, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { PageProfileContext, useIsActiveTab, usePageProfileId, useSettings, useTab, useTabLive, useWindowId, useWindowProfileId } from "../../store/hooks";
import { ProfileIndicator, useProfileIndicatorWidth } from "../ProfileIndicator";
import { HoverSlot } from "../HoverSlot";
import { IconButton, useHover } from "../primitives";
import { clickTab } from "../sidebar/actions";
import { openGroupMenu, openTabMenu } from "../sidebar/menus";
import { TabIcon } from "../sidebar/TabIcon";
import { TabBadges } from "../media/TabBadges";
import { GROUP_COLORS, useSidebarTokens, withAlpha } from "../sidebar/tokens";
import { modifiersOf } from "./controls";
import { usePageStyle, usePagerPages } from "./profilePager";
import { ProfileSwipeArea } from "./ProfileSwipe";
import { openNewTabInSplit } from "./splitActions";
import { setMeasuredWidth, useMeasuredWidths } from "./measuredWidths";
import { usePeek } from "./usePeek";
import {
  dragGeometry,
  dragRange,
  dropIndex,
  GROUP_MARGIN_LEFT,
  GROUP_MARGIN_RIGHT,
  GROUP_SPRING,
  groupLayout,
  MEMBERS_INSET,
  memberInteractive,
  moveIndex,
  stripEntries,
  stripTabWidth,
  TAIL_EXPANDED,
  TUCK_FADE_MS,
  tuckTarget,
  type DragGeometry,
  type DragSlot,
} from "./stripGroups";
import { makeRoom, registerSlot, reorderOffsets, settleRoom, SLIDE } from "./stripReorder";
import { beginTabDrag, cancelTabDrag, endTabDrag, setDragPicture, setInsert, setInsertResolver, updateTabDrag, useTabDrag } from "./tabDrag";
import { toolbarPalette, useEasedColor, type ToolbarPalette } from "./toolbarColors";

// Dia's top strip, from a 2x capture of 1.50.1: the card starts 42 below the window top, and everything in the
// strip (window buttons, icons, titles) centres on y 21.
export const TOP_STRIP_HEIGHT = 42;
export const TOP_CARD_INSET = 6;
const MID = 21;
// Hover backgrounds, the pinned group and the + button: 32 tall, 5…37.
const ITEM_HEIGHT = 32;
const ITEM_TOP = MID - ITEM_HEIGHT / 2;
// The selected tab rises from the card: fill from y 3 with top corners of 10 and concave 15 pt flares at its foot,
// and a 0.5 pt rim just outside it that fades out down the sides.
const TAB_TOP = 3;
const TAB_RADIUS = 10;
const FLARE = 15;
const RIM_HEIGHT = 27.5;
const PEEK_PAD = 7;
const PEEK_HEIGHT = ITEM_HEIGHT + PEEK_PAD * 2;
const PEEK_BORDER = 0.5;
// Pinned tabs share one container: 34 pt cells 2 apart, 16 pt icons.
const PINNED_CELL = 34;
const PINNED_SPACING = 2;
const DOCK_GAP = 4.5;
const MIN_CHIP = 96;
const MAX_CHIP = 173;
const GAP = 4;
// A tab pulled this far below the strip leaves it for the page (Dia: its split targets came between 5.5 and 26 pt).
const LIFT_SLOP = 12;
const LIFT_MS = 150;
// The first item starts at x 86, 12 pt after the zoom button.
const LIGHTS_GAP = 8;
const LIGHTS_CENTER: [number, number] = [20.75, 20.75];

// The drop-down strip (full screen, auto-hidden tabs) has no card to attach the selected tab to.
const FloatingStrip = createContext(false);

type Member = { kind: "tab"; id: string; group: string | null } | { kind: "split"; id: string; tabIds: string[]; group: string | null };
type GroupEntry = { kind: "group"; id: string; collapsed: boolean; members: Member[] };
type Entry = { kind: "dock"; ids: string[] } | GroupEntry | Member;

// The controls at the strip's end: the profile chip (at most PROFILE_ROOM), then the downloads button.
const PROFILE_ROOM = 140;
const DOWNLOADS_BOX = 34;
const CONTROLS_GAP = 2;

// `width`: the window's (the peek's, floating), from its parent, so a strip mounting again lays its tabs out right on its
// first frame. `hidden`: page full screen keeps the strip mounted out of view, and gives the traffic lights back.
// `swipe`: the strip pages profiles; a hidden peek's doesn't, or switching profiles would wait on its pager.
export function TopTabStrip({ width, floating = false, hidden = false, swipe = true }: { width: number; floating?: boolean; hidden?: boolean; swipe?: boolean }) {
  const windowId = useWindowId();
  const current = useWindowProfileId();
  const { pages } = usePagerPages(windowId);
  const profileChip = useProfileIndicatorWidth(PROFILE_ROOM);
  const controls = (profileChip ? profileChip + CONTROLS_GAP : 0) + DOWNLOADS_BOX;
  const left = floating ? 8 : layout.trafficLightsWidth + LIGHTS_GAP;
  const right = Math.max(84, controls + 8 + 6);
  const pageWidth = Math.max(0, width - left - right);
  const flare = floating ? 0 : FLARE;

  useEffect(() => {
    if (floating || hidden) return;
    void setTrafficLightsCenter(windowId, LIGHTS_CENTER);
    return () => void setTrafficLightsCenter(windowId, null);
  }, [floating, hidden, windowId]);

  return (
    <FloatingStrip.Provider value={floating}>
      <View style={{ height: TOP_STRIP_HEIGHT }}>
        <WindowDragRegion style={StyleSheet.absoluteFill} />
        {/* The clip starts a flare's width early so the first tab's flare isn't cut, and ends at the profile chip and
            download button, so tabs scrolled past the end never show under them. */}
        <View style={{ position: "absolute", left: left - flare, right: Math.max(right - flare, controls + 8), top: 0, bottom: 0, overflow: "hidden" }}>
          {pages.map((page) => (
            <StripPage key={page.id} profileId={page.id} slot={page.slot} pageWidth={pageWidth} current={page.id === current} resting={!!page.resting} />
          ))}
        </View>
        <View mouseDownCanMoveWindow={false} style={{ position: "absolute", right: 8, top: MID - 17, flexDirection: "row", alignItems: "center", gap: CONTROLS_GAP }}>
          <ProfileIndicator room={PROFILE_ROOM} />
          <IconButton
            icon="arrow.down.circle"
            size={16}
            box={DOWNLOADS_BOX}
            radius={10}
            tooltip="Downloads (⇧⌘J)"
            onPress={() => {
              const s = useBrowser.getState();
              s.setDownloadsOpen(windowId, !s.windowUi[windowId]?.downloadsOpen);
            }}
          />
        </View>
        {swipe && <ProfileSwipeArea surface="strip" style={StyleSheet.absoluteFill} pageWidth={pageWidth + flare * 2} />}
        {!floating && <StripDropHighlight left={left} right={right} />}
      </View>
    </FloatingStrip.Provider>
  );
}

// A tab dragged from another window over this one lands at the end of its strip: the strip lights up meanwhile.
function StripDropHighlight({ left, right }: { left: number; right: number }) {
  const windowId = useWindowId();
  const theme = useTheme();
  const over = useTabDrag((d) => d.overWindow === windowId);
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(glow, { toValue: over ? 1 : 0, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [over]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: left - 4,
        right: right - 4,
        top: ITEM_TOP - 1,
        height: ITEM_HEIGHT + 2,
        borderRadius: TAB_RADIUS + 1,
        borderWidth: 1.5,
        borderColor: theme.accent,
        backgroundColor: theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        opacity: glow,
      }}
    />
  );
}

// A tab dragged from another window over this one's tabs: the strip makes room for it where the pointer is, as
// Dia's does, and the tab lands there (tabDrag.ts › insert). `origin`: the first gap, where the tabs start.
function useIncomingTab(windowId: string, current: boolean, top: DragGeometry) {
  const active = useTabDrag((d) => current && d.tabIds.length > 0 && d.windowId !== windowId);
  const point = useTabDrag((d) => (current && d.overWindow === windowId ? d.overPoint : null));
  const origin = useRef<View>(null);
  const [start, setStart] = useState<number | null>(null);
  // Where the tabs start, measured again as the pointer moves (the strip may scroll).
  useEffect(() => {
    if (!point) return setStart(null);
    origin.current?.measureInWindow((x) => setStart((old) => (old === x ? old : x)));
  }, [point?.[0], point?.[1]]);
  const index = incomingIndex(top, point, start);
  const beforeId = index === null ? undefined : (top.slots[index]?.tabIds[0] ?? null);
  useEffect(() => setInsert(windowId, beforeId), [beforeId, windowId]);
  // The drop asks again at the pointer where it ended.
  const latest = useRef({ top, start });
  latest.current = { top, start };
  useEffect(() => {
    if (!current) return;
    setInsertResolver(windowId, (p) => {
      const i = incomingIndex(latest.current.top, p, latest.current.start);
      return i === null ? undefined : (latest.current.top.slots[i]?.tabIds[0] ?? null);
    });
    return () => {
      setInsertResolver(windowId, null);
      setInsert(windowId, undefined);
    };
  }, [windowId, current]);
  return { active, at: index, origin };
}

// Over the strip (with a little slack below it), at the slot whose centre the pointer passed; never among a
// pinned group's tabs or before them (a dropped tab isn't pinned).
function incomingIndex(top: DragGeometry, point: [number, number] | null, start: number | null): number | null {
  if (!point || start === null || point[1] > TOP_STRIP_HEIGHT + 24) return null;
  const x = point[0] - start;
  let index = top.slots.filter((slot, i) => top.lefts[i]! + slot.width / 2 < x).length;
  const groups = useBrowser.getState().groups;
  const pinnedGroup = (id: string | undefined) => !!id && Object.values(groups).some((g) => g.pinned && g.tabIds.includes(id));
  while (index < top.slots.length && pinnedGroup(top.slots[index]!.tabIds[0])) index++;
  return index;
}

// The room an incoming tab gets: none (and no row gap) until the pointer is there, then a tab's width.
function IncomingGap({ open, width, origin }: { open: boolean; width: number; origin?: React.RefObject<View | null> }) {
  const room = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    // JS driver: width and margin are layout. Dia: ~0.05 s.
    Animated.timing(room, { toValue: open ? 1 : 0, duration: 120, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [open]);
  return (
    <Animated.View
      ref={origin}
      pointerEvents="none"
      style={{
        height: TOP_STRIP_HEIGHT,
        width: room.interpolate({ inputRange: [0, 1], outputRange: [0, width] }),
        marginRight: room.interpolate({ inputRange: [0, 1], outputRange: [-GAP, 0] }),
      }}
    />
  );
}

function StripPage({ profileId, slot, pageWidth, current, resting }: { profileId: string; slot: number; pageWidth: number; current: boolean; resting: boolean }) {
  const windowId = useWindowId();
  const flare = useContext(FloatingStrip) ? 0 : FLARE;
  // Pages sit their whole width apart, flares included: only a page's width apart, the next profile's selected tab
  // and its flare showed at the clip's end, under the profile chip.
  const pageStyle = usePageStyle(windowId, slot, pageWidth + flare * 2);
  const entries = useBrowser((s) => stripEntries(s, windowId, profileId));
  const activeId = useBrowser((s) => s.windows[windowId]?.activeTabIds[profileId] ?? "");
  const parsed = useMemo(() => parseEntries(entries), [entries]);
  // Each group's chip as measured (its name's width), so the tabs' width leaves it room. Kept for the session: a strip
  // mounting again (the peek, a layout or sidebar switch) lays out right at once. A new group shows once it's measured.
  const groupIds = parsed.flatMap((e) => (e.kind === "group" ? [e.id] : []));
  const chipWidths = useMeasuredWidths(groupIds.map(chipKey));
  const chipOf = (groupId: string) => chipWidths[groupIds.indexOf(groupId)];
  // What's out in the strip: collapsed groups show only their active member.
  const visible = parsed.flatMap((e): Member[] => (e.kind === "group" ? (e.collapsed ? e.members.filter((m) => holds(m, activeId)) : e.members) : e.kind === "dock" ? [] : [e]));
  const pinnedCount = parsed.reduce((n, e) => n + (e.kind === "dock" ? e.ids.length : 0), 0);
  const chip = stripTabWidth({
    pageWidth,
    dockWidth: pinnedCount ? pinnedCount * (PINNED_CELL + PINNED_SPACING) - PINNED_SPACING + DOCK_GAP : 0,
    groups: parsed.flatMap((e) => (e.kind === "group" ? [{ chip: chipOf(e.id) ?? 0, expanded: !e.collapsed, shown: e.members.some((m) => holds(m, activeId)) }] : [])),
    tabUnits: visible.reduce((n, m) => n + units(m), 0),
    gap: GAP,
    plus: ITEM_HEIGHT,
    min: MIN_CHIP,
    max: MAX_CHIP,
  });
  // A tab dragged along the strip trades places with whole tabs, splits and groups.
  const top = dragGeometry(
    parsed.flatMap((e): DragSlot[] => {
      if (e.kind === "dock") return [];
      if (e.kind !== "group") return [{ tabIds: tabsOf(e), width: chip * units(e) }];
      const widths = e.members.map((m) => chip * units(m));
      const shown = e.members.findIndex((m) => holds(m, activeId));
      const width = groupLayout(chipOf(e.id) ?? 0, widths, GAP, !e.collapsed, shown).width;
      return [{ tabIds: e.members.flatMap(tabsOf), width, marginLeft: GROUP_MARGIN_LEFT, marginRight: GROUP_MARGIN_RIGHT }];
    }),
    GAP,
  );
  const slotOf = (id: string) => top.slots.findIndex((slot) => slot.tabIds[0] === id);
  const dockIds = parsed.flatMap((e) => (e.kind === "dock" ? e.ids : []));
  const strip = useMemo(
    () => ({ top, dock: dockIds.length ? { ids: dockIds, left: -(dockWidth(dockIds.length) + DOCK_GAP) } : null }),
    [top, dockIds.join()],
  );
  const incoming = useIncomingTab(windowId, current, top);
  let slotIndex = 0;
  const gap = (i: number) => (incoming.active ? <IncomingGap key={`gap${i}`} open={incoming.at === i} width={chip} origin={i === 0 ? incoming.origin : undefined} /> : null);

  return (
    <Animated.View
      pointerEvents={current ? "auto" : "none"}
      style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pageWidth + flare * 2, display: resting ? "none" : "flex", ...pageStyle }}
    >
      <PageProfileContext.Provider value={profileId}>
        <ThemeScope>
          <DockContext.Provider value={strip}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flex: 1 }}
              contentContainerStyle={{ alignItems: "flex-start", gap: GAP, paddingLeft: flare, paddingRight: flare }}
            >
              {/* One flat keyed list: a reordered item moves rather than mounting afresh (nested arrays are keyed by
                  position, so a tab dropped into another place was a new view, and its settle and its neighbours'
                  slide had nothing to run on). */}
              {parsed.flatMap((e) => {
                if (e.kind === "dock") return <PinnedDock key="dock" tabIds={e.ids} />;
                const before = gap(slotIndex++);
                if (e.kind === "group")
                  return [
                    before,
                    <StripGroup
                      key={e.id}
                      entry={e}
                      geometry={top}
                      from={slotOf(e.members[0] ? tabsOf(e.members[0])[0]! : "")}
                      chip={chip}
                      activeId={activeId}
                      chipWidth={chipOf(e.id)}
                      onChipWidth={(width) => setMeasuredWidth(chipKey(e.id), width)}
                    />,
                  ];
                if (e.kind === "split")
                  return [before, <SplitChip key={e.id} tabIds={e.tabIds} width={chip * Math.min(e.tabIds.length, 2)} geometry={top} from={slotOf(e.tabIds[0]!)} group={null} />];
                return [before, <DraggableChip key={e.id} tabId={e.id} width={chip} geometry={top} from={slotOf(e.id)} group={null} />];
              })}
              {gap(top.slots.length)}
              <NewTabButton windowId={windowId} />
            </ScrollView>
          </DockContext.Provider>
        </ThemeScope>
      </PageProfileContext.Provider>
    </Animated.View>
  );
}

function parseEntries(keys: string[]): Entry[] {
  const out: Entry[] = [];
  const groups = new Map<string, GroupEntry>();
  for (const key of keys) {
    const [kind, id, a, b] = key.split(":");
    if (kind === "pinned") {
      const last = out[out.length - 1];
      if (last?.kind === "dock") last.ids.push(id!);
      else out.push({ kind: "dock", ids: [id!] });
      continue;
    }
    if (kind === "group") {
      const group: GroupEntry = { kind, id: id!, collapsed: a === "1", members: [] };
      groups.set(group.id, group);
      out.push(group);
      continue;
    }
    const member: Member = kind === "split" ? { kind, id: id!, tabIds: a!.split(","), group: b || null } : { kind: "tab", id: id!, group: a || null };
    const group = member.group ? groups.get(member.group) : undefined;
    if (group) group.members.push(member);
    else out.push(member);
  }
  return out;
}

const chipKey = (groupId: string) => `strip-group-chip|${groupId}`;
const holds = (m: Member, tabId: string) => (m.kind === "split" ? m.tabIds.includes(tabId) : m.id === tabId);
const tabsOf = (m: Member) => (m.kind === "split" ? m.tabIds : [m.id]);
// A split shows at most two panes' width.
const units = (m: Member) => (m.kind === "split" ? Math.min(m.tabIds.length, 2) : 1);

// What a strip item drags: `tabId` is the tab the page can split with (none for a whole split); `ids` move along
// the strip and out of the window (a tab with the rest of a multi-selection, or a split's panes).
// `axis`: "y" for a split's pane, which leaves the strip on its own, while its split moves along the strip as one.
// `range`: how far it may travel when it can leave its own row (a tab into the pinned dock, a pinned tab out of it);
// `drop`: handles the release first (true: done). `local`: a group, which only moves along the strip.
type StripDrag = {
  tabId: string | null;
  ids: () => string[];
  pinned: boolean;
  groupId: string | null;
  geometry: DragGeometry;
  from: number;
  width: number;
  gap: number;
  axis?: "x" | "y";
  range?: [number, number];
  drop?: (dx: number, ids: string[]) => boolean;
  local?: boolean;
};

// Where the pinned dock sits, from the left of the strip's first tab (or group): pinned tabs and tabs cross it.
type Dock = { ids: string[]; left: number };
const dockWidth = (cells: number) => cells * (PINNED_CELL + PINNED_SPACING) - PINNED_SPACING;
const DockContext = createContext<{ dock: Dock | null; top: DragGeometry } | null>(null);

// An item follows the pointer along the strip, trading places with whole tabs, splits and groups. Pulled down
// past the strip a tab leaves it for the page (whose split targets show, SplitChrome.tsx); let go outside the
// window, it moves to the window under the pointer or a new one (tabDrag.ts). Items are
// `mouseDownCanMoveWindow={false}`: no view consumes the press, so it climbed the responder chain to the strip's
// WindowDragRegion, which moved the window under the pointer instead of the tab (it leaves such presses alone).
function useStripDrag(item: StripDrag) {
  const dx = useRef(new Animated.Value(0)).current;
  // How far it slides aside while another item of its row is dragged over its place (stripReorder.ts).
  const shift = useRef(new Animated.Value(0)).current;
  const translateX = useRef(Animated.add(dx, shift)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const view = useRef<View>(null);
  const latest = useRef(item);
  latest.current = item;
  const drag = useRef({ stripBottom: TOP_STRIP_HEIGHT, lifted: false, ids: [] as string[], dx: 0, to: -1 });
  useEffect(() => registerSlot(() => latest.current.geometry, () => latest.current.from, shift), []);
  const setLifted = (lifted: boolean) => {
    if (drag.current.lifted === lifted) return;
    drag.current.lifted = lifted;
    // JS driver: the strip closes the gap the tab leaves.
    Animated.timing(lift, { toValue: lifted ? 1 : 0, duration: LIFT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  };
  // The place its row makes for it (`to`), as its leading edge passes a neighbour's centre; none once it's lifted
  // off the strip, whose gap closes instead.
  const makeRoomAt = (to: number) => {
    const { geometry, from } = latest.current;
    if (from < 0 || to === drag.current.to) return;
    drag.current.to = to;
    makeRoom(geometry, from, to < 0 ? from : to);
  };
  const owns = useRef(false);
  // Drawn over the row while dragged and settling (a group's member over the group's other members).
  const raised = useRef<number | null>(null);
  const raise = (on: boolean) => {
    const tag = on ? findNodeHandle(view.current) : raised.current;
    raiseView(tag, latest.current.groupId ? 1 : 0, on);
    raised.current = on ? tag : null;
  };
  const reset = () => {
    owns.current = false;
    makeRoomAt(-1);
    dx.setValue(0);
    setLifted(false);
    setDragging(false);
    raise(false);
  };
  // Let go: it settles into its new place (`to`; none: back home) with the row already laid out around it, and
  // only then does the store move it: until that one update, nothing reorders the views, so it stays drawn on top.
  const settle = useRef<{ land: () => void } | null>(null);
  const settleInto = (to: number | null, commit: () => boolean) => {
    const { geometry, from } = latest.current;
    if (to === null) makeRoomAt(-1);
    const landing = {
      land: () => {
        if (settle.current !== landing) return;
        settle.current = null;
        // The row stands where it is about to be laid out, then one store update (React renders it at once here,
        // outside an event, so the row's items are this geometry's only until then), the item at rest: one batch.
        if (to !== null) {
          settleRoom(geometry);
          commit();
        }
        dx.setValue(0);
        setDragging(false);
        raise(false);
      },
    };
    settle.current = landing;
    Animated.spring(dx, { toValue: to === null ? 0 : (reorderOffsets(geometry, from, to)[from] ?? 0), ...SLIDE }).start(() => landing.land());
  };
  // Closed mid-drag (⌘W): RN drops the responder without telling it, so the drag would stay open and block the next;
  // the row it was passing stands where it is laid out.
  useEffect(
    () => () => {
      settle.current?.land();
      if (!owns.current) return;
      settleRoom(latest.current.geometry);
      if (!latest.current.local) cancelTabDrag();
    },
    [],
  );
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => {
          // RN grants a parent that asks for a drag before the child holding it can refuse: a split doesn't ask
          // while its pane is dragging.
          if (useTabDrag.getState().tabIds.length) return false;
          const axis = latest.current.axis;
          if (axis === "y") return Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx);
          if (axis === "x") return Math.abs(g.dx) > 4;
          return Math.abs(g.dx) > 4 || Math.abs(g.dy) > 6;
        },
        onPanResponderGrant: (e) => {
          const ids = latest.current.ids();
          const grab: [number, number] = [e.nativeEvent.pageX, e.nativeEvent.pageY];
          // Pressed again while settling from the last drop: it lands first.
          settle.current?.land();
          dx.stopAnimation();
          dx.setValue(0);
          const mine = { stripBottom: TOP_STRIP_HEIGHT, lifted: false, ids, dx: 0, to: -1 };
          drag.current = mine;
          owns.current = true;
          setDragging(true);
          if (latest.current.from >= 0) raise(true);
          if (latest.current.local) return;
          const seq = beginTabDrag(ids.length === 1 ? latest.current.tabId : null, ids);
          view.current?.measureInWindow((x, y, width, height) => {
            // This drag's measure: a later drag has its own.
            if (drag.current !== mine) return;
            mine.stripBottom = y + TOP_STRIP_HEIGHT;
            // Its picture, taken if it leaves the strip: where it is along the strip by then.
            setDragPicture(seq, () => [x + mine.dx, y, width, height], [grab[0] + mine.dx, grab[1]]);
          });
        },
        onPanResponderMove: (_, g) => {
          const { geometry, from, tabId, range, local } = latest.current;
          // Only a tab leaves the strip for the page; a split or a selection stays on it until it leaves the window.
          const lifted = !local && !!tabId && drag.current.ids.length === 1 && g.moveY > drag.current.stripBottom + LIFT_SLOP;
          setLifted(lifted);
          const [min, max] = range ?? (from < 0 ? [0, 0] : dragRange(geometry, from));
          if (!lifted) {
            drag.current.dx = Math.max(min, Math.min(max, g.dx));
            dx.setValue(drag.current.dx);
          }
          makeRoomAt(lifted || from < 0 ? -1 : dropIndex(geometry, from, g.dx));
          if (!local) updateTabDrag(g.moveX, g.moveY, lifted);
        },
        onPanResponderRelease: (_, g) => {
          const lifted = drag.current.lifted;
          const { local, drop, from, range, geometry } = latest.current;
          owns.current = false;
          // Over the page or out of the window: tabDrag.ts (a split, another window or a new one).
          if ((!local && (endTabDrag() || lifted)) || from < 0) return reset();
          const travelled = range ? Math.max(range[0], Math.min(range[1], g.dx)) : g.dx;
          const ids = drag.current.ids;
          // Into or out of the pinned dock (its own drop), or a selection whose other tabs move too: its place isn't
          // along this row, so the store moves it now and it's simply there.
          if (!local) {
            const store = useBrowser.getState();
            const moved = drop?.(travelled, ids) || (ids.length > 1 && reorder(ids, latest.current, g.dx));
            if (moved && useBrowser.getState() !== store) settleRoom(geometry);
            if (moved) return reset();
          }
          // PanResponder resets its gesture state after this handler: the drop's travel, kept for the landing.
          const at = g.dx;
          const to = dropIndex(geometry, from, at);
          settleInto(to === from ? null : to, () => {
            const store = useBrowser.getState();
            if (local) drop?.(travelled, ids);
            else reorder(ids, latest.current, at);
            return useBrowser.getState() !== store;
          });
        },
        onPanResponderTerminate: () => {
          const local = latest.current.local;
          reset();
          if (!local) cancelTabDrag();
        },
      }),
    [],
  );
  const style = {
    zIndex: dragging ? 10 : 0,
    // Opaque while dragged, as Dia's: the tab it passes doesn't show through.
    opacity: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    marginRight: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -(item.width + item.gap)] }),
    transform: [{ translateX }],
  };
  return { ref: view, panHandlers: responder.panHandlers, style, dragging };
}

// True when the store moved it.
function reorder(ids: string[], { geometry, from, pinned, groupId }: StripDrag, dx: number): boolean {
  const s = useBrowser.getState();
  const tab = s.tabs[ids[0] ?? ""];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w) return false;
  const to = dropIndex(geometry, from, dx);
  if (ids.length === 1) {
    // One tab: its place among the section's tabs (which keeps it in or out of its group as it was).
    const section = w.tabIds.filter((id) => s.tabs[id]?.profileId === tab.profileId && !!s.tabs[id]?.pinned === pinned);
    const index = moveIndex(section, tab.id, geometry.slots, from, to);
    if (index === null) return false;
    s.moveTab(tab.id, index);
    return true;
  }
  if (to === from) return false;
  // Before the first tab of the slot it lands on that isn't moving along (a multi-selection's other tabs), else
  // before whatever follows the strip's last slot.
  const others = geometry.slots.filter((_, i) => i !== from);
  let beforeId = others.slice(to).flatMap((slot) => slot.tabIds).find((id) => !ids.includes(id)) ?? null;
  if (!beforeId) {
    const last = w.tabIds.indexOf(others.at(-1)?.tabIds.at(-1) ?? "");
    beforeId = last < 0 ? null : (w.tabIds.slice(last + 1).find((id) => !ids.includes(id)) ?? null);
  }
  s.placeTabs(ids, { pinned, beforeId, groupId });
  return true;
}

// The tab and, when it's part of the window's multi-selection, the rest of the selection, in strip order.
function withSelection(tabId: string): string[] {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  const selection = tab ? (s.selection[tab.windowId] ?? []) : [];
  if (selection.length < 2 || !selection.includes(tabId)) return [tabId];
  return s.windows[tab!.windowId]!.tabIds.filter((id) => selection.includes(id) && !!s.tabs[id]?.pinned === tab!.pinned);
}

function DraggableChip({ tabId, width, geometry, from, group, tuck }: { tabId: string; width: number; geometry: DragGeometry; from: number; group: string | null; tuck?: () => void }) {
  const active = useIsActiveTab(tabId);
  const strip = useContext(DockContext);
  // A tab outside groups may go on into the pinned dock, and is pinned there.
  const dock = !group && from >= 0 ? (strip?.dock ?? null) : null;
  const range: [number, number] | undefined = dock ? [dock.left - geometry.lefts[from]!, dragRange(geometry, from)[1]] : undefined;
  const drag = useStripDrag({
    tabId,
    ids: () => withSelection(tabId),
    pinned: false,
    groupId: group,
    geometry,
    from,
    width,
    gap: GAP,
    range,
    drop: (dx, ids) => {
      if (!dock) return false;
      // Its leading edge decides, as along the strip (a tab is wider than the dock): past the last pinned tab's middle.
      const left = geometry.lefts[from]! + dx;
      if (left > dock.left + (dock.ids.length - 1) * (PINNED_CELL + PINNED_SPACING) + PINNED_CELL / 2) return false;
      const index = dock.ids.filter((_, i) => dock.left + i * (PINNED_CELL + PINNED_SPACING) + PINNED_CELL / 2 < left + PINNED_CELL / 2).length;
      useBrowser.getState().placeTabs(ids, { pinned: true, beforeId: dock.ids[index] ?? null });
      return true;
    },
  });
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} mouseDownCanMoveWindow={false} style={{ ...drag.style, zIndex: drag.dragging ? 10 : active ? 1 : 0 }}>
      <TabChip tabId={tabId} width={width} tuck={tuck} dragged={drag.dragging} />
    </Animated.View>
  );
}

// The toolbar's website colour, eased the same way, so the selected tab and the toolbar read as one surface.
function useWebsiteBand(tabId: string) {
  const theme = useTheme();
  const extend = useSettings((s) => s.extendWebsiteColor);
  const url = useTab(tabId)?.url;
  const themeColor = useTabLive(tabId, (l) => l.themeColor);
  const palette = toolbarPalette(theme, extend && url ? themeColor : null);
  return { palette, band: useEasedColor(palette.background) };
}

// `tuck`: the active tab of a collapsed group shows Dia's "–" instead of ✕, tucking it back into the group.
function TabChip({ tabId, width, tuck, dragged }: { tabId: string; width: number; tuck?: () => void; dragged: boolean }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const floating = useContext(FloatingStrip);
  const playing = useTabLive(tabId, (l) => l.playingAudio);
  const { palette, band } = useWebsiteBand(tabId);
  const { hovered, hoverProps } = useHover();
  if (!tab) return null;
  const title = tab.customTitle || tab.title || tab.url || "New Tab";
  const onBand = active && !floating && !!palette.background;
  return (
    <View {...hoverProps} tooltip={tab.url ? `${title}\n${tab.url}` : title} style={{ width, height: TOP_STRIP_HEIGHT }}>
      {active && <SelectedTab width={width} band={band} opaque={dragged} />}
      <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)} style={StyleSheet.absoluteFill}>
        <Pressable onPress={(e) => clickTab(windowId, tab.id, modifiersOf(e))} style={{ flex: 1 }}>
          {({ pressed }) => (
            <ItemRow hovered={hovered && !active} pressed={pressed && !active}>
              {/* Not hit: an image view under a press in an inactive window moves the window (AppKit's first mouse). */}
              <View pointerEvents="none">
                <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                <TabBadges tabId={tab.id} pip={false} />
              </View>
              {(playing || tab.muted) && (
                <Pressable onPress={() => toggleMute(tab.id)} style={{ marginLeft: 5 }} tooltip={tab.muted ? "Unmute" : "Mute"}>
                  <Symbol name={tab.muted ? "speaker.slash" : "speaker.wave.2"} size={11} color={onBand ? palette.icon : theme.textTab} style={{ width: 16, height: 16 }} />
                </Pressable>
              )}
              <FadeLabel
                text={title}
                fontSize={12}
                color={onBand ? palette.text : active ? theme.tabSelectedText : theme.textTab}
                // The label draws 2 pt in, so the text starts 7 after the favicon.
                style={{ flex: 1, height: 16, marginLeft: 5 }}
              />
              <HoverSlot
                hovered={hovered}
                width={20}
                hover={
                  <IconButton
                    icon={tuck ? "minus" : "xmark"}
                    size={9}
                    weight="semibold"
                    box={20}
                    radius={5}
                    color={onBand ? palette.icon : undefined}
                    onPress={tuck ?? (() => void closeTab(tab.id))}
                    tooltip={tuck ? "Hide in Group" : "Close Tab"}
                  />
                }
              />
            </ItemRow>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

// A tab's content row, 5…37, with Dia's hover and pressed fills for a tab that isn't selected.
function ItemRow({ hovered, pressed, children }: { hovered: boolean; pressed: boolean; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: ITEM_TOP,
        height: ITEM_HEIGHT,
        borderRadius: TAB_RADIUS,
        backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 9.5,
        paddingRight: 6,
      }}
    >
      {children}
    </View>
  );
}

type Fill = string | ReturnType<typeof useEasedColor>;

// The selected tab: the card's own fill (and the toolbar's website colour over it) rising out of the card. `opaque`:
// dragged or settling, as Dia's: the card (half clear in dark) goes over the window's own opaque tint, so it looks as it
// does at rest and the tab it passes doesn't show through.
function SelectedTab({ width, band, opaque = false }: { width: number; band: Fill | null; opaque?: boolean }) {
  const theme = useTheme();
  const floating = useContext(FloatingStrip);
  if (floating) {
    const card = {
      position: "absolute" as const,
      left: 0,
      top: ITEM_TOP,
      width,
      height: ITEM_HEIGHT,
      borderRadius: TAB_RADIUS,
    };
    return (
      <>
        {opaque && <View pointerEvents="none" style={{ ...card, backgroundColor: theme.windowTint[0] }} />}
        <View
          pointerEvents="none"
          style={{
            ...card,
            borderWidth: 0.5,
            borderColor: theme.dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)",
            backgroundColor: theme.card,
          }}
        />
      </>
    );
  }
  const body = width - 1;
  const fills: Fill[] = [...(opaque ? [theme.windowTint[0]] : []), theme.card, ...(band ? [band] : [])];
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height: TOP_STRIP_HEIGHT }}>
      {fills.map((fill, i) => (
        <Fragment key={i}>
          <Animated.View
            style={{
              position: "absolute",
              left: 0.5,
              top: TAB_TOP,
              width: body,
              height: TOP_STRIP_HEIGHT - TAB_TOP,
              borderTopLeftRadius: TAB_RADIUS,
              borderTopRightRadius: TAB_RADIUS,
              backgroundColor: fill,
            }}
          />
          <Flare x={0.5 - FLARE} side="left" color={fill} />
          <Flare x={0.5 + body} side="right" color={fill} />
        </Fragment>
      ))}
      <Surface
        cornerRadius={TAB_RADIUS + 0.5}
        borderWidth={0.5}
        borderColors={[theme.dark ? "#FFFFFF3B" : "#FFFFFFFA", "#FFFFFF00"]}
        style={{ position: "absolute", left: 0, top: TAB_TOP - 0.5, width, height: RIM_HEIGHT }}
      />
    </View>
  );
}

// The tab's concave foot: an r×r square filled outside a circle of radius r centred on its outer top corner.
function Flare({ x, side, color }: { x: number; side: "left" | "right"; color: Fill }) {
  const outer = FLARE * 2;
  return (
    <View style={{ position: "absolute", left: x, top: TOP_STRIP_HEIGHT - FLARE, width: FLARE, height: FLARE, overflow: "hidden" }}>
      <Animated.View
        style={{
          position: "absolute",
          left: side === "left" ? -outer : FLARE - outer,
          top: -outer,
          width: outer * 2,
          height: outer * 2,
          borderRadius: outer,
          borderWidth: FLARE,
          borderColor: color,
        }}
      />
    </View>
  );
}

// Dia keeps pinned tabs in one shared container (the TabDockItemResting fill and stroke), not a tile each.
function PinnedDock({ tabIds }: { tabIds: string[] }) {
  const theme = useTheme();
  // Pinned tabs trade places among themselves, or go out among the tabs (unpinned).
  const geometry = useMemo(() => dragGeometry(tabIds.map((id) => ({ tabIds: [id], width: PINNED_CELL })), PINNED_SPACING), [tabIds]);
  return (
    <View
      style={{
        marginTop: ITEM_TOP,
        marginRight: DOCK_GAP - GAP,
        // Over the tabs while one of its tabs is dragged out among them.
        zIndex: 2,
        width: tabIds.length * (PINNED_CELL + PINNED_SPACING) - PINNED_SPACING,
        height: ITEM_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: TAB_RADIUS,
        borderWidth: 0.5,
        borderColor: theme.pinnedRestingStroke,
        backgroundColor: theme.pinnedResting,
      }}
    >
      {/* The stroke sits inside the container, over the cells' outer edges. */}
      <View style={{ flexDirection: "row", gap: PINNED_SPACING, marginHorizontal: -0.5 }}>
        {tabIds.map((id, i) => (
          <PinnedCell key={id} tabId={id} geometry={geometry} from={i} />
        ))}
      </View>
    </View>
  );
}

function PinnedCell({ tabId, geometry, from }: { tabId: string; geometry: DragGeometry; from: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const { hovered, hoverProps } = useHover();
  const strip = useContext(DockContext);
  const dock = strip?.dock;
  const top = strip?.top;
  // From the dock's start, past the strip's last item.
  // With no tabs yet, room for one after the dock.
  const end = top && top.slots.length ? top.lefts.at(-1)! + top.slots.at(-1)!.width : MAX_CHIP;
  const range: [number, number] | undefined = dock ? [-geometry.lefts[from]!, end - dock.left - geometry.lefts[from]! - PINNED_CELL] : undefined;
  const drag = useStripDrag({
    tabId,
    ids: () => withSelection(tabId),
    pinned: true,
    groupId: null,
    geometry,
    from,
    width: PINNED_CELL,
    gap: PINNED_SPACING,
    range,
    drop: (dx, ids) => {
      if (!dock || !top) return false;
      const left = dock.left + geometry.lefts[from]! + dx;
      if (left + PINNED_CELL / 2 < -DOCK_GAP / 2) return false;
      const k = top.slots.filter((slot, i) => top.lefts[i]! + slot.width / 2 < left + PINNED_CELL).length;
      useBrowser.getState().placeTabs(ids, { pinned: false, beforeId: top.slots[k]?.tabIds[0] ?? null });
      return true;
    },
  });
  if (!tab) return null;
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} mouseDownCanMoveWindow={false} style={drag.style}>
      <View {...hoverProps} tooltip={`${tab.customTitle || tab.title || tab.url}${tab.url ? `\n${tab.url}` : ""}`}>
        <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)}>
          <Pressable onPress={(e) => clickTab(windowId, tab.id, modifiersOf(e))}>
            {({ pressed }) => (
              <View style={{ width: PINNED_CELL, height: ITEM_HEIGHT - 1, alignItems: "center", justifyContent: "center" }}>
                {(active || hovered || pressed) && (
                  <View
                    style={{
                      position: "absolute",
                      left: 2,
                      right: 2,
                      top: 2,
                      bottom: 2,
                      borderRadius: 8,
                      backgroundColor: pressed ? theme.tabPressed : active ? theme.pinnedSelectedFill : theme.tabHover,
                    }}
                  />
                )}
                <View pointerEvents="none">
                  <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                  <TabBadges tabId={tab.id} pip={false} />
                </View>
              </View>
            )}
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}

// A tab group (stripGroups.ts): one container with the chip and the members. Collapsed, the members wait under
// the first slot, faded out, except the window's active tab; expanding slides them out to their places and
// collapsing slides them back, on Dia's spring.
function StripGroup({
  entry,
  geometry,
  from,
  chip,
  activeId,
  chipWidth,
  onChipWidth,
}: {
  entry: GroupEntry;
  geometry: DragGeometry;
  from: number;
  chip: number;
  activeId: string;
  chipWidth: number | undefined;
  onChipWidth: (width: number) => void;
}) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const windowId = useWindowId();
  const profileId = usePageProfileId();
  const group = useBrowser((s) => s.groups[entry.id]);
  const { hovered, hoverProps } = useHover();
  const expanded = !entry.collapsed;
  const widths = entry.members.map((m) => chip * units(m));
  const shown = entry.members.findIndex((m) => holds(m, activeId));
  const chipSize = chipWidth ?? 0;
  const { offsets, width } = groupLayout(chipSize, widths, GAP, expanded, shown);
  // Inside an open group, a member trades places with the other members only.
  const members = useMemo(() => dragGeometry(entry.members.map((m, i) => ({ tabIds: tabsOf(m), width: widths[i]! })), GAP), [entry.members, chip]);
  const tuckable = useBrowser((s) => !expanded && shown >= 0 && !!tuckTarget(s, windowId, profileId, entry.id));
  const open = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const size = useRef(new Animated.Value(width)).current;
  const state = `${expanded}:${shown >= 0 ? entry.members[shown]!.id : ""}`;
  const settled = useRef(state);
  // While the group springs, members that are still sliding (and fading) in take no clicks.
  const [moving, setMoving] = useState(false);
  const springs = useRef(0);
  useEffect(() => {
    // JS driver: `open` moves each member's `left` and `size` is the group's width, which reflows the strip.
    const spring = (value: Animated.Value, toValue: number) => Animated.spring(value, { toValue, ...GROUP_SPRING, useNativeDriver: false });
    const run = (animation: Animated.CompositeAnimation) => {
      const id = ++springs.current;
      setMoving(true);
      animation.start(() => id === springs.current && setMoving(false));
    };
    if (settled.current !== state) {
      // Expanding, collapsing and a member coming out or going back spring.
      settled.current = state;
      run(Animated.parallel([spring(open, expanded ? 1 : 0), spring(size, width)]));
    } else if (moving) {
      // The width changed mid-spring (the chip measured, a member came or went): the spring takes the new target.
      run(spring(size, width));
    } else size.setValue(width);
  }, [state, width]);
  const fade = useMemo(() => open.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }), []);
  // Dragged by its chip, the group moves along the strip as one.
  const drag = useStripDrag({
    tabId: null,
    ids: () => useBrowser.getState().groups[entry.id]?.tabIds ?? [],
    pinned: false,
    groupId: null,
    geometry,
    from,
    width: 0,
    gap: 0,
    axis: "x",
    local: true,
    drop: (dx) => {
      const to = dropIndex(geometry, from, dx);
      if (to === from) return true;
      const others = geometry.slots.filter((_, i) => i !== from);
      const s = useBrowser.getState();
      s.moveGroup(entry.id, { pinned: !!s.groups[entry.id]?.pinned, beforeId: others[to]?.tabIds[0] ?? null });
      return true;
    },
  });
  const tail = useMemo(() => Animated.add(size, -(TAIL_EXPANDED - 2.25)), []);
  if (!group) return null;
  const tint = group.color ? GROUP_COLORS[group.color].hex : null;
  const divider = theme.dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)";
  const tuck = () => {
    const s = useBrowser.getState();
    const target = tuckTarget(s, windowId, profileId, entry.id);
    if (target) s.activate(target);
  };
  return (
    <Animated.View
      ref={drag.ref}
      style={{ width: size, height: TOP_STRIP_HEIGHT, marginLeft: GROUP_MARGIN_LEFT, marginRight: GROUP_MARGIN_RIGHT, zIndex: drag.style.zIndex, transform: drag.style.transform, opacity: chipWidth === undefined ? 0 : 1 }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top: ITEM_TOP,
          width: size,
          height: ITEM_HEIGHT,
          borderRadius: TAB_RADIUS,
          borderWidth: 0.5,
          borderColor: theme.pinnedRestingStroke,
          // Dia lightens the whole container while the pointer is on the chip.
          backgroundColor: tint ? withAlpha(tint, hovered ? 0.24 : 0.18) : hovered ? tokens.groupHeaderHover : tokens.groupFill,
        }}
      />
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: chipSize + 0.75, top: MID - 7.5, width: 0.5, height: 15, backgroundColor: divider, opacity: fade }} />
      {entry.members.map((m, i) => (
        <GroupMember
          key={m.id}
          member={m}
          width={widths[i]!}
          start={chipSize + MEMBERS_INSET}
          offset={offsets[i]!}
          open={open}
          interactive={memberInteractive(i === shown, expanded, moving)}
          shown={i === shown}
          geometry={members}
          // A collapsed group's shown tab has no neighbours to trade places with.
          from={expanded ? i : -1}
          tuck={tuckable && i === shown ? tuck : undefined}
        />
      ))}
      <Animated.View pointerEvents={expanded ? "box-none" : "none"} mouseDownCanMoveWindow={false} style={{ position: "absolute", top: ITEM_TOP, height: ITEM_HEIGHT, left: tail, flexDirection: "row", alignItems: "center", opacity: fade }}>
        <View style={{ width: 0.5, height: 15, backgroundColor: divider }} />
        <IconButton icon="xmark" size={9} weight="semibold" box={24} radius={6} style={{ marginLeft: 1 }} onPress={() => useBrowser.getState().closeGroup(entry.id)} tooltip="Close Group" />
      </Animated.View>
      <View
        {...hoverProps}
        {...drag.panHandlers}
        mouseDownCanMoveWindow={false}
        tooltip={expanded ? "Collapse Group" : "Expand Group"}
        onLayout={(e) => onChipWidth(Math.ceil(e.nativeEvent.layout.width * 2) / 2)}
        style={{ position: "absolute", left: 0, top: ITEM_TOP, height: ITEM_HEIGHT }}
      >
        <ContextMenuArea onContextMenu={() => void openGroupMenu(windowId, entry.id)}>
          <Pressable
            onPress={() => useBrowser.getState().updateGroup(entry.id, { collapsed: expanded })}
            style={{ height: ITEM_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 8.5, paddingRight: 7 }}
          >
            {group.icon ? <Text style={{ width: 13, fontSize: 12, textAlign: "center" }}>{group.icon}</Text> : <GroupGlyph color={tint ?? (theme.dark ? "#FFFFFF4D" : "#0000004D")} />}
            <Text numberOfLines={1} style={{ marginLeft: 12.5, maxWidth: 120, fontSize: 12, fontWeight: "600", color: tint ?? (shown >= 0 ? theme.tabSelectedText : theme.textTab) }}>
              {group.name || `${group.tabIds.length} Tabs`}
            </Text>
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}

function GroupMember({
  member,
  width,
  start,
  offset,
  open,
  interactive,
  shown,
  geometry,
  from,
  tuck,
}: {
  member: Member;
  width: number;
  start: number;
  offset: number;
  open: Animated.Value;
  interactive: boolean;
  shown: boolean;
  geometry: DragGeometry;
  from: number;
  tuck?: () => void;
}) {
  // The shown member (the window's active tab while collapsed) fades in and out on its own: Dia's "–" fades the
  // tab back into the group while the tabs after it close the gap.
  const shownValue = useRef(new Animated.Value(shown ? 1 : 0)).current;
  useEffect(() => {
    // JS driver: it adds into `open`, which is layout.
    Animated.timing(shownValue, { toValue: shown ? 1 : 0, duration: TUCK_FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [shown]);
  const left = useMemo(() => open.interpolate({ inputRange: [0, 1], outputRange: [start, start + offset] }), [start, offset]);
  const opacity = useMemo(
    () =>
      Animated.add(shownValue, open.interpolate({ inputRange: [0, 0.5], outputRange: [0, 1], extrapolate: "clamp" })).interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolate: "clamp",
      }),
    [],
  );
  return (
    <Animated.View pointerEvents={interactive ? "box-none" : "none"} style={{ position: "absolute", top: 0, left, width, height: TOP_STRIP_HEIGHT, opacity, zIndex: shown ? 2 : 1 }}>
      {member.kind === "split" ? (
        <SplitChip tabIds={member.tabIds} width={width} geometry={geometry} from={from} group={member.group} />
      ) : (
        <DraggableChip tabId={member.id} width={width} geometry={geometry} from={from} group={member.group} tuck={tuck} />
      )}
    </Animated.View>
  );
}

// Dia's group glyph: a tab seen edge-on with two more behind it.
function GroupGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 13, height: 11, flexDirection: "row", alignItems: "center" }}>
      <View style={{ width: 1.25, height: 7, borderRadius: 0.625, backgroundColor: color, opacity: 0.5 }} />
      <View style={{ width: 1.25, height: 9, borderRadius: 0.625, marginLeft: 0.6, backgroundColor: color, opacity: 0.75 }} />
      <View style={{ width: 9.4, height: 10.6, borderRadius: 2.5, marginLeft: 0.5, backgroundColor: color }} />
    </View>
  );
}

// A split moves along the strip as one; each pane pulled down leaves it on its own (onto the page, or out of the
// window into one of its own), as Dia's split tab does.
function SplitChip({ tabIds, width, geometry, from, group }: { tabIds: string[]; width: number; geometry: DragGeometry; from: number; group: string | null }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const profileId = usePageProfileId();
  const focusedId = useBrowser((s) => s.windows[windowId]?.activeTabIds[profileId] ?? "");
  const active = tabIds.includes(focusedId);
  // Each pane has its own card and toolbar; the tab takes the focused pane's colour.
  const { band, palette } = useWebsiteBand(active ? focusedId : tabIds[0]!);
  const floating = useContext(FloatingStrip);
  const ink = active && !floating && palette.background ? palette : null;
  const { hovered, hoverProps } = useHover();
  const drag = useStripDrag({ tabId: null, ids: () => tabIds, pinned: false, groupId: group, geometry, from, width, gap: GAP, axis: "x" });
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} mouseDownCanMoveWindow={false} style={{ ...drag.style, zIndex: drag.dragging ? 10 : active ? 1 : 0 }}>
      <View {...hoverProps} style={{ width, height: TOP_STRIP_HEIGHT }}>
        {active && <SelectedTab width={width} band={band} opaque={drag.dragging} />}
        <ItemRow hovered={hovered && !active} pressed={false}>
          <Symbol name="rectangle.split.2x1" size={11} color={ink?.secondary ?? theme.textSecondary} style={{ width: 14, height: 16, marginRight: 4 }} />
          {tabIds.map((id, i) => (
            <SplitPart key={id} tabId={id} first={i === 0} ink={ink} />
          ))}
        </ItemRow>
      </View>
    </Animated.View>
  );
}

const NO_SLOTS = dragGeometry([], GAP);

function SplitPart({ tabId, first, ink }: { tabId: string; first: boolean; ink: ToolbarPalette | null }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const focused = useIsActiveTab(tabId);
  const drag = useStripDrag({ tabId, ids: () => [tabId], pinned: false, groupId: null, geometry: NO_SLOTS, from: -1, width: 0, gap: 0, axis: "y" });
  if (!tab) return null;
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} style={{ flex: 1, flexDirection: "row", alignItems: "center", opacity: drag.style.opacity }}>
      <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)} style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
        {!first && <View style={{ width: StyleSheet.hairlineWidth, height: 16, marginHorizontal: 6, backgroundColor: ink?.divider ?? theme.textTertiary }} />}
        <Pressable onPress={() => useBrowser.getState().activate(tab.id)} style={{ flex: 1, flexDirection: "row", alignItems: "center" }} tooltip={tab.title || tab.url}>
          <View pointerEvents="none">
            <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} profileId={tab.profileId} />
          </View>
          <FadeLabel text={tab.customTitle || tab.title || tab.url || "New Tab"} fontSize={12} color={ink ? (focused ? ink.text : ink.secondary) : focused ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 16, marginLeft: 5 }} />
        </Pressable>
      </ContextMenuArea>
    </Animated.View>
  );
}

function NewTabButton({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} mouseDownCanMoveWindow={false} tooltip="New Tab (⌘T) — ⌥-click to open in Split View" style={{ marginTop: ITEM_TOP, marginLeft: 0.5 }}>
      <Pressable
        onPress={(e) => {
          if (modifiersOf(e).altKey) openNewTabInSplit(windowId);
          else useBrowser.getState().newTab(windowId);
        }}
      >
        {({ pressed }) => (
          <View style={{ width: ITEM_HEIGHT, height: ITEM_HEIGHT, borderRadius: TAB_RADIUS, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined }}>
            <Symbol name="plus" size={13} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

/** The hover strip along the window's top that brings the tab strip's peek out, and where the peek sits. */
const HOVER_HEIGHT = 6;
const PEEK_LEFT = 6;
const PEEK_TOP = 4;

export function TopStripPeek({ windowWidth, enabled }: { windowWidth: number; enabled: boolean }) {
  const theme = useTheme();
  const { slide, live, show, hide } = usePeek(enabled);
  // The strip and the panel overlap (y 4–6), and AppKit sends no enter for a view that appears under the pointer, only a
  // leave once it goes. So a leave asks where the pointer went: into the other one keeps the peek out.
  const leaveStrip = (e: { nativeEvent: { clientY: number } }) => {
    if (live && e.nativeEvent.clientY < HOVER_HEIGHT) hide();
  };
  const leavePanel = (e: { nativeEvent: { clientX: number; clientY: number } }) => {
    const x = e.nativeEvent.clientX + PEEK_LEFT;
    const y = e.nativeEvent.clientY + PEEK_TOP;
    if (!(y >= 0 && y < HOVER_HEIGHT && x >= layout.trafficLightsWidth)) hide();
  };
  return (
    <>
      {enabled ? (
        <View
          onMouseEnter={show}
          onMouseLeave={leaveStrip}
          // No further right than the panel: a leave downwards is into it.
          style={{ position: "absolute", left: layout.trafficLightsWidth, right: PEEK_LEFT, top: 0, height: HOVER_HEIGHT }}
        />
      ) : null}
      <Animated.View
        pointerEvents={live ? "auto" : "none"}
        onMouseEnter={live ? show : undefined}
        onMouseLeave={live ? leavePanel : undefined}
        style={{
          position: "absolute",
          left: PEEK_LEFT,
          width: windowWidth - PEEK_LEFT * 2,
          // Out of the window while hidden (a transform doesn't move hover tracking): its tabs mustn't hover under the page.
          top: live ? PEEK_TOP : -10_000,
          height: PEEK_HEIGHT,
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-PEEK_HEIGHT - 8, 0] }) }],
        }}
      >
        <Surface
          fill={hex(theme.windowTint[0])}
          cornerRadius={12}
          borderColor={hex(theme.panelBorder)}
          borderWidth={PEEK_BORDER}
          shadowColor="#000000"
          shadowOpacity={theme.panelShadowOpacity}
          shadowRadius={20}
          shadowOffset={[0, 6]}
          style={{ flex: 1 }}
        >
          <View style={{ position: "absolute", left: 0, right: 0, top: PEEK_PAD - ITEM_TOP, height: TOP_STRIP_HEIGHT }}>
            {/* The border insets the strip. */}
            <TopTabStrip floating swipe={live} width={windowWidth - 12 - PEEK_BORDER * 2} />
          </View>
        </Surface>
      </Animated.View>
    </>
  );
}
