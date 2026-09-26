import { deletePassword, savePassword } from "@netnyahoo/cef";
import { assignPositions, SyncNative, type Adapter, type Extraction, type SavedLogin } from "@netnyahoo/sync";
import { ensureRoots } from "../store/bookmarks";
import { useBrowser, type BrowserState } from "../store/browser";
import { orderSections, syncGroupOrder } from "../store/groups";
import { engineProfile, makeTab, pinnedFirst } from "../store/model";
import { removeTabs } from "../store/tabs";
import { DEFAULT_PROFILE_ID, type Settings } from "../store/settings";
import type { BookmarkNode, HistoryEntry, Profile, Tab, TabGroup } from "../store/types";

/**
 * What syncs, as records the sync core merges (packages/sync). Each adapter turns part of the
 * store into `key → value` and back. Values carry only what's worth syncing (no favicons, no
 * per-Mac state) and must read back exactly as they were applied, or the next cycle would
 * publish the difference again.
 */

const store = () => useBrowser.getState();

// MARK: App scope: settings, profiles, devices

/** The settings that follow the user (not this Mac's window sizes, battery or extensions). */
export const SYNCED_SETTINGS = [
  "warnBeforeQuitting",
  "warnBeforeClosingWindow",
  "searchEngine",
  "customSearchUrl",
  "customSearchEngines",
  "searchSuggestions",
  "commandBarPreference",
  "tabLayout",
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

/** `set:<name>`: `{ v: value }` (a setting can be null, and a null record is a deletion). */
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

/** `prof:<sync id>`: a synced profile's name, colour and icon. Deleting a profile on one Mac doesn't delete it on others. */
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

/** `dev:<device id>`: this Mac's name, for the devices list and Synced devices' tabs. */
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

/** `bm:<node id>`: a profile's bookmark tree; parents by id ("bar" and "other" for the roots), order by position. */
export function bookmarksAdapter(profileId: string): Adapter {
  return {
    prefix: "bm:",
    extract: (base) => {
      const b = store().bookmarks;
      const roots = b.roots[profileId];
      const values = new Map<string, unknown>();
      if (!roots) return { values };
      const keyOf = (id: string) => (id === roots.bar ? "bar" : id === roots.other ? "other" : id);
      const walk = (folderId: string, depth: number) => {
        const folder = b.nodes[folderId];
        if (folder?.kind !== "folder" || depth > 64) return;
        const parent = keyOf(folderId);
        const children = folder.children.filter((id) => b.nodes[id]);
        const positions = assignPositions(
          children.map((id) => {
            const known = base(`bm:${id}`) as BookmarkValue | undefined;
            return known?.p === parent ? known.pos : undefined;
          }),
        );
        children.forEach((id, i) => {
          const node = b.nodes[id]!;
          values.set(`bm:${id}`, {
            k: node.kind === "url" ? "u" : "f",
            p: parent,
            t: node.title,
            ...(node.kind === "url" ? { u: node.url } : {}),
            a: node.addedAt,
            pos: positions[i]!,
          } satisfies BookmarkValue);
          if (node.kind === "folder") walk(id, depth + 1);
        });
      };
      walk(roots.bar, 0);
      walk(roots.other, 0);
      return { values };
    },
    apply: (visible) => {
      const s = store();
      const [b, roots] = ensureRoots(s.bookmarks, profileId);
      const values = new Map([...visible].map(([k, v]) => [k.slice(3), v as BookmarkValue]));
      const rootOf = (key: string) => (key === "bar" ? roots.bar : key === "other" ? roots.other : null);
      // Where each node goes: its parent if that's a synced folder, else Other Bookmarks (its
      // folder was deleted elsewhere). A cycle (two Macs moved folders into each other) is
      // broken at the node that closes it, the same way on every Mac.
      const parentOf = new Map<string, string>();
      for (const [id, v] of values) {
        const root = rootOf(v.p);
        parentOf.set(id, root ?? (values.get(v.p)?.k === "f" ? v.p : roots.other));
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
        return pa < pz ? -1 : pa > pz ? 1 : a < z ? -1 : 1;
      };
      // Everything under this profile's roots is replaced; other profiles' trees stay.
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
        nodes[id] =
          v.k === "u"
            ? { kind: "url", id, parentId: parentOf.get(id)!, title: v.t, url: v.u ?? "", favicon: old?.kind === "url" ? old.favicon : null, addedAt: v.a }
            : { kind: "folder", id, parentId: parentOf.get(id)!, title: v.t, children: [], addedAt: v.a };
      }
      for (const [parent, ids] of children) {
        const folder = nodes[parent];
        if (folder?.kind === "folder") nodes[parent] = { ...folder, children: ids.sort(byPosition) };
      }
      useBrowser.setState({ bookmarks: { ...b, nodes } });
    },
  };
}

