import { hapticTick } from "@netnyahoo/shell";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, type ScrollView, type View } from "react-native";
import { create, useStore } from "zustand";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import type { TabPlacement } from "../../store/organize";
import { SLIDE } from "../layout/stripReorder";
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

// `landing`: let go, it settles into the item's place while the item stays hidden.
export type Ghost = { item: Item; count: number; width: number; height: number; position: Animated.ValueXY; landing?: boolean };

// The list stacks rows with `gap`; a zero-height tail cancels its gap with this negative margin.
const ROW_GAP = layout.rowGap;
const TILE_GAP = 6;
const EDGE = 28;
// Rows make room and close up with Dia's slide (stripReorder.ts). JS driver: gaps and sizes are margins, widths and
// heights.
const spring = (value: Animated.Value, toValue: number) => Animated.spring(value, { toValue, ...SLIDE });

const inside = (f: Frame, x: number, y: number, slop = 0) => x >= f.x - slop && x <= f.x + f.w + slop && y >= f.y - slop && y <= f.y + f.h + slop;
const measure = (view: View | null): Promise<Frame | null> =>
  view
    ? new Promise((resolve) => view.measureInWindow((x, y, w, h) => resolve(w || h ? { x, y, w, h } : null)))
    : Promise.resolve(null);

type Marks = { sources: Set<string>; dropInto: string | null; landing: string | null };
const NO_MARKS: Marks = { sources: new Set(), dropInto: null, landing: null };
const noMarks = create<Marks>()(() => NO_MARKS);

class DragController {
  items = new Map<string, Item>();
  regions = new Map<string, View | null>();
  root: View | null = null;
  scroll: ScrollView | null = null;
  scrollY = 0;
  setGhost: (ghost: Ghost | null) => void = () => {};
  // What the items show while a drag goes on, each item reading only its own part: a drag's start or end
  // re-renders the items it hides or shows, not the whole list.
  marks = create<Marks>()(() => NO_MARKS);
  setSources = (sources: Set<string>) => this.marks.setState({ sources });
  setDropInto = (dropInto: string | null) => this.marks.setState({ dropInto });
  setLanding = (landing: string | null) => this.marks.setState({ landing });

