import { faviconsFor, fetchFavicon, onHistoryChanged, removeLegacyFavicons } from "@arcadia/arcadiacore";
import { iconTheme, readDocument, removeDocument, type IconTheme } from "@arcadia/shell";
import { useEffect } from "react";
import { create } from "zustand";
import { batchStoreUpdates, useBrowser, type BrowserState } from "../store/browser";
import { engineProfile, isIncognitoProfile } from "../store/model";
import { DEFAULT_PROFILE_ID } from "../store/settings";
import { webviews } from "./webviews";

// Favicons are Chrome's (FaviconService): Chrome saves a page's icon when the page shows it and drops it with the
// page's history. This is the app's in-memory cache of them, by page, plus what Chrome doesn't keep:
// - the icons tabs show right now, private windows' included (those stay here and in their own profile);
// - the light/dark pick: a page whose icon changes with the appearance keeps both, for this launch.
// Nothing here is saved.

type Icons = {
  // By page (no fragment): Chrome's answer, `null` when it has none.
  pages: Record<string, string | null>;
  // By icon URL: what tabs reported or the app fetched.
  srcs: Record<string, string>;
  // A page's [light, dark] icons.
  appearances: Record<string, [string, string]>;
};

const EMPTY: Icons = { pages: {}, srcs: {}, appearances: {} };
const APPEARANCE_SWAP_MS = 5000;
const MAX_ICONS = 3000;
const LOOKUP_DELAY_MS = 16;
// Per engine call (ac_favicons_get answers up to 500).
const LOOKUP_BATCH = 200;
let appearanceChangedAt = -Infinity;

type Favicons = {
  // Keyed by cache key: the engine profile, or a private profile's own id.
  profiles: Record<string, Icons>;
  themes: Record<string, IconTheme | null>;
};

export const useFavicons = create<Favicons>(() => ({ profiles: {}, themes: {} }));

const cacheKey = (profileId: string) => (isIncognitoProfile(profileId) ? profileId : engineProfile(profileId));
export const pageKey = (url: string) => url.replace(/#.*$/, "");

// MARK: Writing

// Answers come in bursts (a launch asks Chrome about every tab's page, then checks each icon's shape), so changes
// wait for the next frame and land together, in order: one store update and one commit. A change that gives back
// what it got changes nothing, and no icon re-renders for it.
type Change = (f: Favicons) => Favicons;
const FLUSH_MS = 16;
const changes: Change[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function queue(change: Change, now = false) {
  changes.push(change);
  if (now) flush();
  else flushTimer ??= setTimeout(flush, FLUSH_MS);
}

function flush() {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  const all = changes.splice(0);
  if (all.length) batchStoreUpdates(() => useFavicons.setState((f) => all.reduce((s, change) => change(s), f)));
}

// `now` for what the user did (Clear Data, a closed private window) and for answers that come batched: applied after
// anything queued.
function update(key: string, change: (icons: Icons) => Icons, now = false) {
  queue((f) => {
    const before = f.profiles[key] ?? EMPTY;
    const after = change(before);
    return after === before ? f : { ...f, profiles: { ...f.profiles, [key]: after } };
  }, now);
}

// Bounded: past MAX_ICONS a map starts over (Chrome still has every icon; pages ask again).
const capped = <T,>(map: Record<string, T>, key: string, value: T): Record<string, T> =>
  Object.keys(map).length >= MAX_ICONS ? { [key]: value } : { ...map, [key]: value };

// The pages whose answer the queued changes may change, for the icons waiting on one (onFavicons); null: any page.
let watching = false;
let touched: Set<string> | null = new Set();
const touch = (page: string) => void (watching && touched?.add(page));
const touchAll = () => void (touched = null);

// MARK: Asking Chrome

const queued = new Map<string, Set<string>>();
const asked = new Set<string>();
let lookupTimer: ReturnType<typeof setTimeout> | undefined;

function ask(key: string, page: string) {
  if (isIncognitoProfile(key) || asked.has(`${key}|${page}`)) return;
  asked.add(`${key}|${page}`);
  if (!queued.has(key)) queued.set(key, new Set());
  queued.get(key)!.add(page);
  lookupTimer ??= setTimeout(lookUp, LOOKUP_DELAY_MS);
}

function lookUp() {
  lookupTimer = undefined;
  const batches = [...queued];
  queued.clear();
  for (const [key, pages] of batches) {
    const all = [...pages];
    for (let i = 0; i < all.length; i += LOOKUP_BATCH) lookUpPages(key, all.slice(i, i + LOOKUP_BATCH));
  }
}

function lookUpPages(key: string, list: string[]) {
  void faviconsFor(key, list)
    .then((found) =>
      update(key, (icons) => {
        let next: Record<string, string | null> | undefined;
        for (const page of list) {
          const uri = found.pages.get(page)?.uri ?? null;
          if (icons.pages[page] === uri) continue;
          next ??= { ...icons.pages };
          next[page] = uri;
          touch(page);
        }
        return next ? { ...icons, pages: next } : icons;
        // One answer is already a batch (up to LOOKUP_BATCH pages): it lands at once, not on another timer.
      }, true),
    )
    .catch((error) => {
      // Asked again next time it's shown.
      for (const page of list) asked.delete(`${key}|${page}`);
      console.warn("[favicons] lookup failed", error);
    });
}

// MARK: Recording

const inflight = new Map<string, Promise<string | null>>();

/** A tab reports its page's icon: shown at once, and Chrome keeps it with the page. */
export function noteFavicon(tabId: string, src: string) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!tab?.url || !src) return;
  const key = cacheKey(tab.profileId);
  const page = pageKey(tab.url);
  const known = useFavicons.getState().profiles[key]?.srcs[src];
  if (known) return remember(key, page, src, known);
  const handle = webviews.get(tabId);
  if (!handle) return;
  const id = `${key}|${src}`;
  let pending = inflight.get(id);
  if (!pending) {
    pending = handle
      .downloadFavicon(src)
      .then((image) => image?.uri ?? null)
      .catch(() => null);
    inflight.set(id, pending);
    void pending.finally(() => inflight.delete(id));
  }
  void pending.then((uri) => uri && remember(key, page, src, uri));
}

