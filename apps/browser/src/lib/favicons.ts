import { fetchFavicon, pruneFavicons, type FaviconImage } from "@netnyahoo/cef";
import { readDocument, writeDocument } from "@netnyahoo/shell";
import { useEffect } from "react";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../store/browser";
import { engineProfile, isIncognitoProfile } from "../store/model";
import { DEFAULT_PROFILE_ID } from "../store/settings";
import { webviews } from "./webviews";

/**
 * Favicons for the app's own UI, cached per profile and keyed by page URL and
 * host (Dia's favicon store). Icons only ever come through the engine: a tab's
 * icon is downloaded by its own browser in its own request context, and a page
 * without a live tab (history, bookmarks after a relaunch) goes through its
 * profile's context. Nothing is fetched from the UI process or a third-party
 * service.
 *
 * Persistent profiles keep PNGs in the engine profile's directory and an index
 * in `favicons-<profile>.json`. Incognito profiles live in memory only (data:
 * URIs) and are forgotten with their window; they're never consulted for
 * lookups that don't name them.
 */

type Icon = { uri: string; /** The page's icon URL it came from. */ src: string; /** ms epoch */ at: number };
type ProfileIcons = {
  /** By name (a hash of `src`). */
  icons: Record<string, Icon>;
  /** Page key → icon name; most recent last. */
  pages: Record<string, string>;
  /** Host → icon name of its most recently seen page ("fallback to host"). */
  hosts: Record<string, string>;
};

const EMPTY: ProfileIcons = { icons: {}, pages: {}, hosts: {} };
/** Icons older than this are downloaded again when their page shows them. */
const REFRESH_MS = 7 * 86_400_000;
const MAX_PAGES = 5000;
const SAVE_DELAY_MS = 1000;

export const useFavicons = create<{ profiles: Record<string, ProfileIcons> }>(() => ({ profiles: {} }));

const docName = (profileId: string) => `favicons-${profileId}.json`;

/** The profile's index, read from disk the first time it's needed. */
function indexFor(profileId: string): ProfileIcons {
  const loaded = useFavicons.getState().profiles[profileId];
  if (loaded) return loaded;
  // Incognito profiles only get an entry once they have an icon (and lose it with their window).
  if (isIncognitoProfile(profileId)) return EMPTY;
  let index = EMPTY;
  try {
    const json = readDocument(docName(profileId));
    const saved = json ? (JSON.parse(json) as Partial<ProfileIcons>) : null;
    if (saved?.icons) index = { icons: saved.icons, pages: saved.pages ?? {}, hosts: saved.hosts ?? {} };
  } catch (error) {
    console.warn(`Couldn't read ${docName(profileId)}`, error);
  }
  // Reading happens during render (selectors): store it without notifying.
  useFavicons.getState().profiles[profileId] = index;
  return index;
}

const dirty = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function update(profileId: string, change: (index: ProfileIcons) => ProfileIcons) {
  const next = change(indexFor(profileId));
  useFavicons.setState((s) => ({ profiles: { ...s.profiles, [profileId]: next } }));
  if (isIncognitoProfile(profileId)) return;
  dirty.add(profileId);
  saveTimer ??= setTimeout(flushFavicons, SAVE_DELAY_MS);
}

/** Writes pending index changes now. */
export function flushFavicons() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  for (const profileId of dirty) {
    const index = useFavicons.getState().profiles[profileId];
    if (index && !isIncognitoProfile(profileId)) writeDocument(docName(profileId), JSON.stringify(index));
  }
  dirty.clear();
}

// MARK: Keys

/** Same page for icons: the fragment doesn't matter. */
export const pageKey = (url: string) => url.replace(/#.*$/, "");
const hostKey = (url: string) => /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url)?.[1]?.toLowerCase().replace(/^www\./, "") ?? "";

