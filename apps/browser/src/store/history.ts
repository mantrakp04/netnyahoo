import { deleteHistoryUrls, importHistoryRows } from "@netnyahoo/cef";
import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { engineProfile, isIncognitoProfile } from "./model";
import type { HistoryEntry } from "./types";

// History is Chrome's (HistoryService): Chrome records every visit itself and keeps it. `history` is the app's
// in-memory view of it, one entry per URL, newest first, filled and kept current by lib/history.ts; nothing here
// is saved. Changes go to Chrome and land in the view at once; Chrome's own report of them changes nothing more.
export type HistorySlice = {
  history: Record<string, HistoryEntry[]>;
  // Profiles whose view has been read from Chrome (until then it's empty, not "no history").
  historyReady: Record<string, true>;

  removeHistory(profileId: string, urls: string[]): void;
  // The view only: Clear Browsing Data deletes from Chrome (clearBrowsingData's "history").
  clearHistory(profileId: string, since?: number): void;
  importHistory(profileId: string, entries: Omit<HistoryEntry, "favicon">[]): number;
};

export const MAX_HISTORY = 5000;
export const MAX_VISIT_TIMES = 50;

export function withoutVisitsSince(entry: HistoryEntry, since: number): HistoryEntry | null {
  if (entry.lastVisit < since) return entry;
  const times = entry.visitTimes?.length ? entry.visitTimes : [entry.lastVisit];
  const kept = times.filter((t) => t < since);
  if (!kept.length) return null;
  return { ...entry, visits: entry.visits - (times.length - kept.length), lastVisit: kept[kept.length - 1]!, visitTimes: kept };
}

const failed = (what: string) => (error: unknown) => console.warn(`[history] ${what}`, error);

export const createHistorySlice: StateCreator<BrowserState, [], [], HistorySlice> = (set) => ({
  history: {},
  historyReady: {},

  removeHistory(profileId, urls) {
    if (!urls.length || isIncognitoProfile(profileId)) return;
    set((s) => ({ history: { ...s.history, [profileId]: (s.history[profileId] ?? []).filter((h) => !urls.includes(h.url)) } }));
    void deleteHistoryUrls(engineProfile(profileId), urls).catch(failed("delete"));
  },

  importHistory(profileId, entries) {
    if (isIncognitoProfile(profileId)) return 0;
    const rows = entries.filter((e) => /^(https?|file):/.test(e.url));
    let added = 0;
    set((s) => {
      const byUrl = new Map((s.history[profileId] ?? []).map((h) => [h.url, h]));
      for (const e of rows) {
        const existing = byUrl.get(e.url);
        if (existing) continue;
        added++;
        byUrl.set(e.url, { url: e.url, title: e.title, favicon: null, visits: Math.max(1, e.visits), lastVisit: e.lastVisit, visitTimes: [e.lastVisit] });
      }
      const merged = [...byUrl.values()].sort((a, b) => b.lastVisit - a.lastVisit).slice(0, MAX_HISTORY);
      return { history: { ...s.history, [profileId]: merged } };
    });
    void importHistoryRows(engineProfile(profileId), rows).catch(failed("import"));
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
