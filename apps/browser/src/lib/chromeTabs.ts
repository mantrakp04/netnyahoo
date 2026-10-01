import {
  chromeWindows,
  devWindowAction,
  engineInfo,
  forgetOpenedURL,
  onTabStripTransaction,
  prepareTabTransfer,
  sendTabStripCommand,
  tabStrips,
  type StripState,
  type TabStripCommand,
  type TabStripTransaction,
} from "@netnyahoo/cef";
import { usePages } from "../components/layout/pageState";
import { useBrowser, type BrowserState } from "../store/browser";
import { chromeChanged, stripActual, stripPlan } from "../store/liveTabs";
import { engineProfile } from "../store/model";
import { webviews } from "./webviews";

// Chrome's tab strips and the store (docs/store-api.md › "Live tabs"). Chrome commits; the engine reports each
// change as a transaction with a revision and its cause. Transactions apply in revision order. The app's own
// changes come back with their command and only update the mirror; Chrome's become the same change in the store
// (store/liveTabs.ts). After every change the store's plan for each strip is compared with Chrome's, and a command
// goes out where they differ: one per strip at a time, and never the same command twice against the same strip.

let started = false;
const mirror = new Map<number, StripState>();
// -1 until the first snapshot arrives; transactions before it wait.
let lastRev = -1;
let early: TabStripTransaction[] = [];
// Tabs the app has seen in a strip (a tab Chrome made is Chrome's to place only the first time).
const seen = new Set<string>();
// The command each strip is waiting for (an arrange with the tabs it lists).
const inflight = new Map<number, { kind: "arrange" | "activate"; cmd: number; keys?: string[] }>();
// What was last sent to each strip, against which of its states: a plan Chrome couldn't reach isn't sent again
// until something other than the app's commands changes the strip.
const tried = new Map<string, { sig: string; since: number }>();
const changedAt = new Map<number, number>();

if (__DEV__) {
  (globalThis as { nnChromeTabs?: unknown }).nnChromeTabs = {
    chromeWindows,
    engineInfo,
    devWindowAction,
    strips: () => [...mirror.values()],
    state: () => ({ lastRev, inflight: Object.fromEntries(inflight), tried: Object.fromEntries(tried) }),
  };
}

export function startChromeTabs() {
  if (started) return;
  started = true;
  onTabStripTransaction((tx) => (lastRev < 0 ? early.push(tx) : receive(tx)));
  void tabStrips().then((snapshot) => {
    for (const strip of snapshot.strips) {
      mirror.set(strip.strip, strip);
      for (const t of strip.tabs) if (t.key) seen.add(t.key);
    }
    lastRev = snapshot.rev;
    const queued = early;
    early = [];
    for (const tx of queued) receive(tx);
    scheduleProject();
  });
  useBrowser.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs) {
      announceMoves(s, prev);
      forgetUnopened(s, prev);
    }
    if (s.windows !== prev.windows || s.tabs !== prev.tabs) scheduleProject();
  });
}

// MARK: Chrome → store

function receive(tx: TabStripTransaction) {
  if (tx.rev <= lastRev) return;
  lastRev = tx.rev;
  for (const [strip, f] of inflight) if (f.cmd === tx.cmd) inflight.delete(strip);
  const start = useBrowser.getState();
  let s = start;
  for (const strip of tx.strips) {
    const before = mirror.get(strip.strip);
    if (strip.closed) mirror.delete(strip.strip);
    else mirror.set(strip.strip, strip);
    if (tx.cmd === null || tx.cmd < 0) changedAt.set(strip.strip, tx.rev);
    if (tx.cmd === null) {
      // A command of the app's own on its way to this strip comes after Chrome's change, and wins.
      const waiting = inflight.get(strip.strip);
      const siblings = [...mirror.values()].filter((x) => x.window === strip.window && x.strip !== strip.strip);
      s = chromeChanged(s, before, strip, {
        seen,
        siblings,
        pending: { arranged: new Set(waiting?.kind === "arrange" ? waiting.keys : []), active: waiting?.kind === "activate" },
      });
    }
    for (const t of strip.tabs) if (t.key) seen.add(t.key);
  }
  if (seen.size > 2 * Object.keys(s.tabs).length + 64) for (const key of seen) if (!s.tabs[key]) seen.delete(key);
  if (s !== start) useBrowser.setState(s);
  scheduleProject();
}

// MARK: Store → Chrome

let projectQueued = false;

function scheduleProject() {
  if (projectQueued || lastRev < 0) return;
  projectQueued = true;
  queueMicrotask(() => {
    projectQueued = false;
    project(useBrowser.getState());
  });
}

function project(s: BrowserState) {
  for (const strip of mirror.values()) {
    if (inflight.has(strip.strip)) continue;
    const plan = stripPlan(s, strip);
    if (!plan) continue;
    const actual = stripActual(strip, plan);
    // The shown tab first: Chrome's commands and extensions act on its active tab.
    const order = `${plan.keys.join(",")}|${plan.pinned}`;
    if (plan.active && plan.active !== actual.active) {
      send(strip.strip, "activate", plan.active, { op: "activate", strip: strip.strip, key: plan.active });
    } else if (order !== `${actual.keys.join(",")}|${actual.pinned}`) {
      send(strip.strip, "arrange", order, { op: "arrange", strip: strip.strip, keys: plan.keys, pinned: plan.pinned });
    }
  }
}

function send(strip: number, kind: "arrange" | "activate", sig: string, command: TabStripCommand) {
  const since = changedAt.get(strip) ?? 0;
  const last = tried.get(`${strip}:${kind}`);
  if (last?.sig === sig && last.since === since) return;
  tried.set(`${strip}:${kind}`, { sig, since });
  inflight.set(strip, { kind, cmd: sendTabStripCommand(command), ...(command.op === "arrange" ? { keys: command.keys } : {}) });
}

// MARK: Moves between windows

const liveTabs = () =>
  new Map(
    Object.entries(usePages.getState().browsers)
      .filter(([, tabId]) => webviews.has(tabId))
      .map(([browserId, tabId]) => [tabId, browserId]),
  );

function announceMoves(s: BrowserState, prev: BrowserState) {
  let live: Map<string, string> | null = null;
  for (const [id, tab] of Object.entries(s.tabs)) {
    const before = prev.tabs[id];
    if (!before || before.windowId === tab.windowId) continue;
    if (engineProfile(before.profileId) !== engineProfile(tab.profileId)) continue;
    live ??= liveTabs();
    if (live.has(id)) prepareTabTransfer(id);
  }
}

// A tab opened behind that won't load the navigation the engine kept for it (closed before it was shown, moved to
// another profile): the engine drops it now.
function forgetUnopened(s: BrowserState, prev: BrowserState) {
  for (const id in prev.tabs) {
    const kept = prev.tabs[id]!.wakeAdoptId;
    if (!kept?.startsWith("open:")) continue;
    const now = s.tabs[id];
    if (now?.wakeAdoptId === kept || now?.adoptId === kept) continue;
    forgetOpenedURL(Number(kept.slice(5)));
  }
}
