import * as cef from "@netnyahoo/cef";
import { swipeHaptic, type NativePagerConfig, type PagerStateEvent, type SwipeEvent } from "@netnyahoo/cef";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { Animated, unstable_batchedUpdates } from "react-native";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../../store/browser";
import { pagingPosition, pagingTarget, PAGING_SETTLE_RESPONSE, PAGING_TRACKING_SCALE, springParams } from "./swipeMotion";


export type PagerPage = { id: string; slot: number; resting?: boolean };

function restPages(current: string | null, order: string[]): PagerPage[] {
  if (!current) return [];
  const i = order.indexOf(current);
  const before = i > 0 ? order[i - 1] : undefined;
  const after = i >= 0 ? order[i + 1] : undefined;
  return [...(before ? [{ id: before, slot: -1 }] : []), { id: current, slot: 0 }, ...(after ? [{ id: after, slot: 1 }] : [])];
}

const SETTLE = { ...springParams(PAGING_SETTLE_RESPONSE, 1), restDisplacementThreshold: 0.003, restSpeedThreshold: 0.1 };
const LINGER_MS = 150;
const WEB_PAGE_WARMUP_MS = 60;

function showsWebPage(s: ReturnType<typeof useBrowser.getState>, windowId: string, profileId: string) {
  const tab = s.tabs[s.windows[windowId]?.activeTabIds[profileId] ?? ""];
  const url = tab?.navigation?.url ?? tab?.url;
  return !!url && !!(tab!.navigation || tab!.adoptId) && !url.startsWith("netnyahoo://");
}

// Dia: 1pt threshold, 50ms bursts, 0.25s cooldown.
const WHEEL_THRESHOLD = 1;
const WHEEL_BURST_MS = 49;
const WHEEL_COOLDOWN_MS = 250;

type Drag = { start: number; lo: number; hi: number; home: number; detent: number };

// Work that needs the exact position, waiting for a stopped native spring to report it.
type Pending =
  | { kind: "drag"; track: SwipeEvent | null; release: { event: SwipeEvent; cancelled: boolean } | null }
  | { kind: "switch"; profileId: string };

// Binaries with the native controller track, settle and select natively; JS only commits selections.
// Read through the namespace so module mocks without it fall back to the JS pager.
const hasNativePager = () => ((cef as { nativePagerVersion?: number }).nativePagerVersion ?? 0) >= 1;

class ProfilePager {
  readonly native = hasNativePager();
  // Native path: absolute profile index, written only by the native controller's frames.
  // JS path: springs run on the native driver, so settling keeps its frames while JS is busy.
  readonly pos: Animated.Value;
  // Native path: pages are the current profile's neighbours to keep warm; ack is the newest native
  // sequence JS has handled.
  readonly state = create<{ pages: PagerPage[] | null; ack: number }>(() => ({ pages: null, ack: 0 }));
  // The native value as last written or snapshotted; null while a stop snapshot is pending.
  private model: number | null = 0;
  private animating = false;
  private pending: Pending | null = null;
  private shiftWaiting = false;
  private shift = 0;
  private shiftedWrite: number | null = null;
  private afterShift: (() => void)[] = [];
  private drag: Drag | null = null;
  private target: string | null = null;
  private generation = 0;
  private linger: ReturnType<typeof setTimeout> | undefined;
  private surfaces = 0;
  private switching = false;
  private unsubscribe: () => void;
  private lastEvent: object | null = null;
  private wheelState = { sum: 0, last: 0, trigger: 0 };
  // The pending external selection's generation, 0 when none.
  private external = 0;
  private externalGeneration = 0;

  constructor(readonly windowId: string) {
    this.pos = new Animated.Value(this.native ? Math.max(0, this.index()) : 0, { useNativeDriver: true });
    if (this.native) this.state.setState({ pages: this.warmPages() });
    this.unsubscribe = useBrowser.subscribe((s, prev) => {
      const w = s.windows[windowId];
      if (!w) return this.dispose();
      if (this.native) {
        // Native selection survives root swaps; React's selection reaches it through props.
        const was = prev.windows[windowId];
        if (w.profileId !== was?.profileId || w.incognito !== was?.incognito || s.profileOrder !== prev.profileOrder) {
          this.state.setState({ pages: this.warmPages() });
        }
        if (!this.switching && !w.incognito && w.profileId !== was?.profileId) this.selectExternal(w.profileId, s.profileOrder);
        return;
      }
      if (!this.switching && w.profileId !== prev.windows[windowId]?.profileId && this.state.getState().pages) this.reset(false);
    });
  }

