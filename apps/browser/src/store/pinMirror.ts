import type { BrowserState } from "./browser";
import { changedIds } from "./changes";
import { orderSections, syncGroupOrder } from "./groups";
import { IDLE_LIVE, isIncognitoProfile, makeTab, newId, pinnedFirst } from "./model";
import { samePage } from "./organize";
import { removeTabs } from "./tabs";
import type { BrowserWindow, Tab, TabGroup } from "./types";

// Pinned tabs belong to the profile, as in Dia and Arc: every regular window that shows a profile shows the same
// pinned tiles and pinned groups, in the same order. Each window keeps its own copy of each one (its own Tab, linked
// to the others by `pinKey`), so each has its own page: a copy made for another window starts unloaded and loads
// when clicked there. `mirrorPins` (a store listener, store/browser.ts) carries any change of one window's pinned
// section (pin, unpin, reorder, rename, icon, pinned URL, pinned groups) to the profile's other windows, and gives a
// window that starts showing a profile (⌘N, paging, a relaunch) the profile's pins.

type Keyed = { id: string; pinKey?: string };
export const pinKeyOf = (x: Keyed) => x.pinKey ?? x.id;
const homeOf = (t: Pick<Tab, "url" | "pinnedUrl">) => t.pinnedUrl || t.url;
const hasPage = (t: Tab) => !!t.navigation || !!t.adoptId;
const mirrored = (w: BrowserWindow | undefined): w is BrowserWindow => !!w && !w.incognito && w.kind !== "small";

type Section = { tiles: Tab[]; groups: { group: TabGroup; members: Tab[] }[] };

function sectionOf(s: Pick<BrowserState, "tabs" | "groups">, w: BrowserWindow, profileId: string, pinnedGroups: TabGroup[]): Section {
  const tiles: Tab[] = [];
  for (const id of w.tabIds) {
    const t = s.tabs[id];
    if (t?.pinned && t.profileId === profileId) tiles.push(t);
  }
  const at = new Map(w.tabIds.map((id, i) => [id, i]));
  const groups = pinnedGroups
    .filter((g) => g.windowId === w.id && g.profileId === profileId)
    .map((group) => ({ group, members: group.tabIds.map((id) => s.tabs[id]).filter((t): t is Tab => !!t) }))
    .filter((g) => g.members.length)
    .sort((a, z) => (at.get(a.members[0]!.id) ?? 0) - (at.get(z.members[0]!.id) ?? 0));
  return { tiles, groups };
}

const tileSig = (t: Tab) => `${pinKeyOf(t)}\u0001${t.pinnedUrl ?? ""}\u0001${t.customTitle ?? ""}\u0001${t.customIcon ?? ""}`;
const memberSig = (t: Tab) => `${pinKeyOf(t)}\u0001${t.customTitle ?? ""}\u0001${t.customIcon ?? ""}`;
const signature = (x: Section) =>
  [
    ...x.tiles.map(tileSig),
    ...x.groups.map(({ group: g, members }) => `G${pinKeyOf(g)}\u0001${g.name}\u0001${g.icon ?? ""}\u0001${g.color ?? ""}\u0002${members.map(memberSig).join("\u0002")}`),
  ].join("\n");

// The profiles a window shows: those it has tabs of (a window paged to another profile keeps the first one's tabs).
function profilesOf(s: Pick<BrowserState, "tabs">, w: BrowserWindow): Set<string> {
  const out = new Set<string>();
  for (const id of w.tabIds) {
    const p = s.tabs[id]?.profileId;
    if (p && !isIncognitoProfile(p)) out.add(p);
  }
  return out;
}

const pinnedGroupsOf = (s: Pick<BrowserState, "groups">) => Object.values(s.groups).filter((g) => g.pinned);

function hasDuplicates(x: Section): boolean {
  const tabs = [...x.tiles, ...x.groups.flatMap((g) => g.members)].map(pinKeyOf);
  const groups = x.groups.map((g) => pinKeyOf(g.group));
  return new Set(tabs).size < tabs.length || new Set(groups).size < groups.length;
}

