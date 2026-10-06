// Real-user timing of the four journeys (docs/perf/field-journeys.md), only while the user shares diagnostics:
// launch, a new tab's command bar, a tab switch and a navigation, each from the user's key or click (process start for
// launch) to the result on screen, in steps that tell our JS, the native side and the engine (network) apart.
// Native marks (packages/nncore/ios/NNCoreFieldTiming.mm) carry the times JS can't see: when the key or click reached the
// app, when a commit reached the screen, and what the engine did. They're read only when a journey settles, a second or
// more later, so nothing here runs between the user's action and its result but a few timestamps.
// What leaves: perf_launch once per launch, and perf_journeys (p50, p75, p95, max and n per step) hourly and at quit.
// Durations, counts and rough ranges only: never a URL, a title or what was typed.
import { NativeModules } from "react-native";
import { useBrowser, type BrowserState } from "../store/browser";
import { activeTabId } from "../store/model";
import { appInfo, capture, isSharing, useTelemetry } from "./client";
import { jsStartedAt } from "./jsStart";

type NativeTiming = {
  setEnabled(on: boolean): void;
  markFrame(key: string, kind: string): void;
  lastInput(): [at: number, kind: number];
  drain(): [key: string, kind: string, at: number][];
};

// Builds before NNCoreFieldTiming have none: the journeys then keep only what JS sees.
const native = NativeModules.NNFieldTiming as NativeTiming | undefined;

let on = false;

// When the views JS changes from here to the end of this JS task are on screen: the UI manager runs the mark with this
// task's view updates, and it times the Core Animation commit that carries them. (A mark made later, in a microtask,
// rides the next batch, a frame late.)
const frame = (key: string, kind: string) => native?.markFrame(key, kind);

// MARK: Samples, summarized hourly and at quit (perf_journeys)

const MAX_SAMPLES = 500;
const samples = new Map<string, number[]>();
const counts = new Map<string, number>();

function sample(step: string, ms: number | null) {
  if (ms === null || !(ms >= 0 && ms < 60_000)) return;
  let list = samples.get(step);
  if (!list) samples.set(step, (list = []));
  if (list.length < MAX_SAMPLES) list.push(Math.round(ms));
}

const count = (what: string) => counts.set(what, (counts.get(what) ?? 0) + 1);
const since = (at: number | null | undefined, from: number | null | undefined) => (at == null || from == null ? null : at - from);

// `final`: at quit, every journey in flight goes in with what it has.
export function emitJourneys(final = false) {
  settle(final);
  if (!samples.size && !counts.size) return;
  const props: Record<string, number> = {};
  for (const [step, list] of samples) {
    list.sort((a, b) => a - b);
    const at = (p: number) => list[Math.min(list.length - 1, Math.floor(p * list.length))]!;
    props[`${step}_p50`] = at(0.5);
    props[`${step}_p75`] = at(0.75);
    props[`${step}_p95`] = at(0.95);
    props[`${step}_max`] = list.at(-1)!;
    props[`${step}_n`] = list.length;
  }
  for (const [what, n] of counts) props[what] = n;
  samples.clear();
  counts.clear();
  if (on && isSharing()) capture("perf_journeys", props);
}

// MARK: Native marks

// The user's last key down or click, if it came within the last second: what started the change being handled.
function lastInput(now = Date.now()): number | null {
  const [at = 0] = native?.lastInput() ?? [];
  return at > 0 && at <= now + 5 && now - at <= 1000 ? at : null;
}

type Mark = [kind: string, at: number];
const marks = new Map<string, Mark[]>();

function pullMarks(now: number) {
  for (const [key, kind, at] of native?.drain() ?? []) {
    let list = marks.get(key);
    if (!list) marks.set(key, (list = []));
    list.push([kind, at]);
  }
  for (const [key, list] of marks) {
    const fresh = list.filter(([, at]) => now - at < 120_000);
    if (fresh.length) marks.set(key, fresh);
    else marks.delete(key);
  }
}

// The earliest `kind` for `key` from `from` (to `until`).
function mark(key: string, kind: string, from: number, until = Infinity): number | null {
  let first: number | null = null;
  for (const [k, at] of marks.get(key) ?? []) if (k === kind && at >= from - 1 && at < until && (first === null || at < first)) first = at;
  return first;
}

// MARK: Journeys in flight

type NewTab = { journey: "j2"; key: string; t0: number; heard: number; bar?: number; barSettled?: boolean; keyAt?: number; suggested?: number };
type Switch = { journey: "j3"; key: string; t0: number; heard: number };
type Navigate = { journey: "j4"; key: string; t0: number; until?: number };
type Launch = { journey: "j1"; t0: number; firstWindow?: number; commit?: number; usable?: number; keys: string[]; tabs: number; windows: number };
type Pending = NewTab | Switch | Navigate | Launch;

