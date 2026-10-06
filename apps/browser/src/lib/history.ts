import { addHistoryVisits, onHistoryChanged, queryHistory, watchHistory, type EngineHistoryEntry, type HistoryChange } from "@netnyahoo/nncore";
import { readDocument, removeDocument } from "@netnyahoo/shell";
import { useBrowser, type BrowserState } from "../store/browser";
import { MAX_HISTORY, MAX_VISIT_TIMES } from "../store/history";
import { engineProfile, isIncognitoProfile } from "../store/model";
import type { HistoryEntry } from "../store/types";

// Keeps the store's `history` view of Chrome's history (store/history.ts): read from Chrome at launch and for
// each new profile, then kept current from Chrome's change events. Once, it moves the app's old history.json
// into Chrome.

const LEGACY_FILE = "history.json";
// Chrome recorded the same visits the old file did, a moment apart (it notes a visit at commit, the app did at
// load end): within this, a saved visit is one Chrome has.
const LEGACY_TOLERANCE_MS = 60_000;
// Chrome expires visits older than this; there's no use adding them.
const CHROME_KEEPS_MS = 90 * 86_400_000;
const CHUNK = 500;
// Chrome commits history a few seconds after a change; the old file stays until then, so a crash before it moves
// it again (adding only what Chrome lacks).
const LEGACY_KEPT_MS = 15_000;

const store = () => useBrowser.getState();

// The pages the app's History, command bar and sync show: Chrome also keeps extension pages (a hidden helper's
// chrome-extension:// page among them), which the app never listed.
export const shownInHistory = (url: string) => /^(https?|file):/i.test(url);

const toEntry = (e: EngineHistoryEntry): HistoryEntry => ({
  url: e.url,
  title: e.title,
  favicon: null,
  visits: e.visits,
  lastVisit: e.visitTimes.length ? e.visitTimes[e.visitTimes.length - 1]! : 0,
  visitTimes: e.visitTimes,
});

const engineProfiles = (s: Pick<BrowserState, "profiles">) =>
  [...new Set(Object.keys(s.profiles).filter((id) => !isIncognitoProfile(id)).map(engineProfile))];

const profilesUsing = (s: Pick<BrowserState, "profiles">, engine: string) =>
  Object.keys(s.profiles).filter((id) => !isIncognitoProfile(id) && engineProfile(id) === engine);

function viewOf(engine: string): HistoryEntry[] {
  const s = store();
  for (const id of profilesUsing(s, engine)) if (s.history[id]) return s.history[id]!;
  return [];
}

// Sync may use a view only once history.json is in Chrome: before, its visits would read as deleted.
let legacyMoved = false;

/**
 * Shows `list` for the engine profile. `floor`: visits at or before it may be missing from the view (it holds
 * Chrome's newest MAX_HISTORY URLs); a read sets it, and it only rises while the view fills from events.
 */
function setView(engine: string, list: HistoryEntry[], floor?: number) {
  useBrowser.setState((s) => {
    const ids = profilesUsing(s, engine);
    const was = ids.map((id) => s.historyFloor[id] ?? -Infinity).reduce((a, b) => Math.max(a, b), -Infinity);
    const full = list.length >= MAX_HISTORY ? list[list.length - 1]!.lastVisit : -Infinity;
    const next = Math.max(floor ?? was, full);
    const ready = legacyMoved;
    const sameList = ids.every((id) => s.history[id] === list);
    const sameFloor = ids.every((id) => (s.historyFloor[id] ?? -Infinity) === next);
    const sameReady = !ready || ids.every((id) => s.historyReady[id]);
    if (sameList && sameFloor && sameReady) return {};
    // Only what changed gets a new object: most events (a visit, a title) change the list alone.
    return {
      ...(sameList ? {} : { history: { ...s.history, ...Object.fromEntries(ids.map((id) => [id, list])) } }),
      ...(sameFloor ? {} : { historyFloor: { ...s.historyFloor, ...Object.fromEntries(ids.map((id) => [id, next])) } }),
      ...(sameReady ? {} : { historyReady: { ...s.historyReady, ...Object.fromEntries(ids.map((id) => [id, true as const])) } }),
    };
  });
}

