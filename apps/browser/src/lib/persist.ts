import { cancelDownload, setZoom as setHostZoom, type Download } from "@netnyahoo/cef";
import { readDocument, writeDocument } from "@netnyahoo/shell";
import { EMPTY_BOOKMARKS, ensureRoots } from "../store/bookmarks";
import { useBrowser, type BrowserState, type HydrateData } from "../store/browser";
import { engineProfile, isIncognitoProfile, makeTab, newId, snapshotTab } from "../store/model";
import { DEFAULT_PROFILE } from "../store/profiles";
import { DEFAULT_SETTINGS } from "../store/settings";
import type { Bookmarks, BrowserWindow, ClosedTab, HistoryEntry, Tab } from "../store/types";
import { flushFavicons, startFavicons } from "./favicons";

/**
 * Session persistence, v2. State is split across documents so a title change
 * doesn't rewrite 5 000 history entries: each document is saved (debounced) only
 * when the slices it covers change. Incognito windows and tabs never persist.
 */
const SAVE_DELAY_MS = 800;
const VERSION = 2;

type Doc = { name: string; sources: (s: BrowserState) => unknown[]; serialize: (s: BrowserState) => unknown };

const persistedTab = ({ navigation: _n, adoptId: _a, ...t }: Tab) => t;

const DOCS: Doc[] = [
  { name: "history.json", sources: (s) => [s.history], serialize: (s) => ({ version: VERSION, history: s.history }) },
  { name: "bookmarks.json", sources: (s) => [s.bookmarks], serialize: (s) => ({ version: VERSION, bookmarks: s.bookmarks }) },
  {
    name: "downloads.json",
    sources: (s) => [s.downloads],
    // In-progress downloads can't resume after a relaunch; incognito ones are never written.
    serialize: (s) => ({
      version: VERSION,
      downloads: s.downloads
        .filter((d) => !d.profile || !isIncognitoProfile(d.profile))
        .map((d) => (d.state === "downloading" ? { ...d, state: "failed" } : d)),
    }),
  },
  // Last: after a v1 migration, history and bookmarks must be on disk before the v1 file is replaced.
  {
    name: "session.json",
    sources: (s) => [s.profiles, s.profileOrder, s.windows, s.windowOrder, s.tabs, s.groups, s.splits, s.closedTabs, s.closedWindows, s.settings, s.ui.focusedWindowId, s.closedGroups, s.deletedGroups, s.cleanedTabs],
    serialize: (s) => {
      const windows = Object.values(s.windows).filter((w) => !w.incognito);
      const kept = new Set(windows.map((w) => w.id));
      return {
        version: VERSION,
        profiles: s.profiles,
        profileOrder: s.profileOrder,
        settings: s.settings,
        windows,
        windowOrder: s.windowOrder.filter((id) => kept.has(id)),
        focusedWindowId: s.ui.focusOrder.find((id) => kept.has(id)) ?? null,
        tabs: Object.values(s.tabs).filter((t) => kept.has(t.windowId)).map(persistedTab),
        groups: Object.values(s.groups).filter((g) => kept.has(g.windowId)),
        splits: Object.values(s.splits).filter((v) => kept.has(v.windowId)),
        closedTabs: s.closedTabs.filter((c) => !isIncognitoProfile(c.tab.profileId)),
        closedWindows: s.closedWindows,
        closedGroups: s.closedGroups,
        deletedGroups: s.deletedGroups,
        cleanedTabs: s.cleanedTabs,
      };
    },
  },
];

function read<T>(name: string): T | null {
  try {
    const json = readDocument(name);
    return json ? (JSON.parse(json) as T) : null;
  } catch (error) {
    console.warn(`Couldn't read ${name}`, error);
    return null;
  }
}

function write(name: string, json: string) {
  try {
    writeDocument(name, json);
  } catch (error) {
    console.warn(`Couldn't save ${name}`, error);
  }
}

const byId = <T extends { id: string }>(list: T[] | undefined) => Object.fromEntries((list ?? []).map((x) => [x.id, x]));

