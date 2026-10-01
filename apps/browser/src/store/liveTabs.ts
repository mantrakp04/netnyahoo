import type { StripGroup, StripState, StripTab } from "@netnyahoo/cef";
import type { BrowserState } from "./browser";
import { engineProfile, pinnedFirst } from "./model";
import { forgetOpeners, switchKeepsOpeners } from "./openers";
import { groupOf, placing, withGroup } from "./organize";
import { splitOf } from "./splits";
import { activated, apply, removeTabs } from "./tabs";

// One writer per fact (docs/store-api.md › "Live tabs"). The store owns the workspace; Chrome owns its tab strips:
// which tabs it has, their order, the active one, pins. Between them:
// - chromeChanged: a change Chrome made on its own (an extension; the tab it shows when the active one closes), as
//   the strip before and after it, becomes the same change in the workspace. Changes the app's own commands made
//   never come here: the store already holds them.
// - stripPlan: what the store wants a strip to be; lib/chromeTabs.ts sends the commands that get it there.

type Keyed = StripTab & { key: string };
const known = (s: BrowserState, t: StripTab | undefined): t is Keyed => !!t?.key && !!s.tabs[t.key];

/** Chrome made the tab in a window of its own (an extension's `tabs.create`), and the store took it in. */
const madeByChrome = (s: BrowserState, key: string) => !!s.tabs[key]?.adoptId?.startsWith("tab:");

/** What a command of the app's own, already on its way to the strip, will set anyway (Chrome's change came first,
 *  the command commits after it and wins): the order and pins of the tabs an `arrange` lists, the groups of the
 *  tabs a `group` lists, the active tab. */
export type Pending = { arranged: ReadonlySet<string>; grouped?: ReadonlySet<string>; active: boolean };
const NOTHING_PENDING: Pending = { arranged: new Set(), active: false };

/** Chrome's group ids → the store's: bound when the app makes a Chrome group for a store group, or takes in one an
 *  extension made. */
export type GroupBindings = Map<string, string>;

export function chromeChanged(
  s: BrowserState,
  before: StripState | undefined,
  after: StripState,
  context: { seen: ReadonlySet<string>; siblings?: StripState[]; pending?: Pending; groups?: GroupBindings },
): BrowserState {
  const { seen, siblings = [], pending = NOTHING_PENDING, groups = new Map() } = context;
  const was = new Map((before?.tabs ?? []).map((t) => [t.browser, t]));
  const now = after.tabs.filter((t): t is Keyed => known(s, t));
  // A tab stayed when it was there before as the same tab. A tab Chrome made is Chrome's to place the first time
  // the app sees it; any other arrival the app made (created, moved in), and the store already placed it.
  const stayed = (t: Keyed) => was.get(t.browser)?.key === t.key;
  const firstFromChrome = (t: Keyed) => !stayed(t) && !seen.has(t.key) && madeByChrome(s, t.key);
  // An extension moving a tab to another window: it arrives in a strip of another app window.
  const home = homeWindow(s, after, siblings, stayed);
  const movedIn = (t: Keyed) =>
    !was.has(t.browser) && !!home && s.tabs[t.key]!.windowId !== home && engineProfile(s.tabs[t.key]!.profileId) === after.profile;
  const taken = new Set(now.filter((t) => firstFromChrome(t) || movedIn(t)).map((t) => t.key));

  for (const t of now) if (movedIn(t)) s = intoWindow(s, t.key, home!);

  // Order and pins. Tabs are placed last to first, each before the tab Chrome has after it, so several moves land
  // as Chrome's order.
  const followed = now.filter((t) => (stayed(t) || taken.has(t.key)) && !pending.arranged.has(t.key));
  const weight = (t: Keyed) => (groupOf(s, t.key) ? 2 : 1);
  // Tabs an arrange on its way lists don't move here, but they're where the app put them: others can sit by them.
  const kept = new Set([...keptOrder(followed.filter(stayed), (t) => was.get(t.browser)!.index, weight).map((t) => t.key), ...pending.arranged]);
  const settled = new Set(kept);
  for (const t of [...followed].reverse()) {
    const tab = s.tabs[t.key];
    if (!tab) continue;
    // Chrome pinned or unpinned it now (the store may still be getting there itself).
    const pinFlip = tab.pinned !== t.pinned && (taken.has(t.key) || was.get(t.browser)!.pinned !== t.pinned);
    if (kept.has(t.key) && !pinFlip) continue;
    s = placeLike(s, t.key, pinFlip ? t.pinned : tab.pinned, now, settled, kept);
    settled.add(t.key);
  }

  if (reportsGroups(after)) s = groupsChanged(s, before, after, now, (t) => stayed(t) || taken.has(t.key), taken, groups, pending);

  if (!pending.active) {
    const active = after.tabs.find((t) => t.active);
    const previous = before?.tabs.find((t) => t.active);
    // The tab Chrome shows when the active one leaves the strip is the consequence of that; the store's own
    // successor rule (store/openers.ts) picks the one the app shows.
    const left = !!previous && !after.tabs.some((t) => t.browser === previous.browser);
    if (known(s, active) && taken.has(active.key)) s = show(s, active.key);
    else if (known(s, active) && stayed(active) && active.browser !== previous?.browser && !left) s = show(s, active.key);
    else if (known(s, active)) {
      // A tab Chrome made in the background that the app opened in front: Chrome's active tab stays.
      const front = now.find((t) => taken.has(t.key) && !t.active && shownIn(s, t.key));
      if (front) s = show(s, active.key);
    }
  }
  return s;
}

