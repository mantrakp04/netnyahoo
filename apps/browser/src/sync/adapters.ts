import { addHistoryVisits, deleteHistoryUrls, deletePassword, savePassword } from "@netnyahoo/nncore";
import { assignPositions, SyncNative, type Adapter, type Extraction, type SavedLogin } from "@netnyahoo/sync";
import { bookmarkUuidFor, ensureRoots, isBookmarkUuid } from "../store/bookmarks";
import { MAX_HISTORY, MAX_VISIT_TIMES } from "../store/history";
import { useBrowser, type BrowserState } from "../store/browser";
import { orderSections, syncGroupOrder } from "../store/groups";
import { engineProfile, makeTab, pinnedFirst, without } from "../store/model";
import { adoptParkedPins, parkWindowPins } from "../store/parkedPins";
import { pinKeyOf } from "../store/pinMirror";
import { removeTabs } from "../store/tabs";
import { DEFAULT_PROFILE_ID, type Settings } from "../store/settings";
import type { BookmarkNode, HistoryEntry, Profile, Tab, TabGroup } from "../store/types";

const store = () => useBrowser.getState();

// MARK: App scope: settings, profiles, devices

export const SYNCED_SETTINGS = [
  "warnBeforeQuitting",
  "warnBeforeClosingWindow",
  "searchEngine",
  "customSearchUrl",
  "customSearchEngines",
  "searchSuggestions",
  "commandBarPreference",
  "tabLayout",
  "hideToolbarWhileScrolling",
  "newTabPosition",
  "warnBeforeClosingLastTab",
  "warnBeforeMovingTabsToProfile",
  "tabReorderHaptics",
  "extendWebsiteColor",
  "cmdClickCreatesTabGroup",
  "optShiftClickOpensInGroup",
  "autoGroupMeetingTabs",
  "cleanUpInactiveTabsAfterHours",
  "mutedSites",
  "autoPictureInPicture",
  "showFullUrl",
  "bookmarksBar",
  "appearance",
  "addressBar",
  "shortcuts",
] as const satisfies readonly (keyof Settings)[];

export const settingsAdapter: Adapter = {
  prefix: "set:",
  adoptRemoteOnJoin: true,
  extract: () => {
    const settings = store().settings;
    return { values: new Map(SYNCED_SETTINGS.map((name) => [`set:${name}`, { v: settings[name] ?? null }])) };
  },
  apply: (visible, changed) => {
    const patch: Record<string, unknown> = {};
    for (const key of changed) {
      const name = key.slice(4);
      const record = visible.get(key) as { v: unknown } | undefined;
      if (record && "v" in record && (SYNCED_SETTINGS as readonly string[]).includes(name)) patch[name] = record.v;
    }
    if (Object.keys(patch).length) store().updateSettings(patch as Partial<Settings>);
  },
};

export type ProfileRecord = { n: string; c: Profile["color"]; i: string | null; d?: true };

export function profilesAdapter(links: () => Record<string, { syncId: string }>): Adapter {
  const linked = () => Object.entries(links()).filter(([id]) => store().profiles[id]);
  return {
    prefix: "prof:",
    adoptRemoteOnJoin: true,
    extract: () => {
      const values = new Map<string, unknown>();
      for (const [id, { syncId }] of linked()) {
        const p = store().profiles[id]!;
        values.set(`prof:${syncId}`, { n: p.name, c: p.color, i: p.icon, ...(id === DEFAULT_PROFILE_ID ? { d: true } : {}) } satisfies ProfileRecord);
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key) };
    },
    apply: (visible, changed) => {
      for (const [id, { syncId }] of linked()) {
        const record = visible.get(`prof:${syncId}`) as ProfileRecord | undefined;
        if (!record || !changed.has(`prof:${syncId}`)) continue;
        store().updateProfile(id, { name: record.n, color: record.c, icon: record.i });
      }
    },
  };
}

export type DeviceRecord = { n: string };

export function deviceAdapter(deviceId: string, name: () => string, retired = false): Adapter {
  return {
    prefix: "dev:",
    extract: () => ({
      values: retired ? new Map() : new Map([[`dev:${deviceId}`, { n: name() } satisfies DeviceRecord]]),
      ignore: (key) => key !== `dev:${deviceId}`,
    }),
    apply: () => true,
  };
}