  attach() {
    this.surfaces++;
    return () => {
      if (--this.surfaces === 0 && !this.native) this.reset(true);
    };
  }

  // MARK: Native pager

  // Coalesces native events: whichever arrives first commits the controller's latest state, and
  // older ones are dropped, so a delayed event never undoes a newer gesture.
  readonly onNativeState = (event: PagerStateEvent) => {
    // An external selection is on its way to native; its completion commits whatever is newest.
    if (this.external) return;
    this.commitNative(cef.pagerState(this.windowId) ?? event, event);
  };

  // A profile chosen outside the pager: native jumps to it, and no older native event may move the
  // store until that has landed.
  private selectExternal(profileId: string, order: string[]) {
    const generation = ++this.externalGeneration;
    this.external = generation;
    const done = (ok: boolean) => {
      if (this.external !== generation) return;
      this.external = 0;
      // The latest state, not the requested profile: a gesture after the command wins.
      if (ok) this.commitNative(cef.pagerState(this.windowId));
    };
    cef.selectPager(this.windowId, profileId, order.join("\n")).then(done, () => done(false));
  }

  private commitNative(snapshot: Pick<PagerStateEvent, "sequence" | "selected" | "profileId"> | null, event?: PagerStateEvent) {
    if (!snapshot || snapshot.sequence <= this.state.getState().ack) return;
    if (__DEV__) this.lastEvent = { native: event ?? null, snapshot };
    const s = useBrowser.getState();
    const w = s.windows[this.windowId];
    // The native order may differ from the store's by now; the index is only a fallback without one.
    const id = snapshot.profileId !== undefined ? snapshot.profileId : s.profileOrder[snapshot.selected];
    unstable_batchedUpdates(() => {
      if (w && !w.incognito && id && s.profiles[id] && id !== w.profileId) {
        this.switching = true;
        try {
          s.switchProfile(this.windowId, id);
        } finally {
          this.switching = false;
        }
      }
      this.state.setState({ ack: snapshot.sequence });
    });
  }

  private index() {
    const current = this.current();
    return current ? useBrowser.getState().profileOrder.indexOf(current) : -1;
  }

  private warmPages(): PagerPage[] | null {
    const i = this.index();
    if (i < 0) return null;
    const order = useBrowser.getState().profileOrder;
    return [i - 1, i, i + 1].filter((slot) => slot >= 0 && slot < order.length).map((slot) => ({ id: order[slot]!, slot }));
  }

  private switchNative(index: number, profileId: string) {
    if (!this.active) return useBrowser.getState().switchProfile(this.windowId, profileId);
    void cef.switchPager(this.windowId, index, useBrowser.getState().profileOrder.join("\n")).then((ok) => {
      if (!ok) useBrowser.getState().switchProfile(this.windowId, profileId);
    });
  }

  get active() {
    return this.surfaces > 0 && !!this.current();
  }

  // MARK: Swipes

  beginDrag() {
    const current = this.current();
    if (!current) return;
    this.drag = null;
    if (this.target && !this.fits(this.around(current))) this.finish();
    this.target = null;
    this.stop({ kind: "drag", track: null, release: null });
  }

  private startDrag() {
    const home = this.current();
    if (!home) return;
    this.arrange(home, this.around(home));
    const pages = this.pages();
    const slot = (id: string | undefined) => pages.find((p) => p.id === id)?.slot;
    const h = slot(home) ?? 0;
    const [before, after] = this.neighbours(home);
    const start = this.logical();
    this.drag = { start, lo: slot(before) ?? h, hi: slot(after) ?? h, home: h, detent: Math.round(start) };
  }

  track(e: SwipeEvent) {
    // Distances are cumulative, so the latest event is the whole gesture so far.
    if (this.pending?.kind === "drag") return void (this.pending.track = e);
    const d = this.drag;
    if (!d || !e.width) return;
    const x = pagingPosition(d.start, e.distance, e.direction, e.width, d.lo, d.hi);
    if (__DEV__) this.lastEvent = { phase: e.phase, distance: e.distance, velocity: e.velocity };
    this.write(x);
    const nearest = Math.max(d.lo, Math.min(d.hi, Math.round(x)));
    if (nearest !== d.detent) {
      d.detent = nearest;
      swipeHaptic("alignment");
    }
  }