const reportsGroups = (strip: StripState) => strip.tabs.some((t) => t.group !== undefined);

// Chrome's own group changes (an extension's tabs.group / ungroup / tabGroups.update) become the store's: a tab
// joins or leaves a group, a group Chrome made becomes a store group, a group's title, color or collapsed state
// follows. Chrome can't group pinned tabs, and the store's pinned tiles aren't in groups either.
function groupsChanged(
  s: BrowserState,
  before: StripState | undefined,
  after: StripState,
  now: Keyed[],
  followed: (t: Keyed) => boolean,
  taken: ReadonlySet<string>,
  bound: GroupBindings,
  pending: Pending,
): BrowserState {
  const was = new Map((before?.tabs ?? []).map((t) => [t.browser, t.group ?? null]));
  const looks = new Map((after.groups ?? []).map((g) => [g.id, g]));
  const looksBefore = new Map((before?.groups ?? []).map((g) => [g.id, g]));
  for (const t of now) {
    const tab = s.tabs[t.key];
    if (!tab || tab.pinned || !followed(t) || pending.grouped?.has(t.key)) continue;
    const token = t.group ?? null;
    if (!taken.has(t.key) && was.get(t.browser) === token) continue;
    const current = groupOf(s, t.key);
    if (token === null) {
      if (current) s = regroupInPlace(s, t.key, null);
      continue;
    }
    const id = bound.get(token);
    if (id && s.groups[id]) {
      if (current?.id !== id) s = regroupInPlace(s, t.key, id);
      continue;
    }
    // A group Chrome made: the store makes it, with the tabs Chrome has in it.
    const members = now.filter((x) => x.group === token && s.tabs[x.key] && !s.tabs[x.key]!.pinned).map((x) => x.key);
    const [next, made] = withGroup(s, members, { pinned: false, name: looks.get(token)?.title ?? "" });
    if (!made) continue;
    bound.set(token, made);
    s = withLook(next, made, looks.get(token));
  }
  for (const [token, look] of looks) {
    const id = bound.get(token);
    const was = looksBefore.get(token);
    if (!id || !s.groups[id] || (was && was.title === look.title && was.color === look.color && was.collapsed === look.collapsed)) continue;
    s = withLook(s, id, look);
  }
  return s;
}

// Moves a tab into a group, or out of its own, where it is.
function regroupInPlace(s: BrowserState, key: string, groupId: string | null): BrowserState {
  const w = s.windows[s.tabs[key]!.windowId];
  if (!w) return s;
  const beforeId = w.tabIds[w.tabIds.indexOf(key) + 1] ?? null;
  return placing(s, [key], { pinned: false, beforeId, groupId });
}

function withLook(s: BrowserState, id: string, look: StripGroup | undefined): BrowserState {
  const g = s.groups[id];
  if (!g || !look) return s;
  // Chrome always has a color; grey is the store's none.
  const color = look.color === "grey" && !g.color ? null : look.color;
  if (g.name === look.title && g.color === color && g.collapsed === look.collapsed) return s;
  return { ...s, groups: { ...s.groups, [id]: { ...g, name: look.title, color, collapsed: look.collapsed } } };
}

export type GroupStep = { keys: string[]; group: string | null; title?: string; color?: StripGroup["color"]; makes?: string };