  private sources: Item[] = [];
  private startScrollY = 0;
  private rootFrame: Frame = { x: 0, y: 0, w: 0, h: 0 };
  private regionFrames = new Map<string, Frame | null>();
  private viewport: Frame | null = null;
  private grab = { x: 0, y: 0 };
  private pointer = { x: 0, y: 0 };
  private ghost: Ghost | null = null;
  private gapKey: string | null = null;
  // The room open at gapKey, and the collapsed group the drop goes into.
  private pitch = 0;
  private into: string | null = null;
  private dropKey = "";
  private drop: Drop = { type: "none" };
  private scrollTimer: ReturnType<typeof setInterval> | undefined;
  private measured = false;
  private token: object | null = null;
  // The empty pinned grid's drop zone comes in with the ghost and moves the list down: the frames are measured
  // again once it's laid out.
  private awaitingTiles: object | null = null;
  // This drag brought the empty pinned grid's drop zone in (it goes as the drag ends).
  private zoned = false;
  landed: { key: string; x: number; y: number } | null = null;

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
    const count = new Set(this.sources.flatMap((s) => s.tabIds)).size;
    const height = item.kind === "group" ? Math.min(frame.h, item.headerFrame?.h ?? 33) : frame.h;
    // Its picture, taken if it leaves the sidebar: the ghost, where it is by then.
    if (seq) setDragPicture(seq, () => [this.pointer.x - this.grab.x, this.pointer.y - this.grab.y, frame.w, height], [x, y]);
    this.ghost = {
      item,
      count,
      width: frame.w,
      height,
      position: new Animated.ValueXY({ x: frame.x - this.rootFrame.x, y: frame.y - this.rootFrame.y }),
    };
    for (const s of this.sources) s.size.setValue(s.kind === "tile" ? (s.frame?.w ?? 0) : (s.frame?.h ?? 0));
    this.setLanding(null);
    this.setSources(new Set(this.sources.map((s) => s.key)));
    this.setGhost(this.ghost);
    this.zoned = !this.regionFrames.get("tiles");
    if (this.zoned) this.awaitingTiles = token;
    else this.follow();
  }

  /** The pinned grid was laid out (PinnedGrid): with its drop zone in, the list is where the drag will see it. */
  async tilesLaidOut() {
    const token = this.awaitingTiles;
    if (!token) return;
    this.awaitingTiles = null;
    await this.measureAll();
    if (this.token === token) this.follow();
  }

  private follow() {
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
    const ghost = this.ghost;
    // Page split drop takes precedence over sidebar drop.
    const splitDrop = commit ? endTabDrag() : (cancelTabDrag(), false);
    // Where it lands, measured before the store moves anything (a measure in the same batch as a commit sees the
    // layout before it): the room the list made for it, or its own place. A selection, a tile, or a drop into a
    // collapsed group or the pinned grid just shows in its place.
    const spot =
      !splitDrop && this.measured && ghost && sources.length === 1 && sources[0]!.kind !== "tile" && !this.into
        ? this.landingSpot(commit ? drop : { type: "none" })
        : null;
    if (commit && !splitDrop && this.measured && sources.length) {
      const s = useBrowser.getState();
      const ids = sources.flatMap((i) => i.tabIds);
      if (drop.type === "tabs") s.placeTabs(ids, drop.placement);
      else if (drop.type === "group" && sources[0]!.groupId) s.moveGroup(sources[0]!.groupId, drop.placement);
    }
    // The gaps close as the store moves the items into them, in the same commit: nothing moves on screen.
    for (const i of this.items.values()) {
      i.gap.stopAnimation();
      i.gap.setValue(0);
    }
    for (const i of sources) i.size.stopAnimation();
    this.sources = [];
    this.gapKey = null;
    this.dropKey = "";
    this.drop = { type: "none" };
    this.into = null;
    this.ghost = null;
    this.measured = false;
    this.awaitingTiles = null;
    suppressHover(false);
    this.setSources(new Set());
    this.setDropInto(null);
    if (!spot || !ghost) {
      this.token = null;
      this.setLanding(null);
      this.setGhost(null);
      return;
    }
    // The ghost settles into its place while the item, laid out there, stays hidden; then the item shows.
    const token = (this.token = {});
    this.setLanding(ghost.item.key);
    this.setGhost({ ...ghost, landing: true });
    const done = () => {
      if (this.token !== token) return;
      this.token = null;
      this.setLanding(null);
      this.setGhost(null);
    };
    void spot.then((at) => {
      if (this.token !== token) return;
      // DEV: where it landed, for the drag test to compare with the item's place.
      if (__DEV__) this.landed = at && { key: ghost.item.key, x: at.x, y: at.y };
      if (!at) return done();
      Animated.spring(ghost.position, { toValue: { x: at.x - this.rootFrame.x, y: at.y - this.rootFrame.y }, ...SLIDE }).start(done);
    });
  }

  // The landing item's top-left in the window once the store has moved it: the gap opened before `gapKey` (which
  // it fills), or, dropped nowhere, its own place. Measured now, less what closes above it as it lands: the gaps and
  // the collapsing source (their springs may be midway), and the empty pinned grid's drop zone.
  private landingSpot(drop: Drop): Promise<{ x: number; y: number } | null> | null {
    const source = this.sources[0]!;
    const target = drop.type !== "none" && this.gapKey ? this.items.get(this.gapKey) : undefined;
    if (target?.section === "tiles") return null;
    const ref = target ?? source;
    const top = ref.frame?.y;
    if (top === undefined) return null;
    const now = (v: Animated.Value) => {
      let value = 0;
      v.stopAnimation((x) => (value = x));
      return value;
    };
    let closing = 0;
    for (const i of this.items.values()) if (i.frame && (i === ref || i.frame.y < top)) closing += now(i.gap);
    if (source !== ref && source.frame && source.frame.y < top) closing += now(source.size);
    // A tail is a zero-height mark after its section's or group's last item: its x is the container's.
    const container = ref.kind === "tail" ? [...this.items.values()].find((i) => i !== source && i.kind !== "tail" && i.frame && i.section === ref.section && i.parentGroup === ref.parentGroup) : ref;
    const zone = this.zoned ? Promise.all([measure(this.regions.get("pinnedGroups") ?? null), measure(this.regions.get("tiles") ?? null)]) : Promise.resolve([null, null]);
    // Dropped nowhere, the list goes back to how it was when the drag began: its place then.
    const home = target ? null : this.at(source.frame);
    return Promise.all([home ? Promise.resolve(home) : measure(ref.view), zone]).then(([f, [groups, tiles]]) => {
      if (!f) return null;
      const lift = groups && tiles ? groups.y - tiles.y : 0;
      if (home) return { x: home.x, y: home.y - lift };
      return { x: container?.frame?.x ?? f.x, y: f.y - closing - lift + (ref.kind === "tail" ? ROW_GAP : 0) };
    });
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
    this.into = into;
    this.setDropInto(into);
    if (gapKey !== this.gapKey) {
      const prev = this.gapKey && this.items.get(this.gapKey);
      if (prev) spring(prev.gap, 0).start();
      const next = gapKey && this.items.get(gapKey);
      if (next) spring(next.gap, pitch).start();
      this.gapKey = gapKey;
      this.pitch = pitch;
    }
  }
}