type SessionV2 = {
  version: 2;
  profiles: HydrateData["profiles"];
  profileOrder: string[];
  settings: HydrateData["settings"];
  windows: BrowserWindow[];
  windowOrder: string[];
  focusedWindowId: string | null;
  tabs: Tab[];
  groups: BrowserState["groups"][string][];
  splits: BrowserState["splits"][string][];
  closedTabs: ClosedTab[];
  closedWindows: BrowserState["closedWindows"];
  closedGroups?: BrowserState["closedGroups"];
  deletedGroups?: BrowserState["deletedGroups"];
  cleanedTabs?: BrowserState["cleanedTabs"];
};

/** v1 (single window, flat bookmarks) → v2 documents. */
type SessionV1 = {
  version: 1;
  tabs: Pick<Tab, "url" | "title" | "favicon" | "pinned" | "muted" | "zoom">[];
  activeIndex: number;
  closedUrls: string[];
  history: HistoryEntry[];
  bookmarks: { url: string; title: string; favicon: string | null }[];
  sidebarOpen: boolean;
  showFullUrl: boolean;
};

export function migrateV1(v1: SessionV1): HydrateData {
  const profileId = DEFAULT_PROFILE.id;
  const windowId = newId("w");
  const tabs = v1.tabs.map((t) => ({ ...makeTab(windowId, profileId, "", t), url: t.url, navigation: null }));
  const active = tabs[Math.min(Math.max(v1.activeIndex, 0), tabs.length - 1)];
  const window: BrowserWindow = {
    id: windowId,
    profileId,
    incognito: false,
    tabIds: tabs.map((t) => t.id),
    activeTabIds: active ? { [profileId]: active.id } : {},
    sidebarOpen: v1.sidebarOpen,
    // The native side falls back to the frame the v1 window autosaved.
    frame: null,
    createdAt: Date.now(),
  };
  const now = Date.now();
  const closedTabs: ClosedTab[] = v1.closedUrls.map((url, i) => ({
    kind: "tab",
    id: newId("ct"),
    tab: { url, title: "", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, profileId },
    windowId,
    index: tabs.length,
    group: null,
    closedAt: now - (v1.closedUrls.length - i),
  }));
  // Flat bookmarks land on the Bookmarks Bar, oldest first.
  let [bookmarks, roots] = ensureRoots(EMPTY_BOOKMARKS, profileId);
  for (const b of v1.bookmarks) {
    const id = newId("bm");
    const bar = bookmarks.nodes[roots.bar]!;
    if (bar.kind !== "folder") break;
    bookmarks = {
      ...bookmarks,
      nodes: {
        ...bookmarks.nodes,
        [id]: { kind: "url", id, parentId: roots.bar, title: b.title, url: b.url, favicon: b.favicon, addedAt: now },
        [roots.bar]: { ...bar, children: [...bar.children, id] },
      },
    };
  }
  return {
    profiles: { [profileId]: DEFAULT_PROFILE },
    profileOrder: [profileId],
    settings: { ...DEFAULT_SETTINGS, showFullUrl: v1.showFullUrl },
    windows: tabs.length ? { [windowId]: window } : {},
    windowOrder: tabs.length ? [windowId] : [],
    focusedWindowId: tabs.length ? windowId : null,
    tabs: byId(tabs),
    closedTabs,
    history: { [profileId]: v1.history },
    bookmarks,
  };
}