// MARK: Profile scope

type BookmarkValue = { k: "u" | "f"; p: string; t: string; u?: string; a: number; pos: string };

// A bookmark's record key is its sync key: Chrome's UUID, or for a bookmark synced before Chrome kept bookmarks,
// its old id (kept on Chrome's node as `syncKey`), so Macs not yet updated and updated ones name it alike. A key
// that isn't a UUID becomes the node bookmarkUuidFor gives, on every Mac.
export function bookmarksAdapter(profileId: string): Adapter {
  // Before the tree is read from Chrome it's empty, which would read as every bookmark deleted.
  const ready = () => !!store().bookmarksReady[profileId];
  return {
    prefix: "bm:",
    extract: (base) => {
      if (!ready()) return null;
      const b = store().bookmarks;
      const roots = b.roots[profileId];
      const values = new Map<string, unknown>();
      if (!roots) return { values };
      // An old key names this node only if it maps to it (a copy of a bookmark carries its original's key along).
      const keyOf = (id: string) => {
        if (id === roots.bar) return "bar";
        if (id === roots.other) return "other";
        const key = b.nodes[id]?.syncKey;
        return key && bookmarkUuidFor(key) === id ? key : id;
      };
      const seen = new Set<string>();
      const walk = (folderId: string) => {
        const folder = b.nodes[folderId];
        if (folder?.kind !== "folder" || seen.has(folderId)) return;
        seen.add(folderId);
        const parent = keyOf(folderId);
        const children = folder.children.filter((id) => b.nodes[id]);
        const positions = assignPositions(
          children.map((id) => {
            const known = base(`bm:${keyOf(id)}`) as BookmarkValue | undefined;
            return known?.p === parent ? known.pos : undefined;
          }),
        );
        children.forEach((id, i) => {
          const node = b.nodes[id]!;
          values.set(`bm:${keyOf(id)}`, {
            k: node.kind === "url" ? "u" : "f",
            p: parent,
            t: node.title,
            ...(node.kind === "url" ? { u: node.url } : {}),
            a: node.addedAt,
            pos: positions[i]!,
          } satisfies BookmarkValue);
          if (node.kind === "folder") walk(id);
        });
      };
      walk(roots.bar);
      walk(roots.other);
      return { values };
    },
    apply: (visible) => {
      if (!ready()) return false;
      const s = store();
      const [b, roots] = ensureRoots(s.bookmarks, profileId);
      // By node id; a key that isn't a UUID names the node bookmarkUuidFor gives it.
      const values = new Map([...visible].map(([k, v]) => [bookmarkUuidFor(k.slice(3)), v as BookmarkValue]));
      const keys = new Map([...visible.keys()].map((k) => [bookmarkUuidFor(k.slice(3)), k.slice(3)]));
      const rootOf = (key: string) => (key === "bar" ? roots.bar : key === "other" ? roots.other : null);
      const parentOf = new Map<string, string>();
      for (const [id, v] of values) {
        const root = rootOf(v.p);
        const parent = root ? null : bookmarkUuidFor(v.p);
        parentOf.set(id, root ?? (parent && values.get(parent)?.k === "f" ? parent : roots.other));
      }
      for (const id of [...values.keys()].sort()) {
        const seen = new Set<string>([id]);
        for (let at = parentOf.get(id)!; parentOf.has(at); at = parentOf.get(at)!) {
          if (seen.has(at)) {
            parentOf.set(id, roots.other);
            break;
          }
          seen.add(at);
        }
      }
      const children = new Map<string, string[]>([[roots.bar, []], [roots.other, []]]);
      for (const id of values.keys()) children.set(parentOf.get(id)!, [...(children.get(parentOf.get(id)!) ?? []), id]);
      const byPosition = (a: string, z: string) => {
        const pa = values.get(a)!.pos;
        const pz = values.get(z)!.pos;
        const ka = keys.get(a)!;
        const kz = keys.get(z)!;
        return pa < pz ? -1 : pa > pz ? 1 : ka < kz ? -1 : 1;
      };
      const nodes: Record<string, BookmarkNode> = { ...b.nodes };
      const drop = (id: string) => {
        const node = nodes[id];
        if (node?.kind === "folder") node.children.forEach(drop);
        if (id !== roots.bar && id !== roots.other) delete nodes[id];
      };
      drop(roots.bar);
      drop(roots.other);
      for (const [id, v] of values) {
        const old = b.nodes[id];
        const key = keys.get(id)!;
        const syncKey = isBookmarkUuid(key) ? {} : { syncKey: key };
        nodes[id] =
          v.k === "u"
            ? { kind: "url", id, parentId: parentOf.get(id)!, title: v.t, url: v.u ?? "", favicon: old?.kind === "url" ? old.favicon : null, addedAt: v.a, ...syncKey }
            : { kind: "folder", id, parentId: parentOf.get(id)!, title: v.t, children: [], addedAt: v.a, ...syncKey };
      }
      for (const [parent, ids] of children) {
        const folder = nodes[parent];
        if (folder?.kind === "folder") nodes[parent] = { ...folder, children: ids.sort(byPosition) };
      }
      useBrowser.setState({ bookmarks: { ...b, nodes } });
    },
  };
}