// Only a change to what a pinned section shows (not a title, an icon or a load) needs a look.
const PIN_FIELDS = ["pinned", "pinnedUrl", "customTitle", "customIcon", "profileId", "windowId", "pinKey"] as const;
function pinsMayDiffer(s: BrowserState, prev: BrowserState): boolean {
  if (s.windows !== prev.windows || s.groups !== prev.groups) return true;
  if (s.tabs === prev.tabs) return false;
  let members: Set<string> | null = null;
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const a = s.tabs[id];
    const b = prev.tabs[id];
    if (!a || !b) {
      if (a?.pinned || b?.pinned) return true;
      members ??= new Set(pinnedGroupsOf(s).flatMap((g) => g.tabIds));
      if (members.has(id)) return true;
      continue;
    }
    if (PIN_FIELDS.some((f) => a[f] !== b[f])) return true;
  }
  return false;
}

/** The profile's pinned section every window should show, as a list of the copies to make it from. */
type Spec = { tiles: Tab[]; groups: { group: TabGroup; members: Tab[] }[] };

function union(sections: Section[]): Spec {
  const spec: Spec = { tiles: [], groups: [] };
  const keys = new Set<string>();
  for (const x of sections) {
    // Windows that pinned one page each on their own (before pins were the profile's) share one tile.
    const earlier = [...spec.tiles];
    for (const t of x.tiles) {
      if (keys.has(pinKeyOf(t)) || earlier.some((o) => samePage(homeOf(o), homeOf(t)))) continue;
      keys.add(pinKeyOf(t));
      spec.tiles.push(t);
    }
    for (const g of x.groups) {
      const members: Tab[] = [];
      for (const m of g.members) if (!keys.has(pinKeyOf(m))) (keys.add(pinKeyOf(m)), members.push(m));
      const seen = spec.groups.find((o) => pinKeyOf(o.group) === pinKeyOf(g.group));
      if (seen) seen.members.push(...members);
      else if (members.length) spec.groups.push({ group: g.group, members });
    }
  }
  return spec;
}

const keyField = (id: string, key: string) => (id === key ? { pinKey: undefined } : { pinKey: key });

function copyOf(src: Tab, windowId: string, tile: boolean): Tab {
  const url = tile ? homeOf(src) : src.url;
  const atSource = samePage(src.url, url);
  return {
    ...makeTab(windowId, src.profileId, url, {
      title: atSource ? src.title : "",
      favicon: atSource ? src.favicon : null,
      pinned: tile,
      pinnedUrl: tile ? src.pinnedUrl || src.url || null : null,
      customTitle: src.customTitle,
      customIcon: src.customIcon,
      muted: src.muted,
      zoom: src.zoom,
    }),
    pinKey: pinKeyOf(src),
    navigation: null,
    unloaded: true,
  };
}