function remember(key: string, page: string, src: string, uri: string) {
  // A page showing the icon it had (every load reports it again): nothing to queue, and no timer for it.
  const icons = changes.length ? undefined : useFavicons.getState().profiles[key];
  if (icons && icons.pages[page] === uri && icons.srcs[src] === uri) return;
  const dark = useBrowser.getState().ui.appDark;
  const swapped = Date.now() - appearanceChangedAt < APPEARANCE_SWAP_MS;
  update(key, (icons) => {
    const previous = icons.pages[page];
    if (previous === uri && icons.srcs[src] === uri) return icons;
    let appearances = icons.appearances;
    if (swapped && previous && previous !== uri) appearances = { ...appearances, [page]: dark ? [previous, uri] : [uri, previous] };
    // As `capped`; a map that starts over forgets every other page.
    const startsOver = Object.keys(icons.pages).length >= MAX_ICONS;
    if (startsOver) touchAll();
    else touch(page);
    const pages = startsOver ? { [page]: uri } : { ...icons.pages, [page]: uri };
    return { pages, srcs: icons.srcs[src] === uri ? icons.srcs : capped(icons.srcs, src, uri), appearances };
  });
}

const failedFetches = new Set<string>();

// An icon Chrome doesn't have for a page the app names with one (an imported bookmark never visited): fetched
// without cookies and handed to Chrome, which keeps it as an on-demand icon.
function fetchMissing(profileId: string, url: string, src: string) {
  const key = cacheKey(profileId);
  if (isIncognitoProfile(profileId) || !/^https?:/i.test(src)) return;
  const id = `${key}|${src}`;
  if (inflight.has(id) || failedFetches.has(id)) return;
  const pending = fetchFavicon(src, key, pageKey(url))
    .then((image) => image?.uri ?? null)
    .catch(() => null);
  inflight.set(id, pending);
  void pending.then((uri) => {
    inflight.delete(id);
    if (uri) remember(key, pageKey(url), src, uri);
    else failedFetches.add(id);
  });
}