export const HISTORY_WINDOW_MS = 90 * 86_400_000;

type HistoryValue = { t: string; n: number; vt: number[] };
const lastVisitOf = (v: HistoryValue) => Math.max(0, ...v.vt);
// What Chrome keeps in history (an app page, netnyahoo://, it doesn't): other records are left alone.
const keptInHistory = (url: string) => /^(https?|file):/i.test(url);
// Chrome stores visit times in microseconds and reports them in whole ms: the same visit reads back within this.
const SAME_VISIT_MS = 1;

export const historyExpired = (key: string, value: unknown, now: number) =>
  key.startsWith("h:") && lastVisitOf(value as HistoryValue) < now - HISTORY_WINDOW_MS;

// History is Chrome's (lib/history.ts keeps the store's view of it). Applying a record adds its visits to
// Chrome, so Chrome's copy then differs from the record (its own visit count and title). A local edit is a visit
// the record doesn't have; anything else publishes the record unchanged. Two Macs settle on the union of their
// visits instead of trading versions.
export function historyAdapter(profileId: string): Adapter {
  const ready = () => !!store().historyReady[profileId];
  return {
    prefix: "h:",
    extract: (base) => {
      // Before the view is read from Chrome it's empty, which would read as every URL deleted.
      if (!ready()) return null;
      const since = Date.now() - HISTORY_WINDOW_MS;
      const values = new Map<string, unknown>();
      const older = new Set<string>();
      const view = store().history[profileId] ?? [];
      // The view holds Chrome's newest MAX_HISTORY URLs: one visited at or before this may only be missing from it.
      const floor = store().historyFloor[profileId] ?? -Infinity;
      for (const e of view) {
        if (!keptInHistory(e.url)) continue;
        const key = `h:${e.url}`;
        if (e.lastVisit < since) {
          older.add(key);
          continue;
        }
        const local: HistoryValue = { t: e.title, n: e.visits, vt: e.visitTimes?.length ? e.visitTimes : [e.lastVisit] };
        const known = base(key) as HistoryValue | undefined;
        const edited = !known || local.vt.some((t) => !known.vt.some((k) => Math.abs(k - t) <= SAME_VISIT_MS));
        values.set(key, edited ? local : known);
      }
      const ignore = (key: string) => {
        if (older.has(key) || !keptInHistory(key.slice(2))) return true;
        // Chrome expired it (as every Mac does), or the view no longer reaches it: not a deletion.
        const known = base(key) as HistoryValue | undefined;
        return !!known && (lastVisitOf(known) < since || lastVisitOf(known) <= floor);
      };
      return { values, ignore };
    },
    editedAt: (v) => lastVisitOf(v as HistoryValue),
    apply: async (visible, changed) => {
      if (!ready()) return false;
      const since = Date.now() - HISTORY_WINDOW_MS;
      const byUrl = new Map((store().history[profileId] ?? []).map((e) => [e.url, e]));
      const add: { url: string; title: string; visitTimes: number[] }[] = [];
      const remove: string[] = [];
      const updates = new Map<string, HistoryEntry | null>();
      for (const key of changed) {
        const url = key.slice(2);
        if (!keptInHistory(url)) continue;
        const v = visible.get(key) as HistoryValue | undefined;
        const old = byUrl.get(url);
        if (v) {
          const have = old?.visitTimes ?? [];
          const fresh = v.vt.filter((t) => t >= since && !have.some((h) => Math.abs(h - t) <= SAME_VISIT_MS));
          if (fresh.length) add.push({ url, title: v.t, visitTimes: fresh });
          const times = [...have, ...fresh].sort((a, z) => a - z).slice(-MAX_VISIT_TIMES);
          if (!times.length) continue;
          updates.set(url, {
            url,
            title: v.t || old?.title || "",
            favicon: null,
            visits: Math.max(v.n, old?.visits ?? 0),
            lastVisit: times[times.length - 1]!,
            visitTimes: times,
          });
        } else if (old && old.lastVisit >= since) {
          remove.push(url);
          updates.set(url, null);
        }
      }
      if (!updates.size) return;
      const engine = engineProfile(profileId);
      await Promise.all([addHistoryVisits(engine, add, SAME_VISIT_MS), deleteHistoryUrls(engine, remove)]);
      // The view as it is now (Chrome's reports may have landed meanwhile), with the records merged in.
      useBrowser.setState((s) => {
        const current = new Map((s.history[profileId] ?? []).map((e) => [e.url, e]));
        for (const [url, update] of updates) {
          const now = current.get(url);
          if (!update) current.delete(url);
          else if (!now) current.set(url, update);
          else {
            const times = [...new Set([...(now.visitTimes ?? []), ...(update.visitTimes ?? [])])].sort((a, z) => a - z).slice(-MAX_VISIT_TIMES);
            current.set(url, { ...update, visits: Math.max(now.visits, update.visits), lastVisit: times[times.length - 1]!, visitTimes: times });
          }
        }
        const list = [...current.values()].sort((a, z) => z.lastVisit - a.lastVisit).slice(0, MAX_HISTORY);
        return { history: { ...s.history, [profileId]: list } };
      });
    },
  };
}

