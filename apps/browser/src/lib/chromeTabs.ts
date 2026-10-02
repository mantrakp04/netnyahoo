import {
  chromeWindows,
  devWindowAction,
  engineInfo,
  onTabStripTransaction,
  sendTabStripCommand,
  tabStrips,
  type StripState,
  type TabStripCommand,
  type TabStripTransaction,
} from "@netnyahoo/nncore";
import { useBrowser, type BrowserState } from "../store/browser";
import { changedIds } from "../store/changes";
import { chromeChanged, groupStep, stripActual, stripPlan, type GroupBindings } from "../store/liveTabs";

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
// The command each strip is waiting for (an arrange or group with the tabs it lists; the store group a new Chrome
// group is made for).
type Kind = "arrange" | "activate" | "group";
const inflight = new Map<number, { kind: Kind; cmd: number; keys?: string[]; makes?: string; successor?: boolean }>();
// Chrome's group ids → the store's.
const groups: GroupBindings = new Map();
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
    state: () => ({ lastRev, inflight: Object.fromEntries(inflight), tried: Object.fromEntries(tried), groups: Object.fromEntries(groups) }),
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
    if (s.windows !== prev.windows || s.groups !== prev.groups || placed(s, prev)) scheduleProject();
  });
}

// Whether a tab came, went or changed what the plans read of it (stripPlan, groupStep: its window, profile and pin).
// A page's title, address or icon changing doesn't project again.
function placed(s: BrowserState, prev: BrowserState) {
  return changedIds(s.tabs, prev.tabs).some((id) => {
    const a = s.tabs[id];
    const b = prev.tabs[id];
    return !a || !b || a.windowId !== b.windowId || a.profileId !== b.profileId || a.pinned !== b.pinned;
  });
}

// MARK: Chrome → store

function receive(tx: TabStripTransaction) {
  if (tx.rev <= lastRev) return;
  lastRev = tx.rev;
  for (const [strip, f] of inflight) {
    if (f.cmd !== tx.cmd) continue;
    inflight.delete(strip);
    // The Chrome group made for a store group: whatever group its tabs are in now.
    const made = f.makes && tx.strips.find((x) => x.strip === strip)?.tabs.find((t) => t.key === f.keys?.[0])?.group;
    if (made && f.makes) groups.set(made, f.makes);
  }
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
        groups,
        pending: {
          arranged: new Set(waiting?.kind === "arrange" ? waiting.keys : []),
          grouped: new Set(waiting?.kind === "group" ? waiting.keys : []),
          // The store's successor for a tab that closed gives way to a tab Chrome activated explicitly meanwhile
          // (an extension closing and activating in one go), as in Chrome.
          active: waiting?.kind === "activate" && !waiting.successor,
        },
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
      // Chrome's active tab is gone from the store (it closed): the store's pick is a successor.
      const successor = !!actual.active && !s.tabs[actual.active];
      send(strip.strip, "activate", plan.active, { op: "activate", strip: strip.strip, key: plan.active }, undefined, successor);
    } else if (order !== `${actual.keys.join(",")}|${actual.pinned}`) {
      send(strip.strip, "arrange", order, { op: "arrange", strip: strip.strip, keys: plan.keys, pinned: plan.pinned });
    } else {
      const step = groupStep(s, strip, groups);
      if (step) {
        const { makes, ...rest } = step;
        send(strip.strip, "group", JSON.stringify(step), { op: "group", strip: strip.strip, ...rest }, makes);
      }
    }
  }
}

function send(strip: number, kind: Kind, sig: string, command: TabStripCommand, makes?: string, successor?: boolean) {
  const since = changedAt.get(strip) ?? 0;
  const last = tried.get(`${strip}:${kind}`);
  if (last?.sig === sig && last.since === since) return;
  tried.set(`${strip}:${kind}`, { sig, since });
  inflight.set(strip, { kind, cmd: sendTabStripCommand(command), ...(command.op !== "activate" ? { keys: command.keys } : {}), makes, successor });
}