// MARK: Changes

const byLastVisit = (a: HistoryEntry, b: HistoryEntry) => b.lastVisit - a.lastVisit;

export function applyHistoryChange(list: HistoryEntry[], change: Exclude<HistoryChange, { kind: "deleted"; all: true }>): HistoryEntry[] {
  switch (change.kind) {
    case "visit": {
      if (!shownInHistory(change.url)) return list;
      const oldAt = list.findIndex((h) => h.url === change.url);
      const old = oldAt < 0 ? undefined : list[oldAt];
      if (old?.visitTimes?.includes(change.at)) return list;
      const times = [...(old?.visitTimes ?? []), change.at].sort((a, b) => a - b).slice(-MAX_VISIT_TIMES);
      const entry: HistoryEntry = {
        url: change.url,
        title: change.title || old?.title || "",
        favicon: null,
        visits: Math.max(change.visits, 1),
        lastVisit: times[times.length - 1]!,
        visitTimes: times,
      };
      // One copy of the list (up to 5000 entries, on every visit Chrome reports): the page's old entry drops out and the
      // new one goes before the first entry visited no later than it.
      const next = list.slice();
      if (old) next.splice(oldAt, 1);
      const at = next.findIndex((h) => h.lastVisit <= entry.lastVisit);
      if (at < 0) next.push(entry);
      else next.splice(at, 0, entry);
      if (next.length > MAX_HISTORY) next.length = MAX_HISTORY;
      return next;
    }
    case "modified": {
      // A title or count change names a page or two: look those up, copy the list only if one differs.
      let next: HistoryEntry[] | null = null;
      for (const row of new Map(change.rows.map((r) => [r.url, r])).values()) {
        const at = list.findIndex((h) => h.url === row.url);
        const h = at < 0 ? undefined : list[at];
        if (!h || ((row.title === h.title || !row.title) && row.visits === h.visits)) continue;
        next ??= list.slice();
        next[at] = { ...h, title: row.title || h.title, visits: row.visits };
      }
      return next ?? list;
    }
    case "deleted": {
      const gone = new Set(change.urls);
      const next = list.filter((h) => !gone.has(h.url));
      return next.length === list.length ? list : next;
    }
  }
}

// MARK: Loading

type Load = { running: Promise<void>; again: boolean; queued: HistoryChange[] };
const loads = new Map<string, Load>();
const loaded = new Set<string>();
// Profiles whose old file is being moved in: their views are read again once it's done, not per added visit.
const migrating = new Set<string>();

function load(engine: string): Promise<void> {
  const running = loads.get(engine);
  if (running) {
    running.again = true;
    return running.running;
  }
  const state: Load = { running: Promise.resolve(), again: false, queued: [] };
  loads.set(engine, state);
  state.running = (async () => {
    try {
      do {
        state.again = false;
        state.queued = [];
        await watchHistory(engine);
        const read = await queryHistory(engine, MAX_HISTORY, MAX_VISIT_TIMES);
        // Chrome had more URLs than the view reads: the older ones may be missing (shown or not).
        const floor = read.length >= MAX_HISTORY ? Math.min(...read.map((e) => e.visitTimes.at(-1) ?? 0)) : -Infinity;
        let list = read.filter((e) => shownInHistory(e.url)).map(toEntry).sort(byLastVisit);
        for (const change of state.queued) if (!(change.kind === "deleted" && change.all)) list = applyHistoryChange(list, change);
        if (state.queued.some((c) => c.kind === "deleted" && c.all)) state.again = true;
        setView(engine, list, floor);
        loaded.add(engine);
      } while (state.again);
    } catch (error) {
      console.warn(`[history] couldn't read ${engine || "the default profile"}'s history`, error);
    } finally {
      loads.delete(engine);
    }
  })();
  return state.running;
}

function changed(change: HistoryChange) {
  const engine = change.profile;
  if (migrating.has(engine)) return;
  const running = loads.get(engine);
  if (running) return void running.queued.push(change);
  if (!loaded.has(engine)) return;
  if (change.kind === "deleted" && change.all) return void load(engine);
  setView(engine, applyHistoryChange(viewOf(engine), change));
}