export type DeviceTabs = { n: string; tabs: { u: string; t: string }[] };
const MAX_DEVICE_TABS = 30;

export function deviceTabsAdapter(profileId: string, deviceId: string, name: () => string, retired = false): Adapter {
  const key = `tabs:${deviceId}`;
  return {
    prefix: "tabs:",
    extract: () => {
      if (retired) return { values: new Map(), ignore: (k) => k !== key };
      const s = store();
      const open = Object.values(s.tabs)
        // Pinned tabs sync as pinned tabs; unloaded tiles aren't open.
        .filter((t) => t.profileId === profileId && !t.pinned && !t.unloaded && /^(https?|file):/.test(t.url) && !s.windows[t.windowId]?.incognito)
        .sort((a, z) => z.lastActiveAt - a.lastActiveAt)
        .slice(0, MAX_DEVICE_TABS)
        .map((t) => ({ u: t.url, t: t.customTitle || t.title }));
      return { values: new Map([[key, { n: name(), tabs: open } satisfies DeviceTabs]]), ignore: (k) => k !== key };
    },
    apply: () => true,
  };
}

type PinValue = { g: string | null; u: string; t: string | null; i: string | null; ti: string; pos: string };
type PinGroupValue = { n: string; i: string | null; c: TabGroup["color"]; pos: string };

type Window = BrowserState["windows"][string];

// Small Yahu's page isn't one of the open tabs: it's thrown away when the window closes.
const openWindows = (s: BrowserState) => s.windowOrder.map((id) => s.windows[id]).filter((w): w is Window => !!w && !w.incognito && w.kind !== "small");

// Where the profile's pins change: a window that shows it (store/pinMirror.ts carries the change to the others).
function homeWindow(s: BrowserState, profileId: string): Window | undefined {
  const order = [...s.ui.focusOrder, ...s.windowOrder].map((id) => s.windows[id]).filter((w): w is Window => !!w && !w.incognito && w.kind !== "small");
  const shows = (w: Window) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId);
  return order.find((w) => w.profileId === profileId && shows(w)) ?? order.find(shows) ?? order.find((w) => w.profileId === profileId) ?? order[0];
}

