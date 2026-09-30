import { fetchFavicon, pruneFavicons, type FaviconImage } from "@netnyahoo/cef";
import { hasDockSelection, iconTheme, readDocument, writeDocument, type IconTheme } from "@netnyahoo/shell";
import { useEffect } from "react";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../store/browser";
import { engineProfile, isIncognitoProfile } from "../store/model";
import { DEFAULT_PROFILE_ID } from "../store/settings";
import { webviews } from "./webviews";

type Icon = {
  uri: string;
  src: string;
  at: number;
  theme?: IconTheme | null;
};
type ProfileIcons = {
  icons: Record<string, Icon>;
  pages: Record<string, string>;
  hosts: Record<string, string>;
  appearances?: Record<string, [string, string]>;
};

const EMPTY: ProfileIcons = { icons: {}, pages: {}, hosts: {} };
const APPEARANCE_SWAP_MS = 5000;
let appearanceChangedAt = -Infinity;
const REFRESH_MS = 7 * 86_400_000;
const MAX_PAGES = 5000;
const SAVE_DELAY_MS = 1000;

export const useFavicons = create<{ profiles: Record<string, ProfileIcons> }>(() => ({ profiles: {} }));

const docName = (profileId: string) => `favicons-${profileId}.json`;

function indexFor(profileId: string): ProfileIcons {
  const loaded = useFavicons.getState().profiles[profileId];
  if (loaded) return loaded;
  if (isIncognitoProfile(profileId)) return EMPTY;
  let index = EMPTY;
  try {
    const json = readDocument(docName(profileId));
    const saved = json ? (JSON.parse(json) as Partial<ProfileIcons>) : null;
    if (saved?.icons) index = { icons: saved.icons, pages: saved.pages ?? {}, hosts: saved.hosts ?? {}, appearances: saved.appearances };
  } catch (error) {
    console.warn(`Couldn't read ${docName(profileId)}`, error);
  }
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

export const pageKey = (url: string) => url.replace(/#.*$/, "");
const hostKey = (url: string) => /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url)?.[1]?.toLowerCase().replace(/^www\./, "") ?? "";

const names = new Map<string, string>();
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

// Each pages map's newest page (its last key) and size, so a report changes the index without walking or
// copying its 5000 pages. Keyed by the map, so a closed private profile's index takes them with it.
const newestPage = new WeakMap<Record<string, string>, string>();
const pageCounts = new WeakMap<Record<string, string>, number>();

function remember(profileId: string, pageUrl: string, name: string, icon?: Icon) {
  const page = pageKey(pageUrl);
  const host = hostKey(pageUrl);
  const dark = useBrowser.getState().ui.appDark;
  const swapped = Date.now() - appearanceChangedAt < APPEARANCE_SWAP_MS;
  const known = indexFor(profileId);
  // Pages report their icon on every load: nothing to record when this page is already the newest with it.
  if (!icon && newestPage.get(known.pages) === page && known.pages[page] === name && (!host || known.hosts[host] === name)) return;
  update(profileId, (index) => {
    // The pages map is changed in place (copying it per report cost more than the rest of the report); the index
    // object is new, so subscribers still see the change. EMPTY's map is shared, so it's never written.
    const pages = index.pages === EMPTY.pages ? {} : index.pages;
    const previous = pages[page];
    let count = pageCounts.get(pages) ?? Object.keys(pages).length;
    if (previous === undefined) count++;
    delete pages[page];
    pages[page] = name;
    for (const old in pages) {
      if (count <= MAX_PAGES) break;
      delete pages[old];
      count--;
    }
    pageCounts.set(pages, count);
    newestPage.set(pages, page);
    let appearances = index.appearances;
    if (swapped && previous && previous !== name) {
      const pair: [string, string] = dark ? [previous, name] : [name, previous];
      appearances = { ...appearances, [previous]: pair, [name]: pair };
    }
    return {
      icons: icon ? { ...index.icons, [name]: icon } : index.icons,
      pages,
      hosts: host && index.hosts[host] !== name ? { ...index.hosts, [host]: name } : index.hosts,
      appearances,
    };
  });
}

const inflight = new Map<string, Promise<FaviconImage | null>>();

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

function lookupIn(profileId: string, url: string, src: string | null | undefined): string | undefined {
  const index = indexFor(profileId);
  const byPage = index.pages[pageKey(url)];
  const name = src ? iconName(src) : undefined;
  if (name && index.icons[name]) return inScheme(index, name);
  if (byPage && index.icons[byPage]) return inScheme(index, byPage);
  const byHost = index.hosts[hostKey(url)];
  return byHost && index.icons[byHost] ? inScheme(index, byHost) : undefined;
}

function inScheme(index: ProfileIcons, name: string): string {
  const pair = index.appearances?.[name];
  const shown = pair?.[useBrowser.getState().ui.appDark ? 1 : 0];
  return shown && index.icons[shown] ? shown : name;
}

function resolveIcon(url: string, src?: string | null, profileId?: string): { profileId: string; name: string; icon: Icon } | null {
  if (!url) return null;
  const order =
    profileId && !isIncognitoProfile(profileId)
      ? [profileId]
      : [...new Set([...(profileId ? [profileId] : []), DEFAULT_PROFILE_ID, ...useBrowser.getState().profileOrder])];
  for (const id of order) {
    const name = lookupIn(id, url, src);
    if (name) return { profileId: id, name, icon: indexFor(id).icons[name]! };
  }
  return null;
}

export function resolveFavicon(url: string, src?: string | null, profileId?: string): ResolvedFavicon | null {
  const found = resolveIcon(url, src, profileId);
  return found ? { uri: found.icon.uri, profileId: found.profileId } : null;
}

// Callers re-render on an appearance change themselves (useAppearanceDark): the lookup reads it for
// icons that have a light and a dark version.
export const useAppearanceDark = () => useBrowser((s) => s.ui.appDark);

export function useFavicon(url: string, src?: string | null, profileId?: string): ResolvedFavicon | null {
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

// MARK: Themes

const theming = new Set<string>();

export function useFaviconTheme(url: string, src?: string | null, profileId?: string): IconTheme | null | undefined {
  const icon = useFavicons(() => resolveIcon(url, src, profileId)?.icon ?? null);
  const pending = !!icon && icon.theme === undefined && hasDockSelection;
  useEffect(() => {
    if (!pending) return;
    const found = resolveIcon(url, src, profileId);
    if (!found) return;
    const { profileId: id, name, icon: current } = found;
    const key = `${id}|${name}|${current.uri}`;
    if (theming.has(key)) return;
    theming.add(key);
    void iconTheme({ uri: current.uri })
      .catch(() => null)
      .then((theme) =>
        update(id, (index) => {
          const now = index.icons[name];
          if (!now || now.uri !== current.uri) return index;
          return { ...index, icons: { ...index.icons, [name]: { ...now, theme } } };
        }),
      );
  }, [pending, url, src, profileId]);
  return icon?.theme;
}

// MARK: Housekeeping

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
    for (const name of [...used]) for (const other of index.appearances?.[name] ?? []) used.add(other);
    const icons = Object.fromEntries(Object.entries(index.icons).filter(([name]) => used.has(name)));
    const appearances = Object.fromEntries(Object.entries(index.appearances ?? {}).filter(([name]) => icons[name]));
    return { icons, pages, hosts, appearances };
  });
  flushFavicons();
  void pruneFavicons(engineProfile(profileId), Object.keys(indexFor(profileId).icons));
}

export function startFavicons() {
  const check = (s: BrowserState, prev: BrowserState) => {
    if (s.ui.appDark !== prev.ui.appDark) appearanceChangedAt = Date.now();
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