  release(e: SwipeEvent, cancelled: boolean) {
    if (this.pending?.kind === "drag") return void (this.pending.release = { event: e, cancelled });
    if (__DEV__) this.lastEvent = { phase: e.phase, distance: e.distance, velocity: e.velocity, width: e.width, at: this.logical() };
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const velocity = e.width ? ((e.direction === "back" ? -1 : 1) * e.velocity * PAGING_TRACKING_SCALE) / e.width : 0;
    const slot = cancelled || !e.width ? d.home : pagingTarget(this.logical(), velocity, e.width, d.lo, d.hi, d.home);
    this.settle(slot, velocity);
  }

  wheel(e: SwipeEvent) {
    const now = Date.now();
    const w = this.wheelState;
    if (now - w.trigger <= WHEEL_COOLDOWN_MS) return;
    if (now - w.last > WHEEL_BURST_MS) w.sum = 0;
    w.last = now;
    w.sum += e.direction === "back" ? -e.distance : e.distance;
    if (Math.abs(w.sum) <= WHEEL_THRESHOLD) return;
    const delta = w.sum < 0 ? -1 : 1;
    w.sum = 0;
    w.trigger = now;
    this.step(delta);
  }

  step(delta: -1 | 1) {
    if (this.native) {
      if (!this.current()) return;
      // Native steps from where it is headed when the command runs, which may be ahead of the store.
      void cef.stepPager(this.windowId, delta, false, useBrowser.getState().profileOrder.join("\n")).then((ok) => {
        if (ok) return;
        const next = useBrowser.getState().profileOrder[this.index() + delta];
        if (this.index() >= 0 && next) useBrowser.getState().switchProfile(this.windowId, next);
      });
      return;
    }
    const current = this.current();
    const next = current && this.neighbours(current)[delta < 0 ? 0 : 1];
    if (next) this.switchTo(next);
  }

  // MARK: Switching

  switchTo(profileId: string) {
    const s = useBrowser.getState();
    if (!s.profiles[profileId] || !this.current()) return;
    if (this.native) {
      const index = s.profileOrder.indexOf(profileId);
      return index < 0 ? undefined : this.switchNative(index, profileId);
    }
    if (!this.active) return s.switchProfile(this.windowId, profileId);
    // Compare against where the pager is headed, including a click still waiting for its snapshot.
    const pending = this.pending;
    if (profileId === (pending?.kind === "switch" ? pending.profileId : (this.target ?? this.current()))) return;
    this.drag = null;
    if (this.target) this.finish();
    this.stop({ kind: "switch", profileId });
  }

  private switchNow(profileId: string) {
    const s = useBrowser.getState();
    const current = this.current();
    if (!s.profiles[profileId] || !current) return;
    const generation = this.generation;
    if (profileId === current) return this.later(() => generation === this.generation && this.settle(this.slotOf(current) ?? 0, 0));
    const order = s.profileOrder;
    const side = order.indexOf(profileId) < order.indexOf(current) ? -1 : 1;
    if (showsWebPage(s, this.windowId, profileId)) {
      unstable_batchedUpdates(() => this.arrange(current, [[profileId, side]]));
      this.target = profileId;
      setTimeout(() => generation === this.generation && this.target === profileId && this.finish(), WEB_PAGE_WARMUP_MS);
    } else {
      unstable_batchedUpdates(() => {
        this.arrange(current, [[profileId, side]]);
        this.target = profileId;
        this.finish();
      });
    }
    // Start adjacent pages before the swipe so their first frames are ready.
    this.later(() => requestAnimationFrame(() => generation === this.generation && this.settle(this.slotOf(profileId) ?? 0, 0)));
  }

  // MARK: Pages

  applyShift() {
    if (this.native || !this.shift) return;
    // Rebasing needs the exact position; it runs once the pending snapshot arrives.
    if (this.model === null) return void (this.shiftWaiting = true);
    this.shiftWaiting = false;
    const to = this.shiftedWrite ?? this.model - this.shift;
    this.shift = 0;
    this.shiftedWrite = null;
    this.setPosition(to);
    const then = this.afterShift;
    this.afterShift = [];
    then.forEach((f) => f());
  }

  private current() {
    const w = useBrowser.getState().windows[this.windowId];
    return w && !w.incognito ? w.profileId : null;
  }

