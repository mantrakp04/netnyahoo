import { swipeHaptic, type SwipeEvent } from "@netnyahoo/cef";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { Animated, unstable_batchedUpdates } from "react-native";
import { create } from "zustand";
import { useBrowser } from "../../store/browser";
import { pagingPosition, pagingTarget, PAGING_SETTLE_RESPONSE, PAGING_TRACKING_SCALE, springParams } from "./swipeMotion";

/*
 * Paging between a window's profiles, like Dia's PagingContainerViewController: the sidebar (or
 * the top tab strip) shows each profile as a page, and a swipe, a page dot, ⌃1–9 or Next/Previous
 * Profile slides from one page to another while the window tint cross-fades between their theme
 * colours. At rest the window's page shows, and the pages beside it in profile order stay mounted
 * out of sight (`resting`), so a swipe moves them from its first event rather than after they have
 * rendered; a page further away mounts when a switch animates to it and unmounts once it has settled.
 *
 * `pos` is where the view is, in pages: page k is drawn at (k.slot − pos) × width. A swipe
 * switches the window's profile as its settle lands (nothing else re-renders while the fingers or
 * the settle move the pages); a dot, a key or a menu item switches it at once and the pages slide
 * after it. Then the session lingers briefly so the window's own tint has redrawn under the layers.
 */

/** `resting`: a page beside the window's while nothing moves, mounted but not shown. */
export type PagerPage = { id: string; slot: number; resting?: boolean };

/** The pages at rest: the window's profile at 0, and the profiles before and after it in `order`. */
function restPages(current: string | null, order: string[]): PagerPage[] {
  if (!current) return [];
  const i = order.indexOf(current);
  const before = i > 0 ? order[i - 1] : undefined;
  const after = i >= 0 ? order[i + 1] : undefined;
  return [...(before ? [{ id: before, slot: -1 }] : []), { id: current, slot: 0 }, ...(after ? [{ id: after, slot: 1 }] : [])];
}

// Landed within about half a point of the page, ~0.3 s in; Animated's default rest thresholds would
// hold the session up another 0.2 s after the motion is over.
const SETTLE = { ...springParams(PAGING_SETTLE_RESPONSE, 1), restDisplacementThreshold: 0.003, restSpeedThreshold: 0.1 };
/**
 * A swipe's settle switches the window once the pages are this close to their place (pages; ~6 pt
 * of a sidebar), not when the spring comes to rest: the critically damped tail is another ~0.1 s of
 * sub-point motion, and a frame the switch costs there can't be seen.
 */
const SWITCH_NEAR = 0.03;
/** After the switch, the pages and tint layers stay up this long (the backdrop redraws meanwhile). */
const LINGER_MS = 150;

/** PageSwipeController's wheel paging (0x1005983c4): 1 pt, bursts 50 ms apart, 0.25 s between pages. */
const WHEEL_THRESHOLD = 1;
const WHEEL_BURST_MS = 49;
const WHEEL_COOLDOWN_MS = 250;

type Drag = { start: number; lo: number; hi: number; home: number; detent: number };

class ProfilePager {
  /** Where the view is, in pages (see above). JS-driven: setValue lands with React's commits. */
  readonly pos = new Animated.Value(0);
  /** The pages of the transition in progress; null at rest (the window's page alone, at 0). */
  readonly state = create<{ pages: PagerPage[] | null }>(() => ({ pages: null }));
  private value = 0;
  /** Re-anchoring the pages moves `pos` by this once the new slots have rendered (applyShift). */
  private shift = 0;
  private shiftedWrite: number | null = null;
  private afterShift: (() => void)[] = [];
  private drag: Drag | null = null;
  /** The profile a settle is heading for (switched to as it lands). */
  private target: string | null = null;
  /** The slot a settle is heading for, while it runs. */
  private settling: number | null = null;
  /** Bumped by anything that stops the pages, so a settle scheduled before it doesn't start. */
  private generation = 0;
  private linger: ReturnType<typeof setTimeout> | undefined;
  private surfaces = 0;
  private switching = false;
  private unsubscribe: () => void;
  private lastEvent: object | null = null;
  private wheelState = { sum: 0, last: 0, trigger: 0 };

  constructor(readonly windowId: string) {
    this.pos.addListener(({ value }) => {
      this.value = value;
      if (this.target && this.settling !== null && Math.abs(value - this.settling) < SWITCH_NEAR) this.finish();
    });
    // A switch from elsewhere (a tab of another profile, a new profile) while pages are up: start over.
    this.unsubscribe = useBrowser.subscribe((s, prev) => {
      const w = s.windows[windowId];
      if (!w) return this.dispose();
      if (!this.switching && w.profileId !== prev.windows[windowId]?.profileId && this.state.getState().pages) this.reset(false);
    });
  }