/** Reads the saved documents (migrating a v1 session) into hydrate data; null data on a first launch. */
export function loadSession(): { data: HydrateData | null; migrated: boolean } {
  const session = read<SessionV2 | SessionV1>("session.json");
  if (session?.version === 1) {
    // Keep the original around in case the migration ever needs redoing.
    write("session.v1.backup.json", JSON.stringify(session));
    return { data: migrateV1(session), migrated: true };
  }
  if (session?.version !== 2) return { data: null, migrated: false };
  const history = read<{ history: Record<string, HistoryEntry[]> }>("history.json");
  const bookmarks = read<{ bookmarks: Bookmarks }>("bookmarks.json");
  const downloads = read<{ downloads: Download[] }>("downloads.json");
  const data: HydrateData = {
    profiles: session.profiles,
    profileOrder: session.profileOrder,
    settings: session.settings,
    windows: byId(session.windows),
    windowOrder: session.windowOrder,
    focusedWindowId: session.focusedWindowId,
    tabs: byId(session.tabs),
    groups: byId(session.groups),
    splits: byId(session.splits),
    closedTabs: session.closedTabs,
    closedWindows: session.closedWindows,
    closedGroups: session.closedGroups ?? [],
    deletedGroups: session.deletedGroups ?? [],
    cleanedTabs: session.cleanedTabs ?? [],
    history: history?.history ?? {},
    bookmarks: bookmarks?.bookmarks ?? EMPTY_BOOKMARKS,
    // The engine numbers downloads from 1 on every launch: saved ones get ids of their own.
    downloads: (downloads?.downloads ?? []).map((d, i) => ({ ...d, id: `saved-${i}` })),
  };
  // "Start fresh" on launch: the last windows go to Reopen Closed Window instead.
  if (session.settings && session.settings.restoreSession === false) {
    const now = Date.now();
    data.closedWindows = [
      ...(data.closedWindows ?? []),
      ...session.windows.map((w) => ({
        kind: "window" as const,
        id: newId("cw"),
        window: { profileId: w.profileId, sidebarOpen: w.sidebarOpen, frame: w.frame },
        tabs: w.tabIds
          .map((id) => data.tabs?.[id])
          .filter((t): t is Tab => !!t)
          .map((t) => ({ ...snapshotTab(t), active: Object.values(w.activeTabIds).includes(t.id) })),
        groups: [],
        closedAt: now,
      })),
    ].slice(-10);
    data.windows = {};
    data.windowOrder = [];
    data.tabs = {};
  }
  return { data, migrated: false };
}

/**
 * v1 kept zoom per tab; the engine now keeps it per host (like Chrome/Dia) and
 * restores it itself. Hand the migrated tabs' zoom levels over once.
 */
function seedHostZoom() {
  for (const t of Object.values(useBrowser.getState().tabs)) {
    if (t.zoom === 1 || !t.url) continue;
    try {
      void setHostZoom(engineProfile(t.profileId), new URL(t.url).hostname, t.zoom);
    } catch {}
  }
}

let flush: () => void = () => {};
let frozen = false;

/** Writes pending changes now. `final` (quitting): nothing after this is saved. */
export function flushPersistence({ final = false } = {}) {
  flush();
  flushFavicons();
  if (final) frozen = true;
}

/** Restores the last session, then saves each document (debounced) when its slices change. */
export function startPersistence() {
  const { data, migrated } = loadSession();
  // Hydrating even without data sets up the default profile's bookmark roots.
  useBrowser.getState().hydrate(data ?? {});
  if (migrated) seedHostZoom();

  const lastSources = new Map<string, unknown[]>();
  const lastJson = new Map<string, string>();
  const dirty = new Set<Doc>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    if (frozen) return;
    const s = useBrowser.getState();
    for (const doc of DOCS.filter((d) => dirty.has(d))) {
      const json = JSON.stringify(doc.serialize(s));
      if (lastJson.get(doc.name) !== json) {
        lastJson.set(doc.name, json);
        write(doc.name, json);
      }
    }
    dirty.clear();
  };
  flush = save;

  const check = (s: BrowserState, initial = false) => {
    if (frozen) return;
    for (const doc of DOCS) {
      const sources = doc.sources(s);
      const prev = lastSources.get(doc.name);
      if (prev && sources.every((v, i) => v === prev[i])) continue;
      lastSources.set(doc.name, sources);
      if (!initial || migrated) dirty.add(doc);
    }
    if (dirty.size && !timer) timer = setTimeout(save, SAVE_DELAY_MS);
  };
  check(useBrowser.getState(), true);
  if (migrated) save();
  const stopFavicons = startFavicons();
  const stopSession = useBrowser.subscribe((s, prev) => {
    check(s);
    if (s.windows !== prev.windows) forgetClosedIncognito(s, prev);
  });
  return () => {
    stopFavicons();
    stopSession();
  };
}

/** An incognito window closed: its downloads leave the list (and stop, if they hadn't finished). */
function forgetClosedIncognito(s: BrowserState, prev: BrowserState) {
  for (const w of Object.values(prev.windows)) {
    if (!w.incognito || s.windows[w.id]) continue;
    for (const d of s.downloads) if (d.profile === w.profileId && d.state === "downloading") void cancelDownload(d.id);
    s.forgetDownloads(w.profileId);
  }
}
