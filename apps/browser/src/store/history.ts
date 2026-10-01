import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { isIncognitoProfile } from "./model";
import type { HistoryEntry } from "./types";

export type HistorySlice = {
  history: Record<string, HistoryEntry[]>;

  recordVisit(profileId: string, url: string, title: string, favicon: string | null, countVisit?: boolean): void;
  removeHistory(profileId: string, urls: string[]): void;
  clearHistory(profileId: string, since?: number): void;
  importHistory(profileId: string, entries: Omit<HistoryEntry, "favicon">[]): number;
};

const MAX_ENTRIES = 5000;
export const MAX_VISIT_TIMES = 50;

const withVisit = (times: number[] | undefined, at: number) => [...(times ?? []), at].slice(-MAX_VISIT_TIMES);

export function withoutVisitsSince(entry: HistoryEntry, since: number): HistoryEntry | null {
  if (entry.lastVisit < since) return entry;
  const times = entry.visitTimes?.length ? entry.visitTimes : [entry.lastVisit];
  const kept = times.filter((t) => t < since);
  if (!kept.length) return null;
  return { ...entry, visits: entry.visits - (times.length - kept.length), lastVisit: kept[kept.length - 1]!, visitTimes: kept };
}

// history.json, byte for byte what JSON.stringify({ version, history }) gives. Entries are immutable
// (a visit replaces its entry), so each one is stringified once and reused: a save after a visit
// re-serializes one entry instead of all 5000.
const entryJson = new WeakMap<HistoryEntry, string>();

export function historyDocument(version: number, history: Record<string, HistoryEntry[]>): string {
  const profiles: string[] = [];
  for (const [profileId, list] of Object.entries(history)) {
    const rows = new Array<string>(list.length);
    for (let i = 0; i < list.length; i++) {
      const entry = list[i]!;
      // A malformed saved row (null, say) is written as JSON.stringify writes it.
      if (typeof entry !== "object" || entry === null) {
        rows[i] = JSON.stringify(entry) ?? "null";
        continue;
      }
      let json = entryJson.get(entry);
      if (json === undefined) entryJson.set(entry, (json = JSON.stringify(entry)));
      rows[i] = json;
    }
    profiles.push(`${JSON.stringify(profileId)}:[${rows.join(",")}]`);
  }
  return `{"version":${JSON.stringify(version)},"history":{${profiles.join(",")}}}`;
}

export const createHistorySlice: StateCreator<BrowserState, [], [], HistorySlice> = (set) => ({
  history: {},

  recordVisit(profileId, url, title, favicon, countVisit = false) {
    if (isIncognitoProfile(profileId) || !/^(https?|file|netnyahoo):/.test(url)) return;
    set((s) => {
      const list = s.history[profileId] ?? [];
      const existing = list.find((h) => h.url === url);
      // Nothing new (a finished load's title, say): the same state, so no subscriber runs.
      if (existing && !countVisit && existing.title === (title || existing.title) && existing.favicon === (favicon ?? existing.favicon)) return s;
      const now = Date.now();
      const entry: HistoryEntry = existing
        ? {
            ...existing,
            title: title || existing.title,
            favicon: favicon ?? existing.favicon,
            visits: existing.visits + (countVisit ? 1 : 0),
            lastVisit: countVisit ? now : existing.lastVisit,
            ...(countVisit ? { visitTimes: withVisit(existing.visitTimes ?? [existing.lastVisit], now) } : {}),
          }
        : { url, title, favicon, visits: 1, lastVisit: now, visitTimes: [now] };
      const next = countVisit || !existing
        ? [entry, ...list.filter((h) => h.url !== url)].slice(0, MAX_ENTRIES)
        : list.map((h) => (h.url === url ? entry : h));
      return { history: { ...s.history, [profileId]: next } };
    });
  },

  removeHistory(profileId, urls) {
    set((s) => ({ history: { ...s.history, [profileId]: (s.history[profileId] ?? []).filter((h) => !urls.includes(h.url)) } }));
  },

  importHistory(profileId, entries) {
    if (isIncognitoProfile(profileId)) return 0;
    let added = 0;
    set((s) => {
      const byUrl = new Map((s.history[profileId] ?? []).map((h) => [h.url, h]));
      for (const e of entries) {
        if (!/^(https?|file):/.test(e.url)) continue;
        const existing = byUrl.get(e.url);
        if (!existing) added++;
        byUrl.set(
          e.url,
          existing
            ? {
                ...existing,
                title: existing.title || e.title,
                visits: existing.visits + e.visits,
                lastVisit: Math.max(existing.lastVisit, e.lastVisit),
                visitTimes: withVisit(existing.visitTimes ?? [existing.lastVisit], e.lastVisit).sort((a, b) => a - b),
              }
            : { url: e.url, title: e.title, favicon: null, visits: Math.max(1, e.visits), lastVisit: e.lastVisit, visitTimes: [e.lastVisit] },
        );
      }
      const merged = [...byUrl.values()].sort((a, b) => b.lastVisit - a.lastVisit).slice(0, MAX_ENTRIES);
      return { history: { ...s.history, [profileId]: merged } };
    });
    return added;
  },

  clearHistory(profileId, since) {
    set((s) => {
      if (since === undefined) return { history: { ...s.history, [profileId]: [] } };
      const kept = (s.history[profileId] ?? []).map((h) => withoutVisitsSince(h, since)).filter((h): h is HistoryEntry => !!h);
      return { history: { ...s.history, [profileId]: kept.sort((a, b) => b.lastVisit - a.lastVisit) } };
    });
  },
});