  /** A surface (sidebar, tab strip) that shows the pages; without one, switches don't animate. */
  attach() {
    this.surfaces++;
    return () => {
      if (--this.surfaces === 0) this.reset(true);
    };
  }

  get active() {
    return this.surfaces > 0 && !!this.current();
  }

  // MARK: Swipes

  beginDrag() {
    const current = this.current();
    if (!current) return;
    this.halt();
    // Grabbed while settling on a profile that isn't beside this one (a dot or ⌃N jump): land it first.
    if (this.target && !this.fits(this.around(current))) this.finish();
    this.target = null;
    const home = this.current()!;
    this.arrange(home, this.around(home));
    const pages = this.pages();
    const slot = (id: string | undefined) => pages.find((p) => p.id === id)?.slot;
    const h = slot(home) ?? 0;
    const [before, after] = this.neighbours(home);
    const start = this.logical();
    this.drag = { start, lo: slot(before) ?? h, hi: slot(after) ?? h, home: h, detent: Math.round(start) };
  }

  track(e: SwipeEvent) {
    const d = this.drag;
    if (!d || !e.width) return;
    const x = pagingPosition(d.start, e.distance, e.direction, e.width, d.lo, d.hi);
    if (__DEV__) this.lastEvent = { phase: e.phase, distance: e.distance, velocity: e.velocity };
    this.write(x);
    // Dia's page detents: a tick each time another page becomes the nearest.
    const nearest = Math.max(d.lo, Math.min(d.hi, Math.round(x)));
    if (nearest !== d.detent) {
      d.detent = nearest;
      swipeHaptic("alignment");
    }
  }

  release(e: SwipeEvent, cancelled: boolean) {
    if (__DEV__) this.lastEvent = { phase: e.phase, distance: e.distance, velocity: e.velocity, width: e.width, at: this.logical() };
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const velocity = e.width ? ((e.direction === "back" ? -1 : 1) * e.velocity * PAGING_TRACKING_SCALE) / e.width : 0;
    const slot = cancelled || !e.width ? d.home : pagingTarget(this.logical(), velocity, e.width, d.lo, d.hi, d.home);
    this.settle(slot, velocity);
  }

  /**
   * A wheel mouse's horizontal scroll (Dia's non-gestural paging): scrolls less than 50 ms apart
   * add up, and once they pass 1 pt the view pages that way; then nothing for 0.25 s.
   */
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

  /** A whole three-finger swipe: the page before (-1) or after (1). */
  step(delta: -1 | 1) {
    const current = this.current();
    const next = current && this.neighbours(current)[delta < 0 ? 0 : 1];
    if (next) this.switchTo(next);
  }

  // MARK: Switching

  /** Switches the window to `profileId` now, and slides to its page (placed beside the window's). */
  switchTo(profileId: string) {
    const s = useBrowser.getState();
    if (!s.profiles[profileId] || !this.current()) return;
    if (!this.active) return s.switchProfile(this.windowId, profileId);
    if (profileId === (this.target ?? this.current())) return;
    this.halt();
    this.drag = null;
    if (this.target) this.finish();
    const current = this.current()!;
    if (profileId === current) return this.later(() => this.settle(this.slotOf(current) ?? 0, 0));
    const order = s.profileOrder;
    const side = order.indexOf(profileId) < order.indexOf(current) ? -1 : 1;
    // The new page and the switch render in one commit: the window shows the profile at once
    // (its Chrome window swaps in behind the sidebar), and the pages slide on from there.
    unstable_batchedUpdates(() => {
      this.arrange(current, [[profileId, side]]);
      this.target = profileId;
      this.finish();
    });
    // The slide starts on the next frame, once the swap and the switch's view updates have landed on
    // the main thread: started with them, its first frames would be dropped.
    const generation = this.generation;
    this.later(() => requestAnimationFrame(() => generation === this.generation && this.settle(this.slotOf(profileId) ?? 0, 0)));
  }

  // MARK: Pages

