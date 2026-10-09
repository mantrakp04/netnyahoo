import { hostOf } from "@arcadia/core";
import type { BrowserState } from "../../store/browser";
import type { HistoryEntry } from "../../store/types";

const NO_HISTORY: HistoryEntry[] = [];

const historyHostCache = new WeakMap<HistoryEntry[], string[]>();

export function historyHosts(history: HistoryEntry[]): string[] {
  let hosts = historyHostCache.get(history);
  if (!hosts) {
    const set = new Set<string>();
    for (const h of history) set.add(hostOf(h.url));
    set.delete("");
    historyHostCache.set(history, (hosts = [...set]));
  }
  return hosts;
}

// The hosts of a profile's open tabs, then of its history. Kept for one tabs map and history list: typing in the bar changes
// neither, and each key asks (is what is typed a site the profile knows?).
let last: { tabs: BrowserState["tabs"]; history: HistoryEntry[]; profileId: string; hosts: string[] } | null = null;

export function knownHosts(s: BrowserState, profileId: string): string[] {
  const history = s.history[profileId] ?? NO_HISTORY;
  if (last && last.tabs === s.tabs && last.history === history && last.profileId === profileId) return last.hosts;
  const hosts: string[] = [];
  for (const t of Object.values(s.tabs)) if (t.profileId === profileId && t.url) hosts.push(hostOf(t.url));
  const all = hosts.concat(historyHosts(history));
  last = { tabs: s.tabs, history, profileId, hosts: all };
  return all;
}