export function pinnedAdapter(profileId: string): Adapter {
  return {
    prefix: "pin:",
    extract: (base) => {
      const s = store();
      type Pin = Pick<Tab, "id" | "url" | "title" | "customTitle" | "customIcon"> & { pinnedUrl?: string | null };
      const tiles: Pin[] = [];
      const groups: Pick<TabGroup, "id" | "name" | "icon" | "color">[] = [];
      const members = new Map<string, Pin[]>();
      const pinnedGroupOf = new Map<string, TabGroup>();
      for (const g of Object.values(s.groups)) if (g.pinned && g.profileId === profileId) g.tabIds.forEach((id) => pinnedGroupOf.set(id, g));
      // Every window has a copy of each pin (store/pinMirror.ts): one per key.
      // The home window first: it's the copy a change from elsewhere is written to.
      const seen = new Set<string>();
      const home = homeWindow(s, profileId);
      for (const w of home ? [home, ...openWindows(s).filter((w) => w.id !== home.id)] : openWindows(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (!t || t.profileId !== profileId || seen.has(pinKeyOf(t))) continue;
          const g = pinnedGroupOf.get(id);
          if (t.pinned) tiles.push({ ...t, id: pinKeyOf(t) });
          else if (g) {
            const key = pinKeyOf(g);
            if (!members.has(key)) {
              members.set(key, []);
              groups.push({ ...g, id: key });
            }
            members.get(key)!.push({ ...t, id: pinKeyOf(t) });
          } else continue;
          seen.add(pinKeyOf(t));
        }
      }
      const park = s.parkedPins[profileId];
      for (const g of park?.groups ?? []) if (!members.has(g.id)) (members.set(g.id, []), groups.push(g));
      for (const p of park?.tabs ?? []) (p.groupId ? members.get(p.groupId) : tiles)?.push(p);
      const values = new Map<string, unknown>();
      const place = (tabs: Pin[], group: string | null) => {
        const positions = assignPositions(tabs.map((t) => ((base(`pin:t:${t.id}`) as PinValue | undefined)?.g ?? null) === group ? (base(`pin:t:${t.id}`) as PinValue | undefined)?.pos : undefined));
        tabs.forEach((t, i) =>
          values.set(`pin:t:${t.id}`, { g: group, u: (group ? t.url : t.pinnedUrl || t.url) || "", t: t.customTitle, i: t.customIcon, ti: t.title, pos: positions[i]! } satisfies PinValue),
        );
      };
      place(tiles, null);
      const groupPositions = assignPositions(groups.map((g) => (base(`pin:g:${g.id}`) as PinGroupValue | undefined)?.pos));
      groups.forEach((g, i) => {
        values.set(`pin:g:${g.id}`, { n: g.name, i: g.icon, c: g.color, pos: groupPositions[i]! } satisfies PinGroupValue);
        place(members.get(g.id)!, g.id);
      });
      return { values } satisfies Extraction;
    },
    apply: (visible, changed) => {
      let s = store();
      const home = homeWindow(s, profileId);
      if (!home) return false;
      const PARK = `park:${profileId}`;
      if (s.parkedPins[profileId]) {
        const stand: Window = { id: PARK, profileId, incognito: false, tabIds: [], activeTabIds: {}, sidebarOpen: true, frame: null, createdAt: 0 };
        s = adoptParkedPins({ ...s, windows: { ...s.windows, [PARK]: stand } }, PARK, profileId);
      }
      // Pins are keyed by pinKey: here the home window's copy (or the park's) stands for each, and the profile's
      // other windows follow it (store/pinMirror.ts).
      const scope = new Set([home.id, PARK]);
      const tabOfKey = new Map<string, string>();
      const groupOfKey = new Map<string, string>();
      for (const wid of scope) for (const id of s.windows[wid]?.tabIds ?? []) if (s.tabs[id]?.profileId === profileId && !tabOfKey.has(pinKeyOf(s.tabs[id]!))) tabOfKey.set(pinKeyOf(s.tabs[id]!), id);
      for (const g of Object.values(s.groups)) if (g.profileId === profileId && scope.has(g.windowId) && !groupOfKey.has(pinKeyOf(g))) groupOfKey.set(pinKeyOf(g), g.id);
      const tid = (key: string) => tabOfKey.get(key) ?? key;
      const gid = (key: string) => groupOfKey.get(key) ?? key;
      const pins = new Map<string, PinValue>();
      const groupValues = new Map<string, PinGroupValue>();
      for (const [k, v] of visible) {
        if (k.startsWith("pin:t:")) pins.set(tid(k.slice(6)), { ...(v as PinValue), g: (v as PinValue).g && gid((v as PinValue).g!) });
        else if (k.startsWith("pin:g:")) groupValues.set(gid(k.slice(6)), v as PinGroupValue);
      }
      const byPos = <T extends { pos: string }>(m: Map<string, T>) => (a: string, z: string) =>
        m.get(a)!.pos < m.get(z)!.pos ? -1 : m.get(a)!.pos > m.get(z)!.pos ? 1 : a < z ? -1 : 1;
      const groupOrder = [...groupValues.keys()].sort(byPos(groupValues));
      const tileOrder = [...pins.keys()].filter((id) => { const g = pins.get(id)!.g; return !g || !groupValues.has(g); }).sort(byPos(pins));
      const memberOrder = new Map(groupOrder.map((g) => [g, [...pins.keys()].filter((id) => pins.get(id)!.g === g).sort(byPos(pins))]));

      const goneTabs = [...changed].filter((k) => k.startsWith("pin:t:") && !visible.has(k)).map((k) => tid(k.slice(6))).filter((id) => s.tabs[id] && scope.has(s.tabs[id]!.windowId));
      // A pin deleted elsewhere: a tile with a page (or on screen) here stays as a regular tab.
      const removable = goneTabs.filter((id) => {
        const t = s.tabs[id]!;
        const w = s.windows[t.windowId];
        const kept = !!t.navigation || !!t.adoptId || Object.values(w?.activeTabIds ?? {}).includes(id);
        return w && !kept && w.tabIds.some((other) => other !== id && !goneTabs.includes(other));
      });
      s = removeTabs(s, removable, false);
      const tabs = { ...s.tabs };
      for (const id of goneTabs) if (tabs[id]) tabs[id] = { ...tabs[id]!, pinned: false, pinnedUrl: null, pinKey: undefined };
      let groups = { ...s.groups };
      for (const k of changed) if (k.startsWith("pin:g:") && !visible.has(k) && scope.has(groups[gid(k.slice(6))]?.windowId ?? "")) delete groups[gid(k.slice(6))];
      const windows = { ...s.windows };

      for (const id of groupOrder) {
        const v = groupValues.get(id)!;
        const old = groups[id];
        groups[id] = old
          ? { ...old, name: v.n, icon: v.i, color: v.c, pinned: true }
          : { id, windowId: home.id, profileId, name: v.n, icon: v.i, color: v.c, collapsed: false, pinned: true, tabIds: [], createdAt: Date.now() };
      }
      for (const [id, v] of pins) {
        const group = v.g && groups[v.g] ? groups[v.g]! : null;
        const old = tabs[id];
        if (old) {
          tabs[id] = {
            ...old,
            pinned: !group,
            pinnedUrl: group ? null : v.u,
            customTitle: v.t,
            customIcon: v.i,
            ...(old.unloaded ? { url: v.u, title: v.ti } : {}),
          };
          continue;
        }
        const windowId = group?.windowId ?? home.id;
        const w = windows[windowId];
        if (!w) continue;
        const tab: Tab = {
          ...makeTab(windowId, profileId, v.u, { title: v.ti, pinned: !group, customTitle: v.t, customIcon: v.i }),
          id,
          pinnedUrl: group ? null : v.u,
          navigation: null,
          unloaded: true,
        };
        tabs[id] = tab;
        windows[windowId] = { ...w, tabIds: [...w.tabIds, id] };
      }
      const inGroup = new Set([...memberOrder.values()].flat().filter((id) => tabs[id]));
      for (const g of Object.values(groups)) {
        if (g.profileId !== profileId) continue;
        const wanted = g.pinned && memberOrder.has(g.id) ? memberOrder.get(g.id)!.filter((id) => tabs[id]) : g.tabIds.filter((id) => !inGroup.has(id));
        groups[g.id] = { ...g, tabIds: wanted };
      }
      for (const g of Object.values(groups)) if (g.profileId === profileId && !g.tabIds.length) delete groups[g.id];

      const sequence = [...tileOrder, ...groupOrder.flatMap((g) => memberOrder.get(g) ?? [])];
      const rank = new Map(sequence.map((id, i) => [id, i]));
      for (const w of Object.values(windows)) {
        if (w.incognito) continue;
        const ids = w.tabIds.filter((id) => tabs[id]);
        const slots = ids.map((id, i) => (rank.has(id) ? i : -1)).filter((i) => i >= 0);
        const sorted = slots.map((i) => ids[i]!).sort((a, z) => rank.get(a)! - rank.get(z)!);
        slots.forEach((slot, i) => (ids[slot] = sorted[i]!));
        const window = { ...w, tabIds: orderSections(pinnedFirst(ids, tabs), tabs, groups) };
        windows[w.id] = window;
        groups = syncGroupOrder(groups, window);
      }
      let { live, parkedPins } = s;
      const parkWindow = windows[PARK];
      if (parkWindow) {
        parkedPins = parkWindowPins(parkedPins, parkWindow, { tabs, groups, history: s.history });
        for (const id of parkWindow.tabIds) delete tabs[id];
        live = without(live, parkWindow.tabIds);
        groups = Object.fromEntries(Object.entries(groups).filter(([, g]) => g.windowId !== PARK));
        delete windows[PARK];
      }
      const { find, splits, selection, windowOrder, windowUi } = s;
      useBrowser.setState({ tabs, windows, groups, live, find, splits, selection, windowOrder, windowUi, parkedPins });
    },
  };
}