/** The next change that makes Chrome's groups in the strip the store's: a Chrome group for a store group that has
 *  none (`makes`), tabs missing from their group, a group's title or color, tabs in a group the store doesn't have
 *  them in. Collapsing isn't sent: Chrome would switch away from a collapsed group's active tab. */
export function groupStep(s: BrowserState, strip: StripState, bound: GroupBindings): GroupStep | null {
  if (!reportsGroups(strip)) return null;
  const tabs = strip.tabs.filter((t): t is Keyed => known(s, t) && !t.pinned && !s.tabs[t.key]!.pinned);
  const looks = new Map((strip.groups ?? []).map((g) => [g.id, g]));
  const tokenOf = (id: string) => [...bound].find(([token, g]) => g === id && looks.has(token))?.[0];
  const storeGroups = [...new Set(tabs.map((t) => groupOf(s, t.key)).filter((g) => !!g))];
  for (const g of storeGroups) {
    const keys = tabs.filter((t) => groupOf(s, t.key)?.id === g!.id).map((t) => t.key);
    const token = tokenOf(g!.id);
    const look = { title: g!.name, color: g!.color ?? "grey" } as const;
    if (!token) return { keys, group: "new", ...look, makes: g!.id };
    const missing = tabs.filter((t) => keys.includes(t.key) && t.group !== token).map((t) => t.key);
    if (missing.length) return { keys: missing, group: token };
    const now = looks.get(token)!;
    if (now.title !== look.title || now.color !== look.color) return { keys, group: token, ...look };
  }
  const strays = tabs.filter((t) => t.group && t.group !== (groupOf(s, t.key) ? tokenOf(groupOf(s, t.key)!.id) : undefined));
  return strays.length ? { keys: strays.map((t) => t.key), group: null } : null;
}

// The workspace window a strip belongs to: its tabs that stayed, else any tab of a strip of the same app window.
function homeWindow(s: BrowserState, strip: StripState, siblings: StripState[], stayed: (t: Keyed) => boolean): string | undefined {
  const mine = strip.tabs.filter((t): t is Keyed => known(s, t) && stayed(t));
  const other = siblings.flatMap((x) => x.tabs).filter((t): t is Keyed => known(s, t));
  const t = mine[0] ?? other[0];
  return t && s.windows[s.tabs[t.key]!.windowId] ? s.tabs[t.key]!.windowId : undefined;
}

const shownIn = (s: BrowserState, key: string) => {
  const tab = s.tabs[key]!;
  return s.windows[tab.windowId]?.activeTabIds[tab.profileId] === key;
};

// The tabs that kept their relative order: the heaviest run of increasing old indexes; the others moved. Which tab of
// a swapped pair moved is ambiguous, so grouped tabs weigh more: an extension's move into a group is read as the
// ungrouped tab joining it (as Chrome does), not as the group's tab leaving.
function keptOrder<T>(items: T[], oldIndex: (t: T) => number, weight: (t: T) => number): T[] {
  const best: number[] = [];
  const back: number[] = [];
  let end = -1;
  items.forEach((t, i) => {
    best[i] = weight(t);
    back[i] = -1;
    for (let j = 0; j < i; j++) {
      if (oldIndex(items[j]!) < oldIndex(t) && best[j]! + weight(t) > best[i]!) {
        best[i] = best[j]! + weight(t);
        back[i] = j;
      }
    }
    if (end < 0 || best[i]! > best[end]!) end = i;
  });
  const out: T[] = [];
  for (let i = end; i >= 0; i = back[i]!) out.push(items[i]!);
  return out.reverse();
}