// Makes window `windowId`'s pinned section for `profileId` the spec's: its copies are kept (by key, or a tile by its
// pinned URL), missing ones are made unloaded, and the ones the spec doesn't have leave: a copy without a page goes,
// one with a page (or on screen) stays as a regular tab, so no page closes under the user.
function conform(s: BrowserState, windowId: string, profileId: string, spec: Spec): BrowserState {
  const w = s.windows[windowId]!;
  const cur = sectionOf(s, w, profileId, pinnedGroupsOf(s));
  const mine = [...cur.tiles, ...cur.groups.flatMap((g) => g.members)];
  const used = new Set<string>();
  const tabs = { ...s.tabs };
  const live = { ...s.live };
  let groups = { ...s.groups };
  const reuse = (src: Tab, tile: boolean): string => {
    const key = pinKeyOf(src);
    // Of two copies of one pin (a page moved in), the one with a page stays.
    const same = mine.filter((m) => !used.has(m.id) && pinKeyOf(m) === key);
    let t = same.find(hasPage) ?? same[0];
    if (!t && tile) t = cur.tiles.find((m) => !used.has(m.id) && samePage(homeOf(m), homeOf(src)));
    if (!t) {
      const copy = copyOf(src, windowId, tile);
      tabs[copy.id] = copy;
      live[copy.id] = IDLE_LIVE;
      used.add(copy.id);
      return copy.id;
    }
    used.add(t.id);
    const patch: Partial<Tab> = { ...keyField(t.id, key), pinned: tile, customTitle: src.customTitle, customIcon: src.customIcon };
    if (tile) {
      patch.pinnedUrl = src.pinnedUrl || src.url || null;
      if (!hasPage(t) && !samePage(t.url, homeOf(src))) Object.assign(patch, { url: homeOf(src), title: src.title, favicon: src.favicon });
    } else patch.pinnedUrl = null;
    tabs[t.id] = { ...t, ...patch };
    return t.id;
  };
  const tileIds = spec.tiles.map((t) => reuse(t, true));
  const usedGroups = new Set<string>();
  const memberIds: string[] = [];
  for (const { group: src, members } of spec.groups) {
    const key = pinKeyOf(src);
    const own = cur.groups.find((g) => !usedGroups.has(g.group.id) && pinKeyOf(g.group) === key)?.group;
    const id = own?.id ?? newId("g");
    usedGroups.add(id);
    const ids = members.map((m) => reuse(m, false));
    memberIds.push(...ids);
    const base: TabGroup = own ?? { id, windowId, profileId, name: "", icon: null, color: null, collapsed: src.collapsed, pinned: true, tabIds: [], createdAt: Date.now() };
    groups[id] = { ...base, ...keyField(id, key), name: src.name, icon: src.icon, color: src.color, pinned: true, tabIds: ids };
  }
  // Members reused elsewhere leave their old group.
  const placed = new Set([...tileIds, ...memberIds]);
  for (const { group } of cur.groups) {
    if (usedGroups.has(group.id)) continue;
    const left = (groups[group.id]?.tabIds ?? []).filter((id) => !placed.has(id));
    groups[group.id] = { ...group, tabIds: left };
  }

  const shown = new Set(Object.values(w.activeTabIds));
  const leaving = mine.filter((t) => !used.has(t.id));
  const demoted = leaving.filter((t) => hasPage(t) || shown.has(t.id)).map((t) => t.id);
  const gone = leaving.filter((t) => !demoted.includes(t.id)).map((t) => t.id);
  for (const id of demoted) tabs[id] = { ...tabs[id]!, pinned: false, pinnedUrl: null, pinKey: undefined };
  // A group no window pins any more stays as a regular group of the pages it still has.
  for (const { group } of cur.groups) {
    if (usedGroups.has(group.id)) continue;
    const left = groups[group.id]!.tabIds.filter((id) => demoted.includes(id));
    if (left.length) groups[group.id] = { ...groups[group.id]!, pinned: false, pinKey: undefined, tabIds: left };
    else delete groups[group.id];
  }

  const section = new Set([...mine.map((t) => t.id), ...placed]);
  const ids = [...tileIds, ...memberIds, ...demoted, ...w.tabIds.filter((id) => !section.has(id))];
  const window = { ...w, tabIds: orderSections(pinnedFirst(ids, tabs), tabs, groups) };
  groups = syncGroupOrder(groups, window);
  const next: BrowserState = { ...s, tabs, live, groups, windows: { ...s.windows, [windowId]: window } };
  return gone.length ? removeTabs(next, gone, false) : next;
}

/** What makes every window of a profile show the same pinned section after `prev` → `s`, or null when they do. */
export function mirrorPins(s: BrowserState, prev: BrowserState): BrowserState | null {
  if (!pinsMayDiffer(s, prev)) return null;
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].filter((id) => mirrored(s.windows[id]));
  const byProfile = new Map<string, string[]>();
  for (const id of order) for (const p of profilesOf(s, s.windows[id]!)) byProfile.set(p, [...(byProfile.get(p) ?? []), id]);
  // A window holding two copies of one pin (a page moved in, windows merged) keeps one: the one with a page, in the
  // place of the first.
  let next = s;
  for (const [profileId, ids] of byProfile) {
    for (const id of ids) {
      const x = sectionOf(next, next.windows[id]!, profileId, pinnedGroupsOf(next));
      if (hasDuplicates(x)) next = conform(next, id, profileId, union([x]));
    }
  }
  const nowGroups = pinnedGroupsOf(next);
  const prevGroups = pinnedGroupsOf(prev);
  for (const [profileId, ids] of byProfile) {
    if (ids.length < 2) continue;
    const sections = new Map(ids.map((id) => [id, sectionOf(next, next.windows[id]!, profileId, nowGroups)]));
    const sigs = new Map(ids.map((id) => [id, signature(sections.get(id)!)]));
    if (new Set(sigs.values()).size === 1) continue;
    // A window that showed the profile before and whose pins changed is where the user (or sync, or an extension)
    // changed them: the focused one if several. A window that only now shows the profile takes the others'.
    const before = ids.filter((id) => mirrored(prev.windows[id]) && profilesOf(prev, prev.windows[id]!).has(profileId));
    const source = before.find((id) => signature(sectionOf(prev, prev.windows[id]!, profileId, prevGroups)) !== sigs.get(id));
    const spec: Spec = source
      ? sections.get(source)!
      : union([...before, ...ids.filter((id) => !before.includes(id))].map((id) => sections.get(id)!));
    const want = source ? sigs.get(source)! : null;
    for (const id of ids) {
      if (id === source || (want !== null && sigs.get(id) === want) || !next.windows[id]) continue;
      next = conform(next, id, profileId, spec);
    }
  }
  return next === s ? null : next;
}