const names = new Map<string, string>();
/** File name for an icon URL: 64 bits of FNV-1a, which is plenty for one profile's icons. */
export function iconName(src: string): string {
  let name = names.get(src);
  if (name) return name;
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ src.length;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  name = `i${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
  if (names.size > 5000) names.clear();
  names.set(src, name);
  return name;
}

// MARK: Recording

function remember(profileId: string, pageUrl: string, name: string, icon?: Icon) {
  const page = pageKey(pageUrl);
  const host = hostKey(pageUrl);
  update(profileId, (index) => {
    const pages = { ...index.pages };
    // Re-inserting keeps the most recent pages last, so the oldest go first.
    delete pages[page];
    pages[page] = name;
    const keys = Object.keys(pages);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) delete pages[old];
    return {
      icons: icon ? { ...index.icons, [name]: icon } : index.icons,
      pages,
      hosts: host ? { ...index.hosts, [host]: name } : index.hosts,
    };
  });
}

const inflight = new Map<string, Promise<FaviconImage | null>>();

/**
 * A tab reported its page's icon (`onFavicon`): remember it for the page and its
 * host, downloading it through the tab's own browser when it's new or stale.
 */
export function noteFavicon(tabId: string, src: string) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!tab?.url || !src) return;
  const { profileId, url } = tab;
  const name = iconName(src);
  const known = indexFor(profileId).icons[name];
  if (known && Date.now() - known.at < REFRESH_MS) return remember(profileId, url, name);
  const handle = webviews.get(tabId);
  if (!handle) return;
  const key = `${profileId}|${name}`;
  let pending = inflight.get(key);
  if (!pending) {
    // Incognito icons come back as data: URIs and never touch the disk.
    pending = handle.downloadFavicon(src, isIncognitoProfile(profileId) ? undefined : name).catch(() => null);
    inflight.set(key, pending);
    void pending.finally(() => inflight.delete(key));
  }
  void pending.then((image) => {
    if (image) remember(profileId, url, name, { uri: image.uri, src, at: Date.now() });
    else if (known) remember(profileId, url, name);
  });
}

const failedFetches = new Set<string>();

/**
 * Fetches a known icon URL through its persistent profile's context, for pages
 * without a live tab (history, bookmarks, restored tabs). Never for incognito:
 * those icons only come from their own tabs.
 */
function fetchMissing(profileId: string, pageUrl: string, src: string) {
  if (isIncognitoProfile(profileId) || !/^https?:/i.test(src)) return;
  const name = iconName(src);
  const key = `${profileId}|${name}`;
  if (inflight.has(key) || failedFetches.has(key)) return;
  const pending = fetchFavicon(src, engineProfile(profileId), name).catch(() => null);
  inflight.set(key, pending);
  void pending.then((image) => {
    inflight.delete(key);
    if (image) remember(profileId, pageUrl, name, { uri: image.uri, src, at: Date.now() });
    else failedFetches.add(key);
  });
}

/** The cached icon file broke (deleted, data directory moved): forget it so it's fetched again. */
export function faviconFailed(profileId: string, uri: string) {
  const index = useFavicons.getState().profiles[profileId];
  const name = index && Object.keys(index.icons).find((n) => index.icons[n]!.uri === uri);
  if (!name) return;
  update(profileId, (i) => {
    const { [name]: _gone, ...icons } = i.icons;
    return { ...i, icons };
  });
}

// MARK: Lookup

export type ResolvedFavicon = { uri: string; profileId: string };

function lookupIn(profileId: string, url: string, src: string | null | undefined): Icon | undefined {
  const index = indexFor(profileId);
  const byPage = index.pages[pageKey(url)];
  return (
    (src ? index.icons[iconName(src)] : undefined) ??
    (byPage ? index.icons[byPage] : undefined) ??
    index.icons[index.hosts[hostKey(url)] ?? ""]
  );
}

/**
 * The icon to show for `url` (`src`: the page's icon URL, when known). With a
 * persistent profile, that profile's cache. With an incognito one, its memory,
 * then the persistent profiles' caches (reading them leaks nothing; the reverse
 * never happens). Without one, the persistent profiles', default first.
 */
export function resolveFavicon(url: string, src?: string | null, profileId?: string): ResolvedFavicon | null {
  if (!url) return null;
  const order =
    profileId && !isIncognitoProfile(profileId)
      ? [profileId]
      : [...new Set([...(profileId ? [profileId] : []), DEFAULT_PROFILE_ID, ...useBrowser.getState().profileOrder])];
  for (const id of order) {
    const icon = lookupIn(id, url, src);
    if (icon) return { uri: icon.uri, profileId: id };
  }
  return null;
}

/**
 * Hook form of `resolveFavicon`. A missing icon whose URL is known is fetched
 * through `profileId`'s context (persistent profiles only; without a profile
 * nothing is fetched, since the page's profile isn't known).
 */
export function useFavicon(url: string, src?: string | null, profileId?: string): ResolvedFavicon | null {
  // A string snapshot: zustand compares selections by identity.
  const key = useFavicons(() => {
    const found = resolveFavicon(url, src, profileId);
    return found ? `${found.profileId} ${found.uri}` : null;
  });
  const split = key?.indexOf(" ") ?? -1;
  const resolved = key ? { profileId: key.slice(0, split), uri: key.slice(split + 1) } : null;
  const missing = !resolved && !!url && !!src && !!profileId;
  useEffect(() => {
    if (missing) fetchMissing(profileId!, url, src!);
  }, [missing, profileId, url, src]);
  return resolved;
}

// MARK: Housekeeping

/**
 * Drops page icons that nothing refers to any more (after history is cleared:
 * Chrome forgets those favicons too, except for bookmarks and open tabs), then
 * deletes their files.
 */
export function pruneProfileFavicons(profileId: string) {
  if (isIncognitoProfile(profileId)) return;
  const s = useBrowser.getState();
  const keep = new Set<string>();
  for (const h of s.history[profileId] ?? []) keep.add(pageKey(h.url));
  for (const t of Object.values(s.tabs)) if (t.profileId === profileId && t.url) keep.add(pageKey(t.url));
  const roots = s.bookmarks.roots[profileId];
  if (roots) for (const n of Object.values(s.bookmarks.nodes)) if (n.kind === "url") keep.add(pageKey(n.url));
  update(profileId, (index) => {
    const pages = Object.fromEntries(Object.entries(index.pages).filter(([page]) => keep.has(page)));
    const liveHosts = new Set(Object.keys(pages).map(hostKey));
    const hosts = Object.fromEntries(Object.entries(index.hosts).filter(([host]) => liveHosts.has(host)));
    const used = new Set([...Object.values(pages), ...Object.values(hosts)]);
    const icons = Object.fromEntries(Object.entries(index.icons).filter(([name]) => used.has(name)));
    return { icons, pages, hosts };
  });
  flushFavicons();
  void pruneFavicons(engineProfile(profileId), Object.keys(indexFor(profileId).icons));
}

/**
 * Forgets closed incognito windows' icons and deleted profiles' indexes (their
 * files go with the profile's directory).
 */
export function startFavicons() {
  const check = (s: BrowserState, prev: BrowserState) => {
    if (s.windows !== prev.windows) {
      const open = new Set(Object.values(s.windows).map((w) => w.profileId));
      for (const t of Object.values(s.tabs)) open.add(t.profileId);
      const gone = Object.keys(useFavicons.getState().profiles).filter((id) => isIncognitoProfile(id) && !open.has(id));
      if (gone.length) {
        useFavicons.setState((f) => ({ profiles: Object.fromEntries(Object.entries(f.profiles).filter(([id]) => !gone.includes(id))) }));
      }
    }
    if (s.profiles !== prev.profiles) {
      for (const id of Object.keys(prev.profiles)) {
        if (s.profiles[id]) continue;
        dirty.delete(id);
        writeDocument(docName(id), "");
        useFavicons.setState((f) => ({ profiles: Object.fromEntries(Object.entries(f.profiles).filter(([p]) => p !== id)) }));
      }
    }
  };
  return useBrowser.subscribe(check);
}