const MAX_PENDING = 50;
let pending: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function begin(p: Pending) {
  if (pending.length >= MAX_PENDING) pending.shift();
  pending.push(p);
  if (!timer) timer = setTimeout(tick, 1000);
}

function tick() {
  timer = undefined;
  settle(false);
  if (pending.length) timer = setTimeout(tick, 1000);
}

// Records each journey whose marks are in (or that waited long enough); `force`: every one, with what it has.
function settle(force: boolean) {
  if (!pending.length) return;
  const now = Date.now();
  pullMarks(now);
  pending = pending.filter((p) => !(settleOne(p, now) || (force && settleOne(p, Infinity))));
}

function settleOne(p: Pending, now: number): boolean {
  switch (p.journey) {
    case "j1":
      return settleLaunch(p, now);
    case "j2":
      return settleNewTab(p, now);
    case "j3":
      return settleSwitch(p, now);
    case "j4":
      return settleNavigate(p, now);
  }
}

// J2: ⌘T (or the new tab button) → the new tab's command bar committed, on screen, focused; then its first keystroke →
// that keystroke's suggestions on screen.
function settleNewTab(p: NewTab, now: number) {
  if (p.bar === undefined) {
    if (now - p.t0 < 5000) return false;
    count("j2_no_bar");
    return true;
  }
  if (!p.barSettled) {
    const typeable = mark(p.key, "typeable", p.t0);
    if (typeable === null && now - p.t0 < 5000) return false;
    p.barSettled = true;
    sample("j2_js", p.heard - p.t0);
    sample("j2_commit", p.bar - p.t0);
    sample("j2_shown", since(mark(p.key, "bar", p.t0), p.t0));
    sample("j2_typeable", since(typeable, p.t0));
  }
  if (p.suggested !== undefined) {
    const shown = mark(p.key, "suggest", p.suggested);
    if (shown === null && now - p.suggested < 5000) return false;
    sample("j2_suggest", since(shown, p.keyAt));
    return true;
  }
  // Never typed in.
  return now - p.t0 > 60_000;
}

// J3: a click or shortcut that shows another tab → React's switch on screen, the page's view shown, and (a page that
// was hidden) its first new frame; a tab that had to load, its first contentful paint.
function settleSwitch(p: Switch, now: number) {
  const end = p.t0 + 2000;
  if (now < end + 500) return false;
  // A tab that wasn't loaded: the switch asked the engine for its page.
  const started = mark(p.key, "request", p.t0, end) ?? mark(p.key, "start", p.t0, end);
  const fcp = started === null ? null : mark(p.key, "fcp", p.t0);
  if (started !== null && fcp === null && now - p.t0 < 20_000) return false;
  const frameAt = mark(p.key, "frame", p.t0);
  const view = mark(p.key, "view", p.t0, end);
  const shown = mark(p.key, "shown", p.t0, end);
  const kind = started !== null ? "load" : shown !== null ? "cold" : view !== null ? "warm" : "other";
  sample("j3_js", p.heard - p.t0);
  sample("j3_frame", since(frameAt, p.t0));
  sample("j3_view", since(view, p.t0));
  sample("j3_page", since(shown, p.t0));
  sample("j3_total", since(kind === "load" ? fcp : kind === "cold" ? shown : kind === "warm" ? view : frameAt, p.t0));
  count(`j3_${kind}`);
  return true;
}

// J4: Enter (or a click on a suggestion) → the engine asked to load (our side) → Chrome started the navigation →
// committed → first contentful paint; request → paint is the engine's and the network's side.
function settleNavigate(p: Navigate, now: number) {
  const until = p.until ?? Infinity;
  const request = mark(p.key, "request", p.t0, until);
  if (request === null && now - p.t0 < 3000 && p.until === undefined) return false;
  if (request === null) {
    count("j4_no_load");
    return true;
  }
  const fcp = mark(p.key, "fcp", p.t0, until);
  if (fcp === null && now - p.t0 < 30_000 && p.until === undefined) return false;
  sample("j4_request", request - p.t0);
  sample("j4_start", since(mark(p.key, "start", p.t0, until), p.t0));
  sample("j4_commit", since(mark(p.key, "commit", p.t0, until), p.t0));
  sample("j4_fcp", since(fcp, p.t0));
  sample("j4_engine", since(fcp, request));
  if (fcp === null) count(p.until === undefined ? "j4_no_paint" : "j4_replaced");
  return true;
}