/**
 * After `moved` tabs went from their windows to `targetId` (Move to Window, a drag, Merge All Windows, an extension):
 * a pinned tab's page moved, not the pin. The window it left keeps an unloaded copy in its place (unless that window
 * went), and a pinned group's member takes the place of the target's copy of it. Two copies of one tile in the target
 * become one in `mirrorPins`.
 */
export function settleMovedPins(before: BrowserState, after: BrowserState, moved: string[], targetId: string): BrowserState {
  if (!mirrored(after.windows[targetId])) return after;
  const memberOf = new Map<string, TabGroup>();
  for (const g of pinnedGroupsOf(before)) for (const id of g.tabIds) memberOf.set(id, g);
  const pins = moved
    .map((id) => before.tabs[id])
    .filter((t): t is Tab => !!t && (t.pinned || memberOf.has(t.id)) && t.windowId !== targetId && after.tabs[t.id]?.windowId === targetId);
  if (!pins.length) return after;
  const tabs = { ...after.tabs };
  const live = { ...after.live };
  const windows = { ...after.windows };
  const groups = { ...after.groups };
  // The windows they left keep the pin.
  for (const sourceId of new Set(pins.map((t) => t.windowId))) {
    const src = windows[sourceId];
    if (!mirrored(src) || !mirrored(before.windows[sourceId])) continue;
    const swap = new Map<string, string>();
    for (const t of pins) {
      if (t.windowId !== sourceId) continue;
      const copy = copyOf(t, sourceId, t.pinned);
      tabs[copy.id] = copy;
      live[copy.id] = IDLE_LIVE;
      swap.set(t.id, copy.id);
    }
    const present = new Set([...src.tabIds, ...swap.values()]);
    const keep = (ids: string[]) => ids.map((id) => swap.get(id) ?? id).filter((id) => present.has(id));
    for (const g of pinnedGroupsOf(before)) {
      if (g.windowId === sourceId && g.tabIds.some((id) => swap.has(id))) groups[g.id] = { ...g, ...groups[g.id], tabIds: keep(g.tabIds) };
    }
    windows[sourceId] = { ...src, tabIds: pinnedFirst(keep(before.windows[sourceId]!.tabIds), tabs) };
  }
  // A pinned group's member takes its copy's place in the target's group (the moved tab stays: it's the one shown).
  const target = windows[targetId]!;
  let tabIds = [...target.tabIds];
  const gone: string[] = [];
  for (const m of pins) {
    const g = memberOf.get(m.id);
    if (!g) continue;
    const own = Object.values(groups).find((x) => x.pinned && x.windowId === targetId && x.profileId === m.profileId && pinKeyOf(x) === pinKeyOf(g));
    const copy = own?.tabIds.find((id) => tabs[id] && pinKeyOf(tabs[id]!) === pinKeyOf(m));
    if (!own || !copy) continue;
    groups[own.id] = { ...own, tabIds: own.tabIds.map((id) => (id === copy ? m.id : id)) };
    tabIds = tabIds.filter((id) => id !== m.id);
    tabIds[tabIds.indexOf(copy)] = m.id;
    if (hasPage(tabs[copy]!) || Object.values(target.activeTabIds).includes(copy)) {
      tabs[copy] = { ...tabs[copy]!, pinKey: undefined };
      tabIds.push(copy);
    } else gone.push(copy);
  }
  windows[targetId] = { ...target, tabIds: orderSections(pinnedFirst(tabIds, tabs), tabs, groups) };
  const next: BrowserState = { ...after, tabs, live, windows, groups };
  return gone.length ? removeTabs(next, gone, false) : next;
}
