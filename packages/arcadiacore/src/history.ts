import { engineCall, onEngineEvent } from "./engine";

// Chrome's history (HistoryService), the one store of it. Chrome records visits itself; the app reads it as one
// row per URL and keeps no copy on disk. Profiles are engine profiles ("" is the default); private ones have none.

/** One URL: Chrome's visit count and its user-visible visit times (ms, oldest first, the newest 50). */
export type EngineHistoryEntry = { url: string; title: string; visits: number; visitTimes: number[] };

export type HistoryChange =
  | { kind: "visit"; profile: string; url: string; title: string; visits: number; at: number }
  | { kind: "modified"; profile: string; rows: { url: string; title: string; visits: number }[] }
  /** `all`: a time range went (Clear Browsing Data, expiry), so re-read; else whole URLs did. */
  | { kind: "deleted"; profile: string; all: boolean; urls: string[] };

type Row = { u: string; t: string; n: number };

export async function queryHistory(profile: string, maxUrls = 5000, maxVisits = 50): Promise<EngineHistoryEntry[]> {
  const { entries } = await engineCall<{ entries: (Row & { v: number[] })[] }>("ac_history_query", profile, { maxUrls, maxVisits });
  return entries.map((e) => ({ url: e.u, title: e.t, visits: e.n, visitTimes: e.v }));
}

// One add at a time per profile: Chrome checks what a URL has, then adds what's missing, so two adds of the same
// visit at once would both add it.
const adding = new Map<string, Promise<unknown>>();

/**
 * Adds each visit the URL doesn't already have (each visit Chrome has accounts for one within `toleranceMs`);
 * resolves with how many it added.
 */
export function addHistoryVisits(profile: string, pages: { url: string; title: string; visitTimes: number[] }[], toleranceMs = 1000) {
  if (!pages.length) return Promise.resolve(0);
  const run = (adding.get(profile) ?? Promise.resolve())
    .catch(() => {})
    .then(() =>
      engineCall<{ added: number }>("ac_history_add", profile, { pages: pages.map((p) => ({ u: p.url, t: p.title, v: p.visitTimes })), toleranceMs }),
    )
    .then((r) => r.added);
  adding.set(profile, run);
  return run;
}

/** Chrome's importer path: a new URL gets `visits` as its count and one visit at `lastVisit`. */
export const importHistoryRows = (profile: string, rows: { url: string; title: string; visits: number; lastVisit: number }[]) =>
  rows.length
    ? engineCall("ac_history_import", profile, { rows: rows.map((r) => ({ u: r.url, t: r.title, n: r.visits, l: r.lastVisit })) })
    : Promise.resolve();

export const deleteHistoryUrls = (profile: string, urls: string[]) =>
  urls.length ? engineCall("ac_history_delete_urls", profile, { urls }) : Promise.resolve();

/** Starts `onHistoryChanged` events for the profile. */
export const watchHistory = (profile: string) => engineCall("ac_history_watch", profile);

type RawChange = Record<string, unknown>;

// The engine sends the changes of each ~20 ms together ({kind: "batch", changes}), in order: an add of many visits
// (history.json's move, sync) made one event per visit, ~88,000 at one launch.
export const onHistoryChanged = (listener: (change: HistoryChange) => void) =>
  onEngineEvent((topic, p) => {
    if (topic !== "history.changed") return;
    const profile = p.profile;
    const one = (c: RawChange) => {
      if (c.kind === "visit") listener({ kind: "visit", profile, url: c.u as string, title: c.t as string, visits: c.n as number, at: c.at as number });
      else if (c.kind === "modified")
        listener({ kind: "modified", profile, rows: (c.rows as Row[]).map((r) => ({ url: r.u, title: r.t, visits: r.n })) });
      else if (c.kind === "deleted") listener({ kind: "deleted", profile, all: !!c.all, urls: (c.urls as string[]) ?? [] });
    };
    if (p.kind === "batch") for (const c of (p.changes as RawChange[]) ?? []) one(c);
    else one(p);
  });