export function faviconFailed(profileId: string, uri: string) {
  update(cacheKey(profileId), (icons) => {
    if (!Object.values(icons.pages).includes(uri) && !Object.values(icons.srcs).includes(uri)) return icons;
    touchAll();
    return {
      pages: Object.fromEntries(Object.entries(icons.pages).map(([page, u]) => [page, u === uri ? null : u])),
      srcs: Object.fromEntries(Object.entries(icons.srcs).filter(([, u]) => u !== uri)),
      appearances: icons.appearances,
    };
  });
}

// MARK: Lookup

export type ResolvedFavicon = { uri: string; profileId: string };

function lookupIn(key: string, url: string, src: string | null | undefined): string | undefined {
  const icons = useFavicons.getState().profiles[key];
  if (!icons) return undefined;
  const page = pageKey(url);
  const pair = icons.appearances[page];
  if (pair) return pair[useBrowser.getState().ui.appDark ? 1 : 0];
  return (src ? icons.srcs[src] : undefined) ?? icons.pages[page] ?? undefined;
}

// Where to look: the profile's own icons; a private window's (or no profile's) also the others'.
function lookupOrder(profileId?: string): string[] {
  if (profileId && !isIncognitoProfile(profileId)) return [profileId];
  return [...new Set([...(profileId ? [profileId] : []), DEFAULT_PROFILE_ID, ...useBrowser.getState().profileOrder])];
}

export function resolveFavicon(url: string, src?: string | null, profileId?: string): ResolvedFavicon | null {
  if (!url) return null;
  for (const id of lookupOrder(profileId)) {
    const uri = lookupIn(cacheKey(id), url, src);
    if (uri) return { uri, profileId: id };
  }
  return null;
}

// Callers re-render on an appearance change themselves (useAppearanceDark): the lookup reads it for
// icons that have a light and a dark version.
export const useAppearanceDark = () => useBrowser((s) => s.ui.appDark);

// Whether every profile the lookup reads has Chrome's answer for the page (an icon, or none).
function answered(url: string, profileId?: string): boolean {
  const { profiles } = useFavicons.getState();
  const page = pageKey(url);
  return lookupOrder(profileId).every((id) => isIncognitoProfile(id) || profiles[cacheKey(id)]?.pages[page] !== undefined);
}

// Icons with nothing to show yet, by page: one store subscriber for all of them (a long sidebar has hundreds), and only
// the ones whose page a change touched are looked at again.
type Watcher = { url: string; src?: string | null; profileId?: string; known?: boolean };
const watchers = new Map<string, Set<Watcher>>();

function check(w: Watcher) {
  const known = answered(w.url, w.profileId);
  if (known === w.known) return;
  w.known = known;
  if (!known) for (const id of lookupOrder(w.profileId)) ask(cacheKey(id), pageKey(w.url));
  // This runs before React re-renders for an icon that just came: only "none" fetches.
  else if (w.src && w.profileId && !resolveFavicon(w.url, w.src, w.profileId)) fetchMissing(w.profileId, w.url, w.src);
}

function onFavicons(f: Favicons, prev: Favicons) {
  const pages = touched;
  touched = new Set();
  if (f.profiles === prev.profiles) return;
  for (const page of pages ?? [...watchers.keys()]) for (const w of [...(watchers.get(page) ?? [])]) check(w);
}

function watch(w: Watcher) {
  if (!watching) {
    watching = true;
    useFavicons.subscribe(onFavicons);
  }
  const page = pageKey(w.url);
  let set = watchers.get(page);
  if (!set) watchers.set(page, (set = new Set()));
  set.add(w);
  check(w);
  return () => {
    set.delete(w);
    if (!set.size && watchers.get(page) === set) watchers.delete(page);
  };
}

