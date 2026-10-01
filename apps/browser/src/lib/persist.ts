import { cancelDownload, setZoom as setHostZoom, type Download } from "@netnyahoo/cef";
import { readDocument, writeDocument } from "@netnyahoo/shell";
import { EMPTY_BOOKMARKS, ensureRoots, newBookmarkId } from "../store/bookmarks";
import { useBrowser, type BrowserState, type HydrateData } from "../store/browser";
import { engineProfile, inPinnedContainer, isIncognitoProfile, makeTab, newId, snapshotTab } from "../store/model";
import { parkWindowPins } from "../store/parkedPins";
import { DEFAULT_PROFILE } from "../store/profiles";
import { DEFAULT_SETTINGS } from "../store/settings";
import type { Bookmarks, BrowserWindow, ClosedTab, HistoryEntry, Tab } from "../store/types";
import { startFavicons } from "./favicons";
import { startBookmarks } from "./bookmarks";
import { startHistory } from "./history";
import { startProfileDataCleanup } from "./profileData";

const SAVE_DELAY_MS = 800;
const VERSION = 2;

type Doc = { name: string; sources: (s: BrowserState) => unknown[]; json: (s: BrowserState) => string };

const serialized =
  (serialize: (s: BrowserState) => unknown) =>
  (s: BrowserState): string =>
    JSON.stringify(serialize(s));

const persistedTab = ({ navigation: _n, adoptId: _a, wakeAdoptId: _w, ...t }: Tab) => t;
const publicTab = (t: { profileId: string }) => !isIncognitoProfile(t.profileId);

const DOCS: Doc[] = [
  {
    name: "downloads.json",
    sources: (s) => [s.downloads],
    json: serialized((s) => ({
      version: VERSION,
      downloads: s.downloads
        .filter((d) => !d.profile || !isIncognitoProfile(d.profile))
        .map((d) => (d.state === "downloading" ? { ...d, state: "failed" } : d)),
    })),
  },
  {
    name: "session.json",
    sources: (s) => [s.profiles, s.profileOrder, s.orphanedProfileData, s.windows, s.windowOrder, s.tabs, s.groups, s.splits, s.closedTabs, s.closedWindows, s.parkedPins, s.settings, s.ui.focusedWindowId, s.closedGroups, s.deletedGroups, s.cleanedTabs],
    json: serialized((s) => {
      // Small Yahu windows aren't restored: closing (or quitting) throws their page away.
      const windows = Object.values(s.windows).filter((w) => !w.incognito && w.kind !== "small");
      const kept = new Set(windows.map((w) => w.id));
      return {
        version: VERSION,
        profiles: s.profiles,
        profileOrder: s.profileOrder,
        orphanedProfileData: s.orphanedProfileData,
        settings: s.settings,
        windows,
        windowOrder: s.windowOrder.filter((id) => kept.has(id)),
        focusedWindowId: s.ui.focusOrder.find((id) => kept.has(id)) ?? null,
        tabs: Object.values(s.tabs).filter((t) => kept.has(t.windowId)).map(persistedTab),
        groups: Object.values(s.groups).filter((g) => kept.has(g.windowId)),
        splits: Object.values(s.splits).filter((v) => kept.has(v.windowId)),
        // The store keeps private windows out of these lists; filter again so nothing private is ever written.
        closedTabs: s.closedTabs.filter((c) => publicTab(c.tab)),
        closedWindows: s.closedWindows.filter((c) => c.tabs.every(publicTab)),
        parkedPins: Object.fromEntries(Object.entries(s.parkedPins).filter(([profileId]) => publicTab({ profileId }))),
        closedGroups: s.closedGroups.filter((c) => c.tabs.every(publicTab)),
        deletedGroups: s.deletedGroups.filter((c) => c.tabs.every(publicTab)),
        cleanedTabs: s.cleanedTabs.filter((c) => publicTab(c.tab)),
      };
    }),
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
  orphanedProfileData?: string[];
  settings: HydrateData["settings"];
  windows: BrowserWindow[];
  windowOrder: string[];
  focusedWindowId: string | null;
  tabs: Tab[];
  groups: BrowserState["groups"][string][];
  splits: BrowserState["splits"][string][];
  closedTabs: ClosedTab[];
  closedWindows: BrowserState["closedWindows"];
  parkedPins?: BrowserState["parkedPins"];
  closedGroups?: BrowserState["closedGroups"];
  deletedGroups?: BrowserState["deletedGroups"];
  cleanedTabs?: BrowserState["cleanedTabs"];
};

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
  let [bookmarks, roots] = ensureRoots(EMPTY_BOOKMARKS, profileId);
  for (const b of v1.bookmarks) {
    const id = newBookmarkId();
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
    bookmarks,
  };
}

