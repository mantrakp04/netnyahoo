import { hapticTick } from "@netnyahoo/shell";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, type ScrollView, type View } from "react-native";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import type { TabPlacement } from "../../store/organize";
import { beginTabDrag, cancelTabDrag, endTabDrag, setDragPicture, updateTabDrag, useTabDrag } from "../layout/tabDrag";
import { suppressHover } from "./hover";

type Frame = { x: number; y: number; w: number; h: number };
type Section = "tiles" | "pinnedGroups" | "list";

export type ItemSpec = {
  kind: "tile" | "row" | "group" | "split" | "tail";
  tabIds: string[];
  section: Section;
  groupId?: string;
  parentGroup?: string;
  collapsed?: boolean;
};

type Item = ItemSpec & {
  key: string;
  view: View | null;
  header: View | null;
  gap: Animated.Value;
  size: Animated.Value;
  frame: Frame | null;
  headerFrame: Frame | null;
};

type Drop =
  | { type: "tabs"; placement: TabPlacement }
  | { type: "group"; placement: { pinned: boolean; beforeId?: string | null } }
  | { type: "none" };

export type Ghost = { item: Item; count: number; width: number; height: number; position: Animated.ValueXY };

// The list stacks rows with `gap`; a zero-height tail cancels its gap with this negative margin.
const ROW_GAP = layout.rowGap;
const TILE_GAP = 6;
const EDGE = 28;
// JS driver: gaps and sizes are margins, widths and heights.
const spring = (value: Animated.Value, toValue: number) =>
  Animated.timing(value, { toValue, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: false });

const inside = (f: Frame, x: number, y: number, slop = 0) => x >= f.x - slop && x <= f.x + f.w + slop && y >= f.y - slop && y <= f.y + f.h + slop;
const measure = (view: View | null): Promise<Frame | null> =>
  view
    ? new Promise((resolve) => view.measureInWindow((x, y, w, h) => resolve(w || h ? { x, y, w, h } : null)))
    : Promise.resolve(null);

class DragController {
  items = new Map<string, Item>();
  regions = new Map<string, View | null>();
  root: View | null = null;
  scroll: ScrollView | null = null;
  scrollY = 0;
  setSources: (keys: Set<string>) => void = () => {};
  setGhost: (ghost: Ghost | null) => void = () => {};
  setDropInto: (groupId: string | null) => void = () => {};

  private sources: Item[] = [];
  private startScrollY = 0;
  private rootFrame: Frame = { x: 0, y: 0, w: 0, h: 0 };
  private regionFrames = new Map<string, Frame | null>();
  private viewport: Frame | null = null;
  private grab = { x: 0, y: 0 };
  private pointer = { x: 0, y: 0 };
  private ghost: Ghost | null = null;
  private gapKey: string | null = null;
  private dropKey = "";
  private drop: Drop = { type: "none" };
  private scrollTimer: ReturnType<typeof setInterval> | undefined;
  private measured = false;
  private token: object | null = null;

  create(key: string): Item {
    return { key, kind: "row", tabIds: [], section: "list", view: null, header: null, gap: new Animated.Value(0), size: new Animated.Value(0), frame: null, headerFrame: null };
  }

  get active() {
    return this.sources.length > 0;
  }

