import type { BrowserState } from "./browser";
import { orderSections, syncGroupOrder } from "./groups";
import { IDLE_LIVE, makeTab, newId, pinnedFirst, snapshotTab, without } from "./model";
import { samePage } from "./organize";
import { pinKeyOf } from "./pinMirror";
import type { BrowserWindow, HistoryEntry, ParkedPins, Tab, TabGroup } from "./types";


// With `windows`, a profile another regular window still shows keeps its pins there (store/pinMirror.ts): only the
// last window of a profile parks them.
type PinSource = Pick<BrowserState, "tabs" | "groups" | "history"> & Partial<Pick<BrowserState, "windows">>;

function atPin(t: Tab, history: HistoryEntry[]): Partial<Pick<Tab, "url" | "title" | "favicon">> {
  const home = t.pinnedUrl;
  if (!home || !t.url || samePage(t.url, home)) return {};
  const entry = history.find((h) => samePage(h.url, home));
  return { url: home, title: entry?.title ?? t.title, favicon: entry?.favicon ?? t.favicon };
}

const homeOf = (t: { url: string; pinnedUrl?: string | null }) => t.pinnedUrl || t.url;

export function parkWindowPins(parked: Record<string, ParkedPins>, w: BrowserWindow, s: PinSource): Record<string, ParkedPins> {
  if (w.incognito) return parked;
  const groupOf = new Map<string, TabGroup>();
  for (const g of Object.values(s.groups)) if (g.pinned && g.windowId === w.id) for (const id of g.tabIds) groupOf.set(id, g);
  let next = parked;
  const profiles = new Set(w.tabIds.map((id) => s.tabs[id]?.profileId).filter((p): p is string => !!p));
  const shownElsewhere = (profileId: string) =>
    Object.values(s.windows ?? {}).some((o) => o.id !== w.id && !o.incognito && o.kind !== "small" && o.tabIds.some((id) => s.tabs[id]?.profileId === profileId));
  for (const profileId of profiles) {
    if (shownElsewhere(profileId)) continue;
    const own = w.tabIds.map((id) => s.tabs[id]).filter((t): t is Tab => !!t && t.profileId === profileId);
    if (!own.some((t) => t.pinned || groupOf.has(t.id))) continue;
    const old = next[profileId] ?? { tabs: [], groups: [] };
    const ids = new Set(old.tabs.map((p) => p.id));
    const homes = old.tabs.filter((p) => !p.groupId).map(homeOf);
    const groups = [...old.groups];
    const tiles: ParkedPins["tabs"] = [];
    const members: ParkedPins["tabs"] = [];
    for (const t of own) {
      if (ids.has(pinKeyOf(t))) continue;
      const g = t.pinned ? undefined : groupOf.get(t.id);
      if (t.pinned) {
        const tile = { ...snapshotTab(t), ...atPin(t, s.history[profileId] ?? []), id: pinKeyOf(t), groupId: null };
        if (homes.some((h) => samePage(h, homeOf(tile)))) continue;
        homes.push(homeOf(tile));
        tiles.push(tile);
      } else if (g) {
        if (!groups.some((x) => x.id === pinKeyOf(g))) groups.push({ id: pinKeyOf(g), name: g.name, icon: g.icon, color: g.color, collapsed: g.collapsed });
        members.push({ ...snapshotTab(t), id: pinKeyOf(t), groupId: pinKeyOf(g) });
      }
    }
    const oldTiles = old.tabs.filter((p) => !p.groupId);
    const oldMembers = old.tabs.filter((p) => p.groupId);
    next = { ...next, [profileId]: { tabs: [...oldTiles, ...tiles, ...oldMembers, ...members], groups } };
  }
  return next;
}

export function adoptParkedPins(s: BrowserState, windowId: string, profileId: string): BrowserState {
  const park = s.parkedPins[profileId];
  const w = s.windows[windowId];
  if (!park || !w || w.incognito || !s.profiles[profileId]) return s;
  const tabs = { ...s.tabs };
  const live = { ...s.live };
  const homes = w.tabIds.map((id) => tabs[id]).filter((t): t is Tab => !!t?.pinned && t.profileId === profileId).map(homeOf);
  const members = new Map<string, string[]>();
  const added: string[] = [];
  for (const { id, groupId, ...snap } of park.tabs) {
    const home = homeOf(snap);
    if (!groupId && homes.some((h) => samePage(h, home))) continue;
    const tab: Tab = {
      ...makeTab(windowId, profileId, snap.url, { ...snap, profileId, pinned: !groupId, pinnedUrl: groupId ? null : home || null }),
      // A copy's key stays the pin's (sync keys pins by it).
      ...(tabs[id] ? { id: newId("tab"), pinKey: id } : { id }),
      navigation: null,
      unloaded: true,
    };
    tabs[tab.id] = tab;
    live[tab.id] = IDLE_LIVE;
    added.push(tab.id);
    if (groupId) members.set(groupId, [...(members.get(groupId) ?? []), tab.id]);
  }
  let groups = { ...s.groups };
  for (const g of park.groups) {
    const tabIds = members.get(g.id);
    if (!tabIds?.length) continue;
    const id = groups[g.id] ? newId("g") : g.id;
    groups[id] = { ...g, id, ...(id === g.id ? {} : { pinKey: g.id }), windowId, profileId, pinned: true, tabIds, createdAt: Date.now() };
  }
  const window = { ...w, tabIds: orderSections(pinnedFirst([...added, ...w.tabIds], tabs), tabs, groups) };
  groups = syncGroupOrder(groups, window);
  return { ...s, tabs, live, groups, windows: { ...s.windows, [windowId]: window }, parkedPins: without(s.parkedPins, [profileId]) };
}