// Puts `key` where Chrome has it: before the next tab Chrome has after it that is already in place (else after the
// one before it that doesn't move), pinned as given, in the group its new neighbours share (or its own, if a
// neighbour is in it). A split is one row: its panes move together, and nothing lands between them.
function placeLike(
  s: BrowserState,
  key: string,
  pinned: boolean,
  strip: Keyed[],
  settled: ReadonlySet<string>,
  kept: ReadonlySet<string>,
): BrowserState {
  const w = s.windows[s.tabs[key]!.windowId];
  if (!w) return s;
  const panes = splitOf(s, key)?.tabIds ?? [key];
  const moving = w.tabIds.filter((id) => panes.includes(id));
  const i = strip.findIndex((t) => t.key === key);
  const other = (t: Keyed) => !!s.tabs[t.key] && !panes.includes(t.key) && s.tabs[t.key]!.windowId === w.id;
  const next = strip.slice(i + 1).find((t) => other(t) && settled.has(t.key))?.key;
  const prior = strip.slice(0, i).reverse().find((t) => other(t) && kept.has(t.key))?.key;
  const rowStart = (id: string) => w.tabIds.find((t) => splitOf(s, id)?.tabIds.includes(t)) ?? id;
  const rowAfter = (id: string) => {
    const row = splitOf(s, id)?.tabIds ?? [id];
    const last = Math.max(...row.map((t) => w.tabIds.indexOf(t)));
    return w.tabIds.slice(last + 1).find((t) => !moving.includes(t)) ?? null;
  };
  const beforeId = next ? rowStart(next) : prior ? rowAfter(prior) : (w.tabIds.find((t) => !moving.includes(t)) ?? null);
  const own = groupOf(s, key)?.id;
  const around = [groupOf(s, prior)?.id, groupOf(s, next)?.id];
  const groupId = pinned ? null : around[0] && around[0] === around[1] ? around[0] : own && around.includes(own) ? own : null;
  return placing(s, moving, { pinned, beforeId, groupId });
}

// An extension moved the tab to another window: it changes window as it is, page, live state and all (its view
// takes the same browser over there: lib/chromeTabs.ts announceMoves).
function intoWindow(s: BrowserState, key: string, to: string): BrowserState {
  const tab = s.tabs[key]!;
  const live = s.live[key];
  if (!s.windows[to] || tab.windowId === to) return s;
  let next = removeTabs(s, [key], false);
  const w = next.windows[to];
  if (!w) return s;
  const tabs = { ...next.tabs, [key]: { ...tab, windowId: to } };
  next = {
    ...next,
    tabs,
    live: live ? { ...next.live, [key]: live } : next.live,
    windows: { ...next.windows, [to]: { ...w, tabIds: pinnedFirst([...w.tabIds, key], tabs) } },
  };
  return next;
}

// Shows `key` as the store's activate does, for the profile its window shows (a profile in the background keeps
// its own tab). A split's other pane only becomes the focused one when the user focuses it (onPageFocus).
function show(s: BrowserState, key: string): BrowserState {
  const tab = s.tabs[key]!;
  const w = s.windows[tab.windowId];
  if (!w || w.profileId !== tab.profileId) return s;
  const shown = w.activeTabIds[tab.profileId];
  if (shown === key || (shown && splitOf(s, shown)?.tabIds.includes(key))) return s;
  let next = apply(s, activated(s, key));
  if (shown && !switchKeepsOpeners(s, shown, key)) next = forgetOpeners(next, w.id);
  return next;
}

export type StripPlan = { keys: string[]; pinned: number; active: string | null };

/** What the store wants Chrome's strip to be: the store's tabs in it in the window's order, pinned ones first, and
 *  the tab the window shows for the profile in it. Null when none of its tabs is the store's. */
export function stripPlan(s: BrowserState, strip: StripState): StripPlan | null {
  const mine = strip.tabs.filter((t): t is Keyed => known(s, t));
  if (!mine.length) return null;
  const windowId = s.tabs[(mine.find((t) => t.active) ?? mine[0]!).key]!.windowId;
  const w = s.windows[windowId];
  if (!w) return null;
  const inStrip = new Set(mine.map((t) => t.key));
  const keys = w.tabIds.filter((id) => inStrip.has(id));
  const pinned = keys.filter((id) => s.tabs[id]!.pinned);
  // Profiles sharing their engine data share a strip: the one the window shows wins.
  const profiles = [w.profileId, ...new Set(keys.map((id) => s.tabs[id]!.profileId))];
  const active = profiles.map((p) => w.activeTabIds[p]).find((id) => !!id && inStrip.has(id)) ?? null;
  return { keys: [...pinned, ...keys.filter((id) => !s.tabs[id]!.pinned)], pinned: pinned.length, active };
}

/** The same shape, read from Chrome's strip, for the plan's tabs. */
export function stripActual(strip: StripState, plan: StripPlan): StripPlan {
  const planned = new Set(plan.keys);
  const tabs = strip.tabs.filter((t) => t.key && planned.has(t.key));
  return {
    keys: tabs.map((t) => t.key!),
    pinned: tabs.filter((t) => t.pinned).length,
    active: strip.tabs.find((t) => t.active)?.key ?? null,
  };
}