/** History syncs for this long; older pages stay on the Mac that has them. */
export const HISTORY_WINDOW_MS = 90 * 86_400_000;
const MAX_HISTORY = 5000;

type HistoryValue = { t: string; n: number; vt: number[] };
const lastVisitOf = (v: HistoryValue) => Math.max(0, ...v.vt);

export const historyExpired = (key: string, value: unknown, now: number) =>
  key.startsWith("h:") && lastVisitOf(value as HistoryValue) < now - HISTORY_WINDOW_MS;

/** `h:<url>`: a page's title, visit count and recent visit times, for the last 90 days. */
export function historyAdapter(profileId: string): Adapter {
  return {
    prefix: "h:",
    extract: () => {
      const since = Date.now() - HISTORY_WINDOW_MS;
      const values = new Map<string, unknown>();
      const older = new Set<string>();
      for (const e of store().history[profileId] ?? []) {
        if (e.lastVisit < since) older.add(`h:${e.url}`);
        else values.set(`h:${e.url}`, { t: e.title, n: e.visits, vt: e.visitTimes?.length ? e.visitTimes : [e.lastVisit] } satisfies HistoryValue);
      }
      return { values, ignore: (key) => older.has(key) };
    },
    editedAt: (v) => lastVisitOf(v as HistoryValue),
    apply: (visible, changed) => {
      const since = Date.now() - HISTORY_WINDOW_MS;
      const byUrl = new Map((store().history[profileId] ?? []).map((e) => [e.url, e]));
      for (const key of changed) {
        const url = key.slice(2);
        const v = visible.get(key) as HistoryValue | undefined;
        const old = byUrl.get(url);
        if (v) {
          byUrl.set(url, { url, title: v.t || old?.title || "", favicon: old?.favicon ?? null, visits: v.n, lastVisit: lastVisitOf(v), visitTimes: v.vt });
        } else if (old && old.lastVisit >= since) {
          byUrl.delete(url);
        }
      }
      const list: HistoryEntry[] = [...byUrl.values()].sort((a, z) => z.lastVisit - a.lastVisit).slice(0, MAX_HISTORY);
      useBrowser.setState((s) => ({ history: { ...s.history, [profileId]: list } }));
    },
  };
}

export type DeviceTabs = { n: string; tabs: { u: string; t: string }[] };
const MAX_DEVICE_TABS = 30;

/** `tabs:<device id>`: this Mac's open tabs in the profile (Synced devices' tabs on the others). */
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

// Pinned tabs and pinned groups (Dia's pinned container): `pin:t:<tab id>` and `pin:g:<group id>`.
type PinValue = { g: string | null; u: string; t: string | null; i: string | null; ti: string; pos: string };
type PinGroupValue = { n: string; i: string | null; c: TabGroup["color"]; pos: string };

type Window = BrowserState["windows"][string];

/** Windows in the order they were opened (a stable order to read pinned tabs in). */
const openWindows = (s: BrowserState) => s.windowOrder.map((id) => s.windows[id]).filter((w): w is Window => !!w && !w.incognito);

/** Where synced pinned tabs are added: the last used window showing the profile, else the last used window. */
function homeWindow(s: BrowserState, profileId: string): Window | undefined {
  const order = [...s.ui.focusOrder, ...s.windowOrder].map((id) => s.windows[id]).filter((w): w is Window => !!w && !w.incognito);
  return order.find((w) => w.profileId === profileId) ?? order[0];
}

