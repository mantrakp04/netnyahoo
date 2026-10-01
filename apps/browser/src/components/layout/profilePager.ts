import * as cef from "@netnyahoo/nncore";
import type { NativePagerConfig, PagerStateEvent, SwipeEvent } from "@netnyahoo/nncore";
import { useEffect, useMemo } from "react";
import { Animated, unstable_batchedUpdates } from "react-native";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../../store/browser";

export type PagerPage = { id: string; slot: number; resting?: boolean };

function restPages(current: string | null, order: string[]): PagerPage[] {
  if (!current) return [];
  const i = order.indexOf(current);
  const before = i > 0 ? order[i - 1] : undefined;
  const after = i >= 0 ? order[i + 1] : undefined;
  return [...(before ? [{ id: before, slot: -1 }] : []), { id: current, slot: 0 }, ...(after ? [{ id: after, slot: 1 }] : [])];
}

// Dia: 1pt threshold, 50ms bursts, 0.25s cooldown.
const WHEEL_THRESHOLD = 1;
const WHEEL_BURST_MS = 49;
const WHEEL_COOLDOWN_MS = 250;

// The native controller (NNPager) tracks, settles and selects; JS only commits its selections.
class ProfilePager {
  // The absolute profile index, written only by the native controller's frames.
  readonly pos: Animated.Value;
  // pages: the current profile's neighbours to keep warm; ack: the newest native sequence JS has handled.
  readonly state = create<{ pages: PagerPage[] | null; ack: number }>(() => ({ pages: null, ack: 0 }));
  private surfaces = 0;
  private switching = false;
  private unsubscribe: () => void;
  private lastEvent: object | null = null;
  private wheelState = { sum: 0, last: 0, trigger: 0 };
  // The pending external selection's generation, 0 when none.
  private external = 0;
  private externalGeneration = 0;

  constructor(readonly windowId: string) {
    this.pos = new Animated.Value(Math.max(0, this.index()), { useNativeDriver: true });
    this.state.setState({ pages: this.warmPages() });
    this.unsubscribe = useBrowser.subscribe((s, prev) => {
      const w = s.windows[windowId];
      if (!w) return this.dispose();
      // Native selection survives root swaps; React's selection reaches it through props.
      const was = prev.windows[windowId];
      if (w.profileId !== was?.profileId || w.incognito !== was?.incognito || s.profileOrder !== prev.profileOrder) {
        this.state.setState({ pages: this.warmPages() });
      }
      if (!this.switching && !w.incognito && w.profileId !== was?.profileId) this.selectExternal(w.profileId, s.profileOrder);
    });
  }

  attach() {
    this.surfaces++;
    return () => void this.surfaces--;
  }

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

  get active() {
    return this.surfaces > 0 && !!this.current();
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
    if (!this.current()) return;
    // Native steps from where it is headed when the command runs, which may be ahead of the store.
    void cef.stepPager(this.windowId, delta, false, useBrowser.getState().profileOrder.join("\n")).then((ok) => {
      if (ok) return;
      const next = useBrowser.getState().profileOrder[this.index() + delta];
      if (this.index() >= 0 && next) useBrowser.getState().switchProfile(this.windowId, next);
    });
  }

  switchTo(profileId: string) {
    const s = useBrowser.getState();
    const index = s.profileOrder.indexOf(profileId);
    if (!s.profiles[profileId] || !this.current() || index < 0) return;
    if (!this.active) return s.switchProfile(this.windowId, profileId);
    void cef.switchPager(this.windowId, index, s.profileOrder.join("\n")).then((ok) => {
      if (!ok) useBrowser.getState().switchProfile(this.windowId, profileId);
    });
  }

  private current() {
    const w = useBrowser.getState().windows[this.windowId];
    return w && !w.incognito ? w.profileId : null;
  }

  private dispose() {
    this.external = 0;
    this.externalGeneration++;
    this.unsubscribe();
    pagers.delete(this.windowId);
  }

  debug() {
    return { lastEvent: this.lastEvent, snapshot: cef.pagerState(this.windowId), ack: this.state.getState().ack, surfaces: this.surfaces, warm: this.state.getState().pages };
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
  const current = useBrowser((s) => s.windows[windowId]?.profileId ?? null);
  const incognito = useBrowser((s) => !!s.windows[windowId]?.incognito);
  const order = useBrowser((s) => s.profileOrder);
  // Every profile stays mounted at its absolute index, so a drag needs no JS to start.
  const all = !incognito && !!current && order.includes(current);
  const pages = useMemo(
    () =>
      all
        ? order.map((id, slot) => ({ id, slot }))
        : restPages(current, order).map((p) => (p.id === current ? p : { ...p, resting: true })),
    [all, current, order],
  );
  return { pages, paging: all, pager };
}

// Props for the SwipeArea's native pager; undefined without a profile to page.
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
    () => (selected >= 0 ? { key: windowId, selected, count, width: width || undefined, ack, order } : undefined),
    [windowId, selected, count, width, ack, order],
  );
}

// A page's place in the pager: off to the side at rest, outside the surface's clip.
export function usePageStyle(windowId: string, slot: number, width: number) {
  const { pos } = pagerFor(windowId);
  return useMemo(() => ({ transform: [{ translateX: Animated.multiply(Animated.add(pos, -slot), -width) }] }), [pos, slot, width]);
}

if (__DEV__) {
  (globalThis as { nnPager?: unknown }).nnPager = (windowId: string) => pagerFor(windowId);
}