  private pages(): PagerPage[] {
    return this.state.getState().pages ?? restPages(this.current(), useBrowser.getState().profileOrder);
  }

  private slotOf(id: string) {
    return this.pages().find((p) => p.id === id)?.slot;
  }

  private neighbours(id: string): [string | undefined, string | undefined] {
    const order = useBrowser.getState().profileOrder;
    const i = order.indexOf(id);
    return i < 0 ? [undefined, undefined] : [order[i - 1], order[i + 1]];
  }

  private around(id: string): [string, number][] {
    const [before, after] = this.neighbours(id);
    return [...(before ? [[before, -1] as [string, number]] : []), ...(after ? [[after, 1] as [string, number]] : [])];
  }

  private fits(others: [string, number][]) {
    const pages = this.pages();
    const base = this.slotOf(this.current() ?? "");
    if (base === undefined) return false;
    return others.every(([id, d]) => {
      const at = pages.find((p) => p.slot === base + d);
      const own = pages.find((p) => p.id === id);
      return (!at || at.id === id) && (!own || own.slot === base + d);
    });
  }

  private arrange(anchor: string, others: [string, number][]) {
    clearTimeout(this.linger);
    const pages = this.pages();
    const base = pages.find((p) => p.id === anchor)?.slot;
    let next: PagerPage[] | null = base === undefined ? null : [...pages];
    for (const [id, d] of others) {
      if (!next) break;
      const slot = base! + d;
      const own = next.find((p) => p.id === id);
      if (own?.slot === slot) continue;
      if (own || next.some((p) => p.slot === slot)) next = null;
      else next.push({ id, slot });
    }
    if (!next) {
      this.rebase(base ?? this.logical());
      next = [{ id: anchor, slot: 0 }, ...others.map(([id, slot]) => ({ id, slot }))];
    }
    this.state.setState({ pages: next.sort((a, b) => a.slot - b.slot) });
    if (!this.surfaces) this.applyShift();
  }

  private rebase(by: number) {
    this.shift += by;
    if (by) setTimeout(() => this.applyShift(), 100);
  }

  private logical() {
    return this.shiftedWrite ?? this.model! - this.shift;
  }

  private write(x: number) {
    if (this.shift) this.shiftedWrite = x;
    else this.setPosition(x);
  }

  private setPosition(x: number) {
    this.model = x;
    this.pos.setValue(x);
  }

  private later(f: () => void) {
    if (this.shift) this.afterShift.push(f);
    else f();
  }

  // MARK: Settling

  private settle(slot: number, velocity: number) {
    const page = this.pages().find((p) => p.slot === slot);
    const current = this.current();
    this.target = page && page.id !== current ? page.id : null;
    const from = this.logical();
    const v = Math.sign(slot - from) === Math.sign(velocity) ? velocity : 0;
    // A settle queued behind a rebase is dropped if a new drag halts it first.
    const generation = this.generation;
    this.later(() => {
      if (generation !== this.generation) return;
      this.animating = true;
      Animated.spring(this.pos, { toValue: slot, velocity: v, ...SETTLE, useNativeDriver: true }).start(({ finished }) => {
        if (!finished || generation !== this.generation) return;
        this.animating = false;
        this.model = slot;
        this.settled();
      });
    });
  }

  // The target is committed once the spring has landed.
  private settled() {
    this.finish();
    clearTimeout(this.linger);
    this.linger = setTimeout(() => this.end(), LINGER_MS);
  }

  private finish() {
    const target = this.target;
    this.target = null;
    if (!target) return;
    this.switching = true;
    try {
      useBrowser.getState().switchProfile(this.windowId, target);
    } finally {
      this.switching = false;
    }
  }

  private end() {
    if (this.drag || this.pending || !this.state.getState().pages) return;
    const current = this.current();
    const slot = current ? this.slotOf(current) : undefined;
    this.rebase(slot ?? this.logical());
    unstable_batchedUpdates(() => this.state.setState({ pages: null }));
    if (!this.surfaces) this.applyShift();
  }