  async begin(key: string, x: number, y: number, selection: string[]) {
    const item = this.items.get(key);
    if (!item || item.kind === "tail") return;
    const selected = item.kind === "row" || item.kind === "tile" ? selection : [];
    const multi = selected.length > 1 && item.tabIds.some((id) => selected.includes(id));
    this.sources = multi
      ? [...this.items.values()].filter((i) => (i.kind === "row" || i.kind === "tile") && i.tabIds.some((id) => selected.includes(id)))
      : [item];
    const token = (this.token = {});
    suppressHover(true);
    let seq = 0;
    if (item.kind === "row" || item.kind === "tile") {
      const single = this.sources.length === 1 ? (item.tabIds[0] ?? null) : null;
      seq = beginTabDrag(single, [...new Set(this.sources.flatMap((i) => i.tabIds))]);
    }
    this.pointer = { x, y };
    this.measured = false;
    this.startScrollY = this.scrollY;
    await this.measureAll();
    if (this.token !== token || !this.sources.length) return;
    const frame = item.frame ?? { x, y, w: 176, h: 33 };
    this.grab = { x: x - frame.x, y: y - frame.y };
    if (seq) setDragPicture(seq, [frame.x, frame.y, frame.w, frame.h], [x, y]);
    const count = new Set(this.sources.flatMap((s) => s.tabIds)).size;
    const height = item.kind === "group" ? Math.min(frame.h, item.headerFrame?.h ?? 33) : frame.h;
    this.ghost = {
      item,
      count,
      width: frame.w,
      height,
      position: new Animated.ValueXY({ x: frame.x - this.rootFrame.x, y: frame.y - this.rootFrame.y }),
    };
    for (const s of this.sources) s.size.setValue(s.kind === "tile" ? (s.frame?.w ?? 0) : (s.frame?.h ?? 0));
    this.setSources(new Set(this.sources.map((s) => s.key)));
    this.setGhost(this.ghost);
    if (!this.regionFrames.get("tiles") && (item.kind === "row" || item.kind === "tile")) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      await this.measureAll();
      if (this.token !== token) return;
    }
    Animated.parallel(this.sources.map((s) => spring(s.size, 0))).start();
    this.measured = true;
    this.move(this.pointer.x, this.pointer.y);
  }

  private async measureAll() {
    const [rootFrame, viewport] = await Promise.all([measure(this.root), measure(this.scroll as unknown as View)]);
    this.rootFrame = rootFrame ?? this.rootFrame;
    this.viewport = viewport;
    this.startScrollY = this.scrollY;
    await Promise.all(
      [...this.items.values()].map(async (i) => {
        [i.frame, i.headerFrame] = await Promise.all([measure(i.view), measure(i.header)]);
      }),
    );
    for (const [name, view] of this.regions) this.regionFrames.set(name, await measure(view));
  }

  move(x: number, y: number) {
    this.pointer = { x, y };
    updateTabDrag(x, y);
    if (!this.measured || !this.ghost) return;
    this.ghost.position.setValue({ x: x - this.grab.x - this.rootFrame.x, y: y - this.grab.y - this.rootFrame.y });
    this.autoScroll(y);
    this.retarget();
  }

  end(commit: boolean) {
    clearInterval(this.scrollTimer);
    this.scrollTimer = undefined;
    const sources = this.sources;
    const drop = this.drop;
    // Page split drop takes precedence over sidebar drop.
    const splitDrop = commit ? endTabDrag() : (cancelTabDrag(), false);
    if (commit && !splitDrop && this.measured && sources.length) {
      const s = useBrowser.getState();
      const ids = sources.flatMap((i) => i.tabIds);
      if (drop.type === "tabs") s.placeTabs(ids, drop.placement);
      else if (drop.type === "group" && sources[0]!.groupId) s.moveGroup(sources[0]!.groupId, drop.placement);
    }
    // Reset the gap immediately; the store has already moved the item.
    for (const i of this.items.values()) {
      i.gap.stopAnimation();
      i.gap.setValue(0);
    }
    for (const i of sources) i.size.stopAnimation();
    this.sources = [];
    this.gapKey = null;
    this.dropKey = "";
    this.drop = { type: "none" };
    this.ghost = null;
    this.measured = false;
    this.token = null;
    suppressHover(false);
    this.setSources(new Set());
    this.setGhost(null);
    this.setDropInto(null);
  }

  private autoScroll(y: number) {
    const v = this.viewport;
    const speed = !v ? 0 : y < v.y + EDGE ? -Math.ceil((v.y + EDGE - y) / 4) : y > v.y + v.h - EDGE ? Math.ceil((y - (v.y + v.h - EDGE)) / 4) : 0;
    clearInterval(this.scrollTimer);
    this.scrollTimer = undefined;
    if (!speed || !this.scroll) return;
    this.scrollTimer = setInterval(() => {
      const next = Math.max(0, this.scrollY + speed);
      if (next === this.scrollY) return;
      this.scroll?.scrollTo({ y: next, animated: false });
      this.scrollY = next;
      this.retarget();
    }, 16);
  }

  private at(f: Frame | null): Frame | null {
    return f && { ...f, y: f.y - (this.scrollY - this.startScrollY) };
  }

  private retarget() {
    const { x, y } = this.pointer;
    const source = this.sources[0]!;
    const sourceKeys = new Set(this.sources.map((s) => s.key));
    const live = [...this.items.values()].filter((i) => !sourceKeys.has(i.key) && i.frame);
    const cy = (i: Item) => {
      const f = this.at(i.frame)!;
      return f.y + Math.min(f.h, i.headerFrame?.h ?? f.h) / 2;
    };
    const byY = (a: Item, b: Item) => this.at(a.frame)!.y - this.at(b.frame)!.y || a.frame!.x - b.frame!.x;
    const firstTab = (i: Item | undefined) => i?.tabIds[0] ?? null;
    const tabsDrag = source.kind === "row" || source.kind === "tile";
    const rowPitch = (source.kind === "group" ? (source.frame?.h ?? layout.rowHeight) : layout.rowHeight * Math.max(1, this.ghost?.count ?? 1)) + ROW_GAP;
    let drop: Drop = { type: "none" };
    let gapKey: string | null = null;
    let pitch = rowPitch;
    let into: string | null = null;

    const sidebar = this.viewport ?? this.rootFrame;
    const tiles = this.at(this.regionFrames.get("tiles") ?? null);
    if (x > sidebar.x + sidebar.w + 40 || x < sidebar.x - 40 || useTabDrag.getState().outside) {
      drop = { type: "none" };
    } else if (tabsDrag && tiles && inside(tiles, x, y, 6)) {
      const cells = live.filter((i) => i.kind === "tile").sort(byY);
      const before = cells.find((t) => {
        const f = this.at(t.frame)!;
        const mid = f.y + f.h / 2;
        return mid > y + f.h / 2 || (Math.abs(mid - y) <= f.h / 2 && f.x + f.w / 2 > x);
      });
      drop = { type: "tabs", placement: { pinned: true, beforeId: firstTab(before) } };
      gapKey = before?.key ?? "tail:tiles";
      pitch = (cells[0]?.frame?.w ?? source.frame?.w ?? 50) + TILE_GAP;
    } else {
      const groups = live.filter((i) => i.kind === "group");
      const box = tabsDrag
        ? groups.find((g) => {
            const f = this.at(g.frame)!;
            const header = this.at(g.headerFrame);
            if (g.collapsed) return !!header && inside(header, x, y) && Math.abs(y - (header.y + header.h / 2)) < header.h / 3;
            return inside(f, x, y) && (!header || y > header.y + header.h * 0.75);
          })
        : undefined;
      if (box?.collapsed) {
        drop = { type: "tabs", placement: { pinned: false, groupId: box.groupId!, beforeId: null } };
        into = box.groupId!;
      } else if (box) {
        const members = live.filter((i) => i.kind === "row" && i.parentGroup === box.groupId).sort(byY);
        const before = members.find((m) => cy(m) > y);
        drop = { type: "tabs", placement: { pinned: false, groupId: box.groupId!, beforeId: firstTab(before) } };
        gapKey = before?.key ?? `tail:group:${box.groupId}`;
      } else {
        const list = this.at(this.regionFrames.get("list") ?? null);
        const pinned = source.kind === "group" && !!list && y < list.y;
        const section: Section = pinned ? "pinnedGroups" : "list";
        const blocks = live.filter((i) => i.section === section && !i.parentGroup && i.kind !== "tail" && i.kind !== "tile").sort(byY);
        const before = blocks.find((b) => cy(b) > y);
        gapKey = before?.key ?? `tail:${section}`;
        drop =
          source.kind === "group"
            ? { type: "group", placement: { pinned, beforeId: firstTab(before) } }
            : { type: "tabs", placement: { pinned: false, beforeId: firstTab(before) } };
      }
    }
    if (source.kind === "split" && drop.type === "tabs" && (drop.placement.pinned || drop.placement.groupId)) {
      drop = { type: "none" };
      gapKey = null;
      into = null;
    }

    const key = JSON.stringify(drop);
    if (key === this.dropKey && gapKey === this.gapKey) return;
    if (this.dropKey && drop.type !== "none" && useBrowser.getState().settings.tabReorderHaptics) hapticTick();
    this.dropKey = key;
    this.drop = drop;
    this.setDropInto(into);
    if (gapKey !== this.gapKey) {
      const prev = this.gapKey && this.items.get(this.gapKey);
      if (prev) spring(prev.gap, 0).start();
      const next = gapKey && this.items.get(gapKey);
      if (next) spring(next.gap, pitch).start();
      this.gapKey = gapKey;
    }
  }
}