export function loadSession(): { data: HydrateData | null; migrated: boolean } {
  const session = read<SessionV2 | SessionV1>("session.json");
  if (session?.version === 1) {
    write("session.v1.backup.json", JSON.stringify(session));
    // Chrome keeps history and bookmarks now: lib/history.ts and lib/bookmarks.ts move these files into it.
    write("history.json", JSON.stringify({ version: VERSION, history: { [DEFAULT_PROFILE.id]: session.history } }));
    const { bookmarks, ...data } = migrateV1(session);
    write("bookmarks.json", JSON.stringify({ version: VERSION, bookmarks }));
    return { data, migrated: true };
  }
  if (session?.version !== 2) return { data: null, migrated: false };
  const downloads = read<{ downloads: Download[] }>("downloads.json");
  const data: HydrateData = {
    profiles: session.profiles,
    profileOrder: session.profileOrder,
    orphanedProfileData: session.orphanedProfileData ?? [],
    settings: session.settings,
    windows: byId(session.windows),
    windowOrder: session.windowOrder,
    focusedWindowId: session.focusedWindowId,
    tabs: byId(session.tabs),
    groups: byId(session.groups),
    splits: byId(session.splits),
    closedTabs: session.closedTabs,
    closedWindows: session.closedWindows,
    parkedPins: session.parkedPins ?? {},
    closedGroups: session.closedGroups ?? [],
    deletedGroups: session.deletedGroups ?? [],
    cleanedTabs: session.cleanedTabs ?? [],
    downloads: (downloads?.downloads ?? []).map((d, i) => ({ ...d, id: `saved-${i}` })),
  };
  if (session.settings && session.settings.restoreSession === false) {
    const now = Date.now();
    const pinSource = { tabs: data.tabs ?? {}, groups: data.groups ?? {}, history: {} };
    for (const w of session.windows) data.parkedPins = parkWindowPins(data.parkedPins ?? {}, w, pinSource);
    data.closedWindows = [
      ...(data.closedWindows ?? []),
      ...session.windows.map((w) => ({
        kind: "window" as const,
        id: newId("cw"),
        window: { profileId: w.profileId, sidebarOpen: w.sidebarOpen, frame: w.frame },
        tabs: w.tabIds
          .map((id) => data.tabs?.[id])
          .filter((t): t is Tab => !!t && !inPinnedContainer(pinSource, t.id))
          .map((t) => ({ ...snapshotTab(t), active: Object.values(w.activeTabIds).includes(t.id) })),
        groups: [],
        closedAt: now,
      })).filter((c) => c.tabs.some((t) => t.url)),
    ].slice(-10);
    data.windows = {};
    data.windowOrder = [];
    data.tabs = {};
  }
  return { data, migrated: false };
}

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

export function flushPersistence({ final = false } = {}) {
  flush();
  if (final) frozen = true;
}

export function startPersistence() {
  const { data, migrated } = loadSession();
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
      const json = doc.json(s);
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
  const stopHistory = startHistory();
  const stopBookmarks = startBookmarks();
  const stopProfileData = startProfileDataCleanup();
  const stopSession = useBrowser.subscribe((s, prev) => {
    check(s);
    if (s.windows !== prev.windows) forgetClosedIncognito(s, prev);
  });
  return () => {
    stopFavicons();
    stopHistory();
    stopBookmarks();
    stopProfileData();
    stopSession();
  };
}

function forgetClosedIncognito(s: BrowserState, prev: BrowserState) {
  for (const w of Object.values(prev.windows)) {
    if (!w.incognito || s.windows[w.id]) continue;
    for (const d of s.downloads) if (d.profile === w.profileId && d.state === "downloading") void cancelDownload(d.id);
    s.forgetDownloads(w.profileId);
  }
}