export function pinnedAdapter(profileId: string): Adapter {
  return {
    prefix: "pin:",
    extract: (base) => {
      const s = store();
      const tiles: Tab[] = [];
      const groups: TabGroup[] = [];
      const members = new Map<string, Tab[]>();
      const pinnedGroupOf = new Map<string, TabGroup>();
      for (const g of Object.values(s.groups)) if (g.pinned && g.profileId === profileId) g.tabIds.forEach((id) => pinnedGroupOf.set(id, g));
      for (const w of openWindows(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (!t || t.profileId !== profileId) continue;
          const g = pinnedGroupOf.get(id);
          if (t.pinned) tiles.push(t);
          else if (g) {
            if (!members.has(g.id)) {
              members.set(g.id, []);
              groups.push(g);
            }
            members.get(g.id)!.push(t);
          }
        }
      }
      const values = new Map<string, unknown>();
      const place = (tabs: Tab[], group: string | null) => {
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
      const pins = new Map<string, PinValue>();
      const groupValues = new Map<string, PinGroupValue>();
      for (const [k, v] of visible) {
        if (k.startsWith("pin:t:")) pins.set(k.slice(6), v as PinValue);
        else if (k.startsWith("pin:g:")) groupValues.set(k.slice(6), v as PinGroupValue);
      }
      const byPos = <T extends { pos: string }>(m: Map<string, T>) => (a: string, z: string) =>
        m.get(a)!.pos < m.get(z)!.pos ? -1 : m.get(a)!.pos > m.get(z)!.pos ? 1 : a < z ? -1 : 1;
      const groupOrder = [...groupValues.keys()].sort(byPos(groupValues));
      const tileOrder = [...pins.keys()].filter((id) => { const g = pins.get(id)!.g; return !g || !groupValues.has(g); }).sort(byPos(pins));
      const memberOrder = new Map(groupOrder.map((g) => [g, [...pins.keys()].filter((id) => pins.get(id)!.g === g).sort(byPos(pins))]));

      // Deleted elsewhere: tabs go (unpinned instead if one is all its window has left), groups dissolve.
      const goneTabs = [...changed].filter((k) => k.startsWith("pin:t:") && !visible.has(k)).map((k) => k.slice(6)).filter((id) => s.tabs[id]);
      const removable = goneTabs.filter((id) => {
        const w = s.windows[s.tabs[id]!.windowId];
        return w && w.tabIds.some((other) => other !== id && !goneTabs.includes(other));
      });
      s = removeTabs(s, removable, false);
      const tabs = { ...s.tabs };
      for (const id of goneTabs) if (tabs[id]) tabs[id] = { ...tabs[id]!, pinned: false, pinnedUrl: null };
      let groups = { ...s.groups };
      for (const k of changed) if (k.startsWith("pin:g:") && !visible.has(k)) delete groups[k.slice(6)];
      const windows = { ...s.windows };

      // Groups: update or create (in the window that shows this profile).
      for (const id of groupOrder) {
        const v = groupValues.get(id)!;
        const old = groups[id];
        groups[id] = old
          ? { ...old, name: v.n, icon: v.i, color: v.c, pinned: true }
          : { id, windowId: home.id, profileId, name: v.n, icon: v.i, color: v.c, collapsed: false, pinned: true, tabIds: [], createdAt: Date.now() };
      }
      // Tabs: update in place, or add as unloaded tiles (they load when selected).
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
      // Group membership as synced (a tab is in one group at most).
      const inGroup = new Set([...memberOrder.values()].flat().filter((id) => tabs[id]));
      for (const g of Object.values(groups)) {
        if (g.profileId !== profileId) continue;
        const wanted = g.pinned && memberOrder.has(g.id) ? memberOrder.get(g.id)!.filter((id) => tabs[id]) : g.tabIds.filter((id) => !inGroup.has(id));
        groups[g.id] = { ...g, tabIds: wanted };
      }
      for (const g of Object.values(groups)) if (g.profileId === profileId && !g.tabIds.length) delete groups[g.id];

      // Order: the profile's tiles, then its pinned groups, in synced order, in the slots
      // they already hold in each window (other profiles' tabs don't move).
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
      const { live, find, splits, selection, windowOrder, windowUi } = s;
      useBrowser.setState({ tabs, windows, groups, live, find, splits, selection, windowOrder, windowUi });
    },
  };
}

// MARK: Passwords

type PasswordValue = { o: string; u: string; p: string };
const PASSWORD_READ_INTERVAL = 30_000;

/**
 * `pw:<origin>\n<username>`: saved logins. Read from Chrome's store on disk (no Touch ID each
 * time), written through Chrome's password manager. Removing sync never removes a password;
 * only a password deleted on another Mac is deleted here.
 */
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
        // Changed here too, and not read yet (reads are spaced out): this Mac's edit publishes next.
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
      // Chrome writes its store on disk a moment after a save: wait for it to show the changes,
      // so the next read isn't taken for edits (a stale copy would undo them).
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

/** Chrome's signon realm as our password API names logins ("https://example.com"); null for other kinds. */
function originOf(login: SavedLogin): string | null {
  const realm = login.origin.replace(/\/$/, "");
  return /^https?:\/\/[^/\s]+$/.test(realm) ? realm : null;
}