type DragState = { controller: DragController; sources: Set<string>; dropInto: string | null };
const DragContext = createContext<DragState | null>(null);

export function DragProvider({ children }: { children: (ghost: Ghost | null, controller: DragController) => ReactNode }) {
  const controller = useMemo(() => new DragController(), []);
  if (__DEV__) (globalThis as { sidebarDrag?: DragController }).sidebarDrag = controller;
  const [sources, setSources] = useState<Set<string>>(() => new Set());
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [dropInto, setDropInto] = useState<string | null>(null);
  controller.setSources = setSources;
  controller.setGhost = setGhost;
  controller.setDropInto = setDropInto;
  const value = useMemo(() => ({ controller, sources, dropInto }), [controller, sources, dropInto]);
  // The sidebar going away mid-drag (its window closing, the layout switching) ends the drag and its picture.
  useEffect(() => () => void (controller.active && controller.end(false)), [controller]);
  return (
    <DragContext.Provider value={value}>
      {children(ghost, controller)}
      <WindowDropHighlight />
    </DragContext.Provider>
  );
}

function WindowDropHighlight() {
  const windowId = useWindowId();
  const theme = useTheme();
  const over = useTabDrag((d) => d.overWindow === windowId);
  const glow = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    Animated.timing(glow, { toValue: over ? 1 : 0, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [over]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 5,
        right: 5,
        top: 44,
        bottom: 6,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: theme.accent,
        backgroundColor: theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        opacity: glow,
      }}
    />
  );
}