// MARK: J1 launch (perf_launch)

const bucket = (n: number, edges: [number, string][], last: string) => edges.find(([max]) => n <= max)?.[1] ?? last;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number) =>
  bucket(ms, [[MINUTE, "<1m"], [10 * MINUTE, "<10m"], [HOUR, "<1h"], [8 * HOUR, "<8h"], [DAY, "<1d"], [7 * DAY, "<7d"]], "7d+");

let launch: Launch | null = null;
let launchSent = false;
let previousLaunch: { lastLaunchAt: number | null; lastQuitAt: number | null } = { lastLaunchAt: null, lastQuitAt: null };

// The first window's content committed (main.tsx, the first root's layout effect).
export function launchCommitted() {
  if (launch || launchSent || !on) return;
  const start = appInfo().processStart;
  if (!start) return;
  const s = useBrowser.getState();
  const keys: string[] = [];
  for (const id of s.windowOrder) {
    const tab = activeTabId(s, id);
    if (tab && s.tabs[tab]?.url && !s.tabs[tab]!.unloaded) keys.push(tab);
  }
  launch = { journey: "j1", t0: start, commit: Date.now(), keys, tabs: Object.keys(s.tabs).length, windows: s.windowOrder.length };
  frame("launch", "content");
  probeUsable(launch);
  begin(launch);
}

// The command bar is usable once the app answers at once: the first timer after the first commit that runs within
// 50 ms of being set (React Native's timers run on the main thread's frames, so this waits for both threads).
let usableTimer: ReturnType<typeof setTimeout> | undefined;

function probeUsable(l: Launch) {
  const set = Date.now();
  usableTimer = setTimeout(() => {
    usableTimer = undefined;
    if (!on || launch !== l) return;
    const now = Date.now();
    if (now - set < 50 || now - set > 30_000 || now - (l.commit ?? now) > 30_000) l.usable = now;
    else probeUsable(l);
  }, 0);
}

// processStart → the first window's root effect: perf_launch's launch_ms, the same as before these steps.
export function launchFirstWindow(at: number) {
  if (launch) launch.firstWindow = at;
}

function settleLaunch(l: Launch, now: number) {
  const content = mark("launch", "content", l.t0);
  const paints = l.keys.map((k) => mark(k, "fcp", l.t0)).filter((at): at is number => at !== null);
  const done = l.usable !== undefined && l.firstWindow !== undefined && (content !== null || !native) && (paints.length || !l.keys.length);
  if (!done && now - (l.commit ?? l.t0) < 30_000) return false;
  sendLaunch(l, content, paints);
  return true;
}

function sendLaunch(l: Launch, content: number | null, paints: number[]) {
  if (launchSent || !on) return;
  launchSent = true;
  const paint = paints.length ? Math.min(...paints) : null;
  const tab = paint === null ? l.keys[0] : l.keys.find((k) => mark(k, "fcp", l.t0) === paint);
  const s = useBrowser.getState();
  let history = 0;
  for (const list of Object.values(s.history)) history += list.length;
  const { bootTime } = appInfo();
  const { lastLaunchAt, lastQuitAt } = previousLaunch;
  const ms = (at: number | null | undefined) => (at == null || !(at - l.t0 >= 0 && at - l.t0 < 10 * MINUTE) ? null : Math.round(at - l.t0));
  capture("perf_launch", {
    launch_ms: ms(l.firstWindow),
    js_ms: ms(jsStartedAt),
    commit_ms: ms(l.commit),
    content_ms: ms(content),
    // Not before its content is on screen (the first commit's layout can still be under way when the timer runs).
    usable_ms: ms(l.usable === undefined ? undefined : Math.max(l.usable, content ?? 0)),
    tab_request_ms: ms(tab ? mark(tab, "request", l.t0) : null),
    tab_commit_ms: ms(tab ? mark(tab, "commit", l.t0) : null),
    tab_paint_ms: ms(paint),
    tabs: bucket(l.tabs, [[0, "0"], [1, "1"], [5, "2-5"], [20, "6-20"], [50, "21-50"], [100, "51-100"], [200, "101-200"]], "200+"),
    windows: Math.min(l.windows, 10),
    history: bucket(history, [[0, "0"], [99, "<100"], [999, "<1k"], [4999, "<5k"], [19_999, "<20k"]], "20k+"),
    // The first launch since the Mac started (its disk cache cold), as far as this copy knows.
    cold: bootTime && lastLaunchAt ? lastLaunchAt < bootTime : null,
    since_quit: lastQuitAt && (!lastLaunchAt || lastQuitAt >= lastLaunchAt) ? ago(l.t0 - lastQuitAt) : lastLaunchAt ? "unclean" : "unknown",
    since_boot: bootTime ? bucket(l.t0 - bootTime, [[2 * MINUTE, "<2m"], [10 * MINUTE, "<10m"], [HOUR, "<1h"], [DAY, "<1d"]], "1d+") : "unknown",
  });
}