// MARK: Passwords

type PasswordValue = { o: string; u: string; p: string };
const PASSWORD_READ_INTERVAL = 30_000;

// Sync passwords through Chrome; disabling sync never deletes local passwords.
export function passwordsAdapter(
  profileId: string,
  forced: () => boolean,
  readLogins: (engineProfile: string) => Promise<SavedLogin[] | null | undefined> = async (p) => SyncNative?.readPasswords(p),
): Adapter {
  let lastRead = 0;
  let quietUntil = 0;
  let created = new Map<string, number>();
  const profile = () => engineProfile(profileId);
  const keyOf = (origin: string, username: string) => `pw:${origin}\n${username}`;
  const read = async () => {
    const logins = await readLogins(profile());
    if (!logins) return null;
    const out = new Map<string, PasswordValue & { c: number }>();
    for (const l of logins) {
      const origin = originOf(l);
      if (origin) out.set(keyOf(origin, l.username), { o: origin, u: l.username, p: l.password, c: l.created });
    }
    return out;
  };
  return {
    prefix: "pw:",
    extract: async () => {
      const now = Date.now();
      if (now < quietUntil || (now - lastRead < PASSWORD_READ_INTERVAL && !forced())) return null;
      const logins = await read();
      if (!logins) return null;
      lastRead = now;
      created = new Map([...logins].map(([k, v]) => [k, v.c]));
      return { values: new Map([...logins].map(([k, { o, u, p }]) => [k, { o, u, p } satisfies PasswordValue])) };
    },
    editedAt: (v) => created.get(keyOf((v as PasswordValue).o, (v as PasswordValue).u)) || undefined,
    apply: async (visible, changed, base) => {
      const local = await read();
      if (!local) return false;
      let ok = true;
      for (const key of changed) {
        const v = visible.get(key) as PasswordValue | undefined;
        const have = local.get(key);
        const known = base(key) as PasswordValue | undefined;
        if (have && known?.p !== have.p) continue;
        const [origin, username] = [key.slice(3, key.indexOf("\n")), key.slice(key.indexOf("\n") + 1)];
        if (v) {
          if (have?.p === v.p) continue;
          if (have) ok = (await deletePassword(profile(), origin, username)) && ok;
          ok = (await savePassword(profile(), v.o, v.u, v.p)) && ok;
        } else if (have) {
          ok = (await deletePassword(profile(), origin, username)) && ok;
        }
      }
      // Wait for Chrome to write password changes before reading them.
      let settled = false;
      for (let i = 0; i < 20 && !settled; i++) {
        const now = await read();
        settled = !!now && [...changed].every((k) => (visible.get(k) as PasswordValue | undefined)?.p === now.get(k)?.p);
        if (!settled) await new Promise((r) => setTimeout(r, 250));
      }
      if (!settled) quietUntil = Date.now() + 30_000;
      return ok;
    },
  };
}

function originOf(login: SavedLogin): string | null {
  const realm = login.origin.replace(/\/$/, "");
  return /^https?:\/\/[^/\s]+$/.test(realm) ? realm : null;
}