export function useFavicon(url: string, src?: string | null, profileId?: string): ResolvedFavicon | null {
  const key = useFavicons(() => {
    const found = resolveFavicon(url, src, profileId);
    return found ? `${found.profileId} ${found.uri}` : null;
  });
  // No icon yet: ask Chrome, and when it has none, fetch the one the app names. Watched outside React: Chrome
  // answering "none" changes nothing on screen, so it doesn't re-render the icon.
  const missing = !!url && !key;
  // Without a profile the lookup reads every profile: one added since asks too, on the next render.
  const order = missing ? lookupOrder(profileId).join(" ") : "";
  useEffect(() => (missing ? watch({ url, src, profileId }) : undefined), [missing, order, profileId, url, src]);
  const split = key?.indexOf(" ") ?? -1;
  return key ? { profileId: key.slice(0, split), uri: key.slice(split + 1) } : null;
}

// MARK: Themes

const theming = new Set<string>();

export function useFaviconTheme(url: string, src?: string | null, profileId?: string): IconTheme | null | undefined {
  const uri = useFavicons(() => resolveFavicon(url, src, profileId)?.uri ?? null);
  const theme = useFavicons((f) => (uri ? f.themes[uri] : undefined));
  const pending = !!uri && theme === undefined;
  useEffect(() => {
    if (!pending || !uri || theming.has(uri)) return;
    theming.add(uri);
    void iconTheme({ uri })
      .catch(() => null)
      .then((found) => queue((f) => (f.themes[uri] === (found ?? null) ? f : { ...f, themes: capped(f.themes, uri, found ?? null) })))
      .finally(() => theming.delete(uri));
  }, [pending, uri]);
  return theme;
}

// MARK: Housekeeping

function forget(key: string) {
  for (const id of [...asked]) if (id.startsWith(`${key}|`)) asked.delete(id);
  touchAll();
  update(key, () => EMPTY, true);
}

/** Clear Data deleted the profile's icons from Chrome: forget what's cached. */
export const pruneProfileFavicons = (profileId: string) => forget(cacheKey(profileId));

// Before Chrome kept them: an index per profile (favicons-<profile>.json) and a folder of PNGs per engine profile.
function removeLegacyFiles(s: Pick<BrowserState, "profiles">) {
  for (const id of Object.keys(s.profiles)) {
    const doc = `favicons-${id}.json`;
    try {
      if (readDocument(doc) === null) continue;
      removeDocument(doc);
      if (!isIncognitoProfile(id)) void removeLegacyFavicons(engineProfile(id)).catch(() => {});
    } catch (error) {
      console.warn(`[favicons] couldn't remove ${doc}`, error);
    }
  }
}

export function startFavicons() {
  removeLegacyFiles(useBrowser.getState());
  const history = onHistoryChanged((change) => {
    if (change.kind !== "deleted") return;
    if (change.all) return forget(change.profile);
    const gone = new Set(change.urls.map(pageKey));
    const key = change.profile;
    for (const page of gone) asked.delete(`${key}|${page}`);
    update(key, (icons) => {
      if (!Object.keys(icons.pages).some((page) => gone.has(page))) return icons;
      for (const page of gone) touch(page);
      return { ...icons, pages: Object.fromEntries(Object.entries(icons.pages).filter(([page]) => !gone.has(page))) };
    });
  });
  const stop = useBrowser.subscribe((s, prev) => {
    if (s.ui.appDark !== prev.ui.appDark) appearanceChangedAt = Date.now();
    // Private profiles' icons go with their last window: nothing to look at while none are kept or queued.
    if (s.windows !== prev.windows && (changes.length || Object.keys(useFavicons.getState().profiles).some(isIncognitoProfile))) {
      const open = new Set(Object.values(s.windows).map((w) => w.profileId));
      for (const t of Object.values(s.tabs)) open.add(t.profileId);
      // After what's queued, which may still hold the window's icons.
      queue((f) => {
        const gone = Object.keys(f.profiles).filter((id) => isIncognitoProfile(id) && !open.has(id));
        if (gone.length) touchAll();
        return gone.length ? { ...f, profiles: Object.fromEntries(Object.entries(f.profiles).filter(([id]) => !gone.includes(id))) } : f;
      }, true);
    }
  });
  return () => {
    history.remove();
    stop();
  };
}