// MARK: The old file

type LegacyFile = { history?: Record<string, HistoryEntry[]> };

/**
 * Adds history.json's visits that Chrome doesn't have (imports, other Macs' synced history, visits it never
 * saw) to Chrome, then deletes the file once Chrome has committed. Adding again is harmless (each visit Chrome
 * has accounts for one saved visit), so a launch that stops halfway starts over. Profiles that no longer exist
 * are dropped.
 */
export async function migrateHistoryFile(now = Date.now(), { keepMs = LEGACY_KEPT_MS } = {}): Promise<"none" | "moved" | "kept"> {
  let file: LegacyFile | null = null;
  try {
    const json = readDocument(LEGACY_FILE);
    file = json ? (JSON.parse(json) as LegacyFile) : null;
  } catch (error) {
    console.warn(`[history] ${LEGACY_FILE} is unreadable; leaving it`, error);
    return "kept";
  }
  if (!file) return "none";
  const s = store();
  const perEngine = new Map<string, HistoryEntry[]>();
  for (const [profileId, list] of Object.entries(file.history ?? {})) {
    if (!s.profiles[profileId] || isIncognitoProfile(profileId) || !Array.isArray(list)) continue;
    const engine = engineProfile(profileId);
    // Profiles sharing data saved the same list.
    if (!perEngine.has(engine)) perEngine.set(engine, list);
  }
  for (const engine of perEngine.keys()) migrating.add(engine);
  try {
    for (const [engine, list] of perEngine) {
      const pages = list
        .filter((e) => e && typeof e.url === "string")
        .map((e) => ({
          url: e.url,
          title: e.title ?? "",
          visitTimes: (e.visitTimes?.length ? e.visitTimes : [e.lastVisit]).filter((t) => typeof t === "number" && t > now - CHROME_KEEPS_MS),
        }))
        .filter((p) => p.visitTimes.length);
      for (let i = 0; i < pages.length; i += CHUNK) await addHistoryVisits(engine, pages.slice(i, i + CHUNK), LEGACY_TOLERANCE_MS);
    }
  } catch (error) {
    console.warn(`[history] moving ${LEGACY_FILE} into Chrome failed; trying again next launch`, error);
    return "kept";
  } finally {
    migrating.clear();
  }
  if (keepMs) setTimeout(() => removeDocument(LEGACY_FILE), keepMs);
  else removeDocument(LEGACY_FILE);
  return "moved";
}

// MARK: Start

export function startHistory() {
  const events = onHistoryChanged(changed);
  const loadAll = (s: Pick<BrowserState, "profiles">) => {
    for (const engine of engineProfiles(s)) if (!loaded.has(engine) && !loads.has(engine)) void load(engine);
  };
  // With an old history.json to move in, the views are first read (and Chrome's changes watched) once it's in:
  // watching during the move sent the JS one event per moved visit (~88,000 for a long-used profile, ~200 ms of
  // the startup JS), all of them ignored, and the views are read again after it anyway.
  let moving = readDocument(LEGACY_FILE) !== null;
  if (!moving) loadAll(store());
  void migrateHistoryFile().then((result) => {
    legacyMoved = result !== "kept";
    if (moving) {
      moving = false;
      loadAll(store());
    } else if (result === "moved") void reloadHistory();
    else if (legacyMoved) for (const engine of loaded) setView(engine, viewOf(engine));
  });
  const stop = useBrowser.subscribe((s, prev) => {
    if (s.profiles === prev.profiles) return;
    if (!moving) loadAll(s);
    // A profile sharing another's data shows its list at once.
    for (const id of Object.keys(s.profiles)) {
      if (prev.profiles[id] || isIncognitoProfile(id) || s.history[id]) continue;
      const list = viewOf(engineProfile(id));
      if (list.length) setView(engineProfile(id), list);
    }
  });
  return () => {
    events.remove();
    stop();
    loaded.clear();
    legacyMoved = false;
  };
}

/** Re-reads every profile's history from Chrome (the dev harness, tests). */
export const reloadHistory = () => Promise.all(engineProfiles(store()).map(load));