const DragContext = createContext<DragController | null>(null);

export function DragProvider({ children }: { children: (ghost: Ghost | null, controller: DragController) => ReactNode }) {
  const controller = useMemo(() => new DragController(), []);
  if (__DEV__) (globalThis as { sidebarDrag?: DragController }).sidebarDrag = controller;
  const [ghost, setGhost] = useState<Ghost | null>(null);
  controller.setGhost = setGhost;
  // The sidebar going away mid-drag (its window closing, the layout switching) ends the drag and its picture.
  useEffect(() => () => void (controller.active && controller.end(false)), [controller]);
  return (
    <DragContext.Provider value={controller}>
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
  const controller = useContext(DragContext);
  return <DragContext.Provider value={enabled ? controller : null}>{children}</DragContext.Provider>;
}

export const useDragController = () => useContext(DragContext) ?? undefined;
export const useDropInto = () => useStore(useContext(DragContext)?.marks ?? noMarks, (m) => m.dropInto);

export function useDragItem(key: string, spec: ItemSpec, selection: () => string[] = () => []) {
  const controller = useContext(DragContext) ?? undefined;
  const marks = controller?.marks ?? noMarks;
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

  const source = useStore(marks, (m) => m.sources.has(key));
  // Let go: laid out in its place, hidden until the ghost has settled there.
  const landing = useStore(marks, (m) => m.landing === key);
  const horizontal = spec.kind === "tile";
  const tailOffset = useMemo(() => item && Animated.add(item.gap, -ROW_GAP), [item]);
  const style = item
    ? {
        ...(horizontal ? { marginLeft: item.gap } : { marginTop: spec.kind === "tail" ? tailOffset! : item.gap }),
        ...(source
          ? horizontal
            ? { width: item.size, marginRight: -TILE_GAP, opacity: 0, overflow: "hidden" as const }
            : { height: item.size, marginBottom: -ROW_GAP, opacity: 0, overflow: "hidden" as const }
          : landing
            ? { opacity: 0 }
            : {}),
      }
    : {};
  return { wrapper: { ref, style }, handle: responder.panHandlers, headerRef, dragging: source };
}
