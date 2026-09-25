import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { isIncognitoProfile } from "./model";
import type { HistoryEntry } from "./types";

export type HistorySlice = {
  /** Per profile, most recent first. Incognito records nothing. */
  history: Record<string, HistoryEntry[]>;

  /** `countVisit`: a newly committed page (vs. a title/favicon update for the same page). */
  recordVisit(profileId: string, url: string, title: string, favicon: string | null, countVisit?: boolean): void;
  removeHistory(profileId: string, urls: string[]): void;
  /**
   * Clears everything, or only visits since `since` (ms epoch): a page visited
   * before that stays, with its earlier visits.
   */
  clearHistory(profileId: string, since?: number): void;
  /**
   * Merges history from another browser: visits add up, the latest visit wins, and
   * existing titles stay. Returns how many new pages were added.
   */
  importHistory(profileId: string, entries: Omit<HistoryEntry, "favicon">[]): number;
};

const MAX_ENTRIES = 5000;
/** Visit times kept per page (older visits only count). */
export const MAX_VISIT_TIMES = 50;

const withVisit = (times: number[] | undefined, at: number) => [...(times ?? []), at].slice(-MAX_VISIT_TIMES);

/**
 * `entry` without its visits since `since`, or null when none is known to be
 * older. Visits older than the recorded times all predate them, so a page
 * keeps them only when one of its recorded visits is older too.
 */
export function withoutVisitsSince(entry: HistoryEntry, since: number): HistoryEntry | null {
  if (entry.lastVisit < since) return entry;
  const times = entry.visitTimes?.length ? entry.visitTimes : [entry.lastVisit];
  const kept = times.filter((t) => t < since);
  if (!kept.length) return null;
  return { ...entry, visits: entry.visits - (times.length - kept.length), lastVisit: kept[kept.length - 1]!, visitTimes: kept };
}

export const createHistorySlice: StateCreator<BrowserState, [], [], HistorySlice> = (set) => ({
  history: {},

  recordVisit(profileId, url, title, favicon, countVisit = false) {
    // netnyahoo:// is Chrome's WebUI (netnyahoo://version…), kept so the bar can suggest it again.
    if (isIncognitoProfile(profileId) || !/^(https?|file|netnyahoo):/.test(url)) return;
    set((s) => {
      const list = s.history[profileId] ?? [];
      const existing = list.find((h) => h.url === url);
      if (existing && !countVisit && existing.title === (title || existing.title) && existing.favicon === (favicon ?? existing.favicon)) return {};
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
      // Updates to the same page keep its position; a new visit moves it to the top.
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
      // Pages whose last visit moved back go where their new last visit puts them.
      return { history: { ...s.history, [profileId]: kept.sort((a, b) => b.lastVisit - a.lastVisit) } };
    });
  },
});