  /** Called by every view of the pages after it renders them: moves `pos` with a re-anchoring. */
  applyShift() {
    if (!this.shift) return;
    const to = this.shiftedWrite ?? this.value - this.shift;
    this.shift = 0;
    this.shiftedWrite = null;
    this.pos.setValue(to);
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

  /** The profiles before and after `id` in Settings order (no wrapping). */
  private neighbours(id: string): [string | undefined, string | undefined] {
    const order = useBrowser.getState().profileOrder;
    const i = order.indexOf(id);
    return i < 0 ? [undefined, undefined] : [order[i - 1], order[i + 1]];
  }

  private around(id: string): [string, number][] {
    const [before, after] = this.neighbours(id);
    return [...(before ? [[before, -1] as [string, number]] : []), ...(after ? [[after, 1] as [string, number]] : [])];
  }

  /** Whether `others` fit beside the window's page without moving any page that's up. */
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

  /** Puts `others` beside `anchor` (slot offsets); rebuilds the pages around it if they don't fit. */
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
      // Keep the anchor where it's drawn: it moves to slot 0, and so does the view.
      this.rebase(base ?? this.logical());
      next = [{ id: anchor, slot: 0 }, ...others.map(([id, slot]) => ({ id, slot }))];
    }
    this.state.setState({ pages: next.sort((a, b) => a.slot - b.slot) });
    if (!this.surfaces) this.applyShift();
  }

  private rebase(by: number) {
    this.shift += by;
    if (by) setTimeout(() => this.applyShift(), 100); // in case no view renders the change
  }

  /** The position as the views will have it once a pending re-anchoring has rendered. */
  private logical() {
    return this.shiftedWrite ?? this.value - this.shift;
  }

  private write(x: number) {
    if (this.shift) this.shiftedWrite = x;
    else this.pos.setValue(x);
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
    // The release speed carries into the spring when it points at the page it settles on.
    const v = Math.sign(slot - from) === Math.sign(velocity) ? velocity : 0;
    this.settling = slot;
    this.later(() =>
      Animated.spring(this.pos, { toValue: slot, velocity: v, ...SETTLE, useNativeDriver: false }).start(({ finished }) => {
        if (finished) this.settled();
      }),
    );
  }

  private settled() {
    this.settling = null;
    this.finish();
    clearTimeout(this.linger);
    this.linger = setTimeout(() => this.end(), LINGER_MS);
  }

  /** Switches the window to the profile a settle is heading for. */
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

  /** Back to rest: the window's page alone, at 0. */
  private end() {
    if (this.drag || !this.state.getState().pages) return;
    const current = this.current();
    const slot = current ? this.slotOf(current) : undefined;
    this.rebase(slot ?? this.logical());
    unstable_batchedUpdates(() => this.state.setState({ pages: null }));
    if (!this.surfaces) this.applyShift();
  }

  private halt() {
    this.generation++;
    this.settling = null;
    clearTimeout(this.linger);
    this.pos.stopAnimation();
  }

  /** Drops everything in flight (landing a pending switch, or not); the view jumps to the window's page. */
  private reset(land: boolean) {
    this.halt();
    this.drag = null;
    if (land) this.finish();
    this.target = null;
    this.afterShift = [];
    this.shift = 0;
    this.shiftedWrite = null;
    this.state.setState({ pages: null });
    this.pos.setValue(0);
  }

  private dispose() {
    this.reset(false);
    this.unsubscribe();
    pagers.delete(this.windowId);
  }

  /** DEV: what tooling can check. */
  debug() {
    return { lastEvent: this.lastEvent, pos: this.value, shift: this.shift, target: this.target, dragging: !!this.drag, surfaces: this.surfaces, pages: this.state.getState().pages };
  }
}

const pagers = new Map<string, ProfilePager>();

export function pagerFor(windowId: string): ProfilePager {
  let pager = pagers.get(windowId);
  if (!pager) pagers.set(windowId, (pager = new ProfilePager(windowId)));
  return pager;
}

/** Switches the window's profile with the paging animation when a sidebar or tab strip shows it. */
export function pageToProfile(windowId: string, profileId: string) {
  pagerFor(windowId).switchTo(profileId);
}

/** Registers a view of the pages (while mounted, switches animate). */
export function usePagerSurface(windowId: string) {
  useEffect(() => pagerFor(windowId).attach(), [windowId]);
}

/**
 * The pages to draw, and whether a transition is up (at rest, the pages beside the window's are
 * `resting`: views keep them mounted but hidden). Every view of the pages must use this: it lands
 * `pos` re-anchorings in the same commit as the new slots.
 */
export function usePagerPages(windowId: string): { pages: PagerPage[]; paging: boolean; pager: ProfilePager } {
  const pager = pagerFor(windowId);
  const session = pager.state((s) => s.pages);
  const current = useBrowser((s) => s.windows[windowId]?.profileId ?? null);
  const order = useBrowser((s) => s.profileOrder);
  // After the commit's layout effects, when every page's new offset node is attached (a node
  // created in this render has its value from the old `pos`), still ahead of the next frame.
  useLayoutEffect(() => queueMicrotask(() => pager.applyShift()), [pager, session]);
  const pages = useMemo(
    () => session ?? restPages(current, order).map((p) => (p.id === current ? p : { ...p, resting: true })),
    [session, current, order],
  );
  return { pages, paging: !!session, pager };
}

/** translateX for a page `width` wide at `slot`. */
export function usePageOffset(windowId: string, slot: number, width: number) {
  const { pos } = pagerFor(windowId);
  return useMemo(() => Animated.multiply(Animated.add(pos, -slot), -width), [pos, slot, width]);
}

if (__DEV__) {
  (globalThis as { nnPager?: unknown }).nnPager = (windowId: string) => pagerFor(windowId);
}