// MARK: Starts and steps the app reports

// A window's active tab changed: a new empty tab (J2) or another existing tab (J3), when the user's key or click did it.
function watchStore(s: BrowserState, prev: BrowserState) {
  if (!on || s.windows === prev.windows) return;
  for (const id in s.windows) {
    const now = activeTabId(s, id);
    const before = activeTabId(prev, id);
    if (!now || now === before || s.windows[id]!.profileId !== prev.windows[id]?.profileId) continue;
    const t0 = lastInput();
    if (t0 === null) continue;
    const heard = Date.now();
    if (!prev.tabs[now]) {
      if (!s.tabs[now]!.url) begin({ journey: "j2", key: now, t0, heard });
    } else if (before && s.tabs[before]?.windowId === id) {
      begin({ journey: "j3", key: now, t0, heard });
      // React commits this change in the store's set, after this listener: the mark goes with that commit.
      frame(now, "frame");
    }
  }
}

const newTabFor = (tabId: string) => {
  for (const p of pending) if (p.journey === "j2" && p.key === tabId) return p;
  return undefined;
};

// A command bar for `tabId` committed (Omnibox's mount).
export function journeyBarCommitted(tabId: string) {
  if (!on) return;
  const p = newTabFor(tabId);
  if (!p || p.bar !== undefined) return;
  p.bar = Date.now();
  frame(tabId, "bar");
}

// Its field took focus: typing goes in from the frame after.
export function journeyBarFocused(tabId: string) {
  if (on && newTabFor(tabId)?.bar !== undefined) frame(tabId, "typeable");
}

export function journeyKeystroke(tabId: string) {
  if (!on) return;
  const p = newTabFor(tabId);
  if (p && p.bar !== undefined && p.keyAt === undefined) p.keyAt = lastInput() ?? Date.now();
}

// The bar committed with suggestions to show.
export function journeySuggestions(tabId: string) {
  if (!on) return;
  const p = newTabFor(tabId);
  if (!p || p.keyAt === undefined || p.suggested !== undefined) return;
  p.suggested = Date.now();
  frame(tabId, "suggest");
}

// The command bar opens a page in its own tab (Enter, or a click on a suggestion).
export function journeyNavigate(tabId: string) {
  if (!on) return;
  const now = Date.now();
  const t0 = lastInput(now) ?? now;
  for (const p of pending) if (p.journey === "j4" && p.key === tabId && p.until === undefined) p.until = t0;
  begin({ journey: "j4", key: tabId, t0 });
}

// MARK: Lifecycle

let unwatchStore: (() => void) | undefined;

// `initial`: said to native even when it matches, as native can still be on from a bridge this JS replaced (a reload).
function setOn(next: boolean, initial = false) {
  if (next === on && !initial) return;
  on = next;
  native?.setEnabled(next);
  // The store has no listener of ours unless the user shares: opted out, a store update costs nothing extra.
  if (next) {
    unwatchStore ??= useBrowser.subscribe(watchStore);
    return;
  }
  unwatchStore?.();
  unwatchStore = undefined;
  // A launch that saw sharing off isn't sent, even if it comes back on.
  clearTimeout(usableTimer);
  usableTimer = undefined;
  if (launch) launchSent = true;
  launch = null;
  clearTimeout(timer);
  timer = undefined;
  pending = [];
  marks.clear();
  samples.clear();
  counts.clear();
}

export function startJourneys(previous: { lastLaunchAt: number | null; lastQuitAt: number | null } | null) {
  if (previous) previousLaunch = previous;
  setOn(isSharing(), true);
  useTelemetry.subscribe((t) => setOn(t.sharing));
}

// Quitting: perf_launch with what it has, if it hasn't gone yet, and this session's journeys.
export function journeysEnding() {
  if (launch && !launchSent) {
    settle(false);
    if (!launchSent) sendLaunch(launch, mark("launch", "content", launch.t0), launch.keys.map((k) => mark(k, "fcp", launch!.t0)).filter((at): at is number => at !== null));
  }
  emitJourneys(true);
}

export const devJourneys = () => ({
  on,
  native: !!native,
  pending: pending.map((p) => ({ ...p })),
  samples: Object.fromEntries(samples),
  counts: Object.fromEntries(counts),
  marks: Object.fromEntries(marks),
});