  // Stops any settle, then runs the work with the exact position: at once when it is known, otherwise
  // when the native spring reports where it stopped. A newer stop or a reset supersedes this one.
  private stop(work: Pending) {
    this.generation++;
    clearTimeout(this.linger);
    this.pending = work;
    if (!this.animating && this.model !== null) return this.resume();
    this.animating = false;
    this.model = null;
    const generation = this.generation;
    this.pos.stopAnimation((value) => {
      if (generation !== this.generation) return;
      this.model = value;
      if (this.shiftWaiting) this.applyShift();
      this.resume();
    });
  }

  private resume() {
    const work = this.pending;
    this.pending = null;
    if (!work) return;
    if (work.kind === "switch") return this.switchNow(work.profileId);
    this.startDrag();
    if (work.track) this.track(work.track);
    if (work.release) this.release(work.release.event, work.release.cancelled);
  }

  private reset(land: boolean) {
    this.generation++;
    clearTimeout(this.linger);
    this.pending = null;
    this.animating = false;
    this.shiftWaiting = false;
    this.pos.stopAnimation();
    this.drag = null;
    if (land) this.finish();
    this.target = null;
    this.afterShift = [];
    this.shift = 0;
    this.shiftedWrite = null;
    this.state.setState({ pages: null });
    this.setPosition(0);
  }

  private dispose() {
    this.external = 0;
    this.externalGeneration++;
    if (!this.native) this.reset(false);
    this.unsubscribe();
    pagers.delete(this.windowId);
  }

  debug() {
    if (this.native) {
      return { native: true, lastEvent: this.lastEvent, snapshot: cef.pagerState(this.windowId), ack: this.state.getState().ack, surfaces: this.surfaces, warm: this.state.getState().pages };
    }
    return { lastEvent: this.lastEvent, pos: this.model, pending: this.pending?.kind ?? null, animating: this.animating, shift: this.shift, target: this.target, dragging: !!this.drag, surfaces: this.surfaces, pages: this.state.getState().pages };
  }
}

const pagers = new Map<string, ProfilePager>();

export function pagerFor(windowId: string): ProfilePager {
  let pager = pagers.get(windowId);
  if (!pager) pagers.set(windowId, (pager = new ProfilePager(windowId)));
  return pager;
}

export function pageToProfile(windowId: string, profileId: string) {
  pagerFor(windowId).switchTo(profileId);
}

export function usePagerSurface(windowId: string) {
  useEffect(() => pagerFor(windowId).attach(), [windowId]);
}

export function usePagerPages(windowId: string): { pages: PagerPage[]; paging: boolean; pager: ProfilePager } {
  const pager = pagerFor(windowId);
  const session = pager.state((s) => s.pages);
  const current = useBrowser((s) => s.windows[windowId]?.profileId ?? null);
  const incognito = useBrowser((s) => !!s.windows[windowId]?.incognito);
  const order = useBrowser((s) => s.profileOrder);
  useLayoutEffect(() => queueMicrotask(() => pager.applyShift()), [pager, session]);
  // Native path: every profile stays mounted at its absolute index, so a drag needs no JS to start.
  const all = pager.native && !incognito && !!current && order.includes(current);
  const pages = useMemo(
    () =>
      all
        ? order.map((id, slot) => ({ id, slot }))
        : (!pager.native && session) || restPages(current, order).map((p) => (p.id === current ? p : { ...p, resting: true })),
    [all, pager, session, current, order],
  );
  return { pages, paging: all || (!pager.native && !!session), pager };
}

// Props for a native-path SwipeArea; undefined on the JS path or without a profile to page.
export function usePagerNativeConfig(windowId: string, width?: number): NativePagerConfig | undefined {
  const pager = pagerFor(windowId);
  const ack = pager.state((s) => s.ack);
  const [selected, count, order] = useBrowser(
    useShallow((s) => {
      const w = s.windows[windowId];
      const i = w && !w.incognito ? s.profileOrder.indexOf(w.profileId) : -1;
      return [i, s.profileOrder.length, s.profileOrder.join("\n")] as const;
    }),
  );
  return useMemo(
    () => (pager.native && selected >= 0 ? { key: windowId, selected, count, width: width || undefined, ack, order } : undefined),
    [pager, windowId, selected, count, width, ack, order],
  );
}

export function usePageOffset(windowId: string, slot: number, width: number) {
  const { pos } = pagerFor(windowId);
  return useMemo(() => Animated.multiply(Animated.add(pos, -slot), -width), [pos, slot, width]);
}

if (__DEV__) {
  (globalThis as { nnPager?: unknown }).nnPager = (windowId: string) => pagerFor(windowId);
}