export function DragScope({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const ctx = useContext(DragContext);
  return <DragContext.Provider value={enabled ? ctx : null}>{children}</DragContext.Provider>;
}

export const useDragController = () => useContext(DragContext)?.controller;
export const useDropInto = () => useContext(DragContext)?.dropInto ?? null;

export function useDragItem(key: string, spec: ItemSpec, selection: () => string[] = () => []) {
  const ctx = useContext(DragContext);
  const controller = ctx?.controller;
  const item = useMemo(() => controller?.create(key), [controller, key]);
  if (item) Object.assign(item, spec);
  useEffect(() => {
    if (!controller || !item) return;
    controller.items.set(key, item);
    return () => {
      if (controller.items.get(key) === item) controller.items.delete(key);
    };
  }, [controller, item, key]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => spec.kind !== "tail" && Math.hypot(g.dx, g.dy) > 4,
        onPanResponderGrant: (_, g) => void controller?.begin(key, g.x0, g.y0, selection()),
        onPanResponderMove: (_, g) => controller?.move(g.moveX, g.moveY),
        onPanResponderRelease: () => controller?.end(true),
        onPanResponderTerminate: () => controller?.end(false),
        onPanResponderTerminationRequest: () => false,
      }),
    [controller, key],
  );
  const ref = useCallback(
    (view: View | null) => {
      if (item) item.view = view;
    },
    [item],
  );
  const headerRef = useCallback(
    (view: View | null) => {
      if (item) item.header = view;
    },
    [item],
  );

  const source = !!ctx?.sources.has(key);
  const horizontal = spec.kind === "tile";
  const tailOffset = useMemo(() => item && Animated.add(item.gap, -ROW_GAP), [item]);
  const style = item
    ? {
        ...(horizontal ? { marginLeft: item.gap } : { marginTop: spec.kind === "tail" ? tailOffset! : item.gap }),
        ...(source
          ? horizontal
            ? { width: item.size, marginRight: -TILE_GAP, opacity: 0, overflow: "hidden" as const }
            : { height: item.size, marginBottom: -ROW_GAP, opacity: 0, overflow: "hidden" as const }
          : {}),
      }
    : {};
  return { wrapper: { ref, style }, handle: responder.panHandlers, headerRef, dragging: source };
}
