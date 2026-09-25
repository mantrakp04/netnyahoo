import { useEffect } from "react";
import { create } from "zustand";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";

/**
 * Media Session artwork for the mini players. The UI never loads it from the
 * network itself: the tab's own browser downloads it (its request context, no
 * cookies) and hands back a PNG data: URI that lives in memory only, whatever
 * the profile, so incognito artwork never reaches the disk or another context.
 */
const MAX_PIXELS = 256;
const MAX_ENTRIES = 24;

type Entry = { uri: string | null; at: number };
const useArtworks = create<{ entries: Record<string, Entry> }>(() => ({ entries: {} }));
const inflight = new Set<string>();

const keyOf = (tabId: string, url: string) => `${tabId} ${url}`;

function load(tabId: string, url: string) {
  const key = keyOf(tabId, url);
  if (inflight.has(key) || useArtworks.getState().entries[key]) return;
  const view = webviews.get(tabId);
  if (!view) return;
  inflight.add(key);
  void view
    .downloadImage(url, MAX_PIXELS)
    .catch(() => null)
    .then((image) => {
      inflight.delete(key);
      useArtworks.setState((s) => {
        const entries = { ...s.entries, [key]: { uri: image?.uri ?? null, at: Date.now() } };
        // Keep the newest few: artwork changes with every track.
        const keys = Object.keys(entries).sort((a, b) => entries[a]!.at - entries[b]!.at);
        for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete entries[old];
        return { entries };
      });
    });
}

/** The artwork as a data: URI once the tab has downloaded it; null meanwhile or if it failed. */
export function useArtwork(tabId: string, url: string | null | undefined): string | null {
  const uri = useArtworks((s) => (url ? (s.entries[keyOf(tabId, url)]?.uri ?? null) : null));
  useEffect(() => {
    if (url) load(tabId, url);
  }, [tabId, url]);
  return uri;
}

// Closed tabs take their artwork with them.
useBrowser.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return;
  const entries = useArtworks.getState().entries;
  const gone = Object.keys(entries).filter((key) => !s.tabs[key.slice(0, key.indexOf(" "))]);
  if (!gone.length) return;
  const next = { ...entries };
  for (const key of gone) delete next[key];
  useArtworks.setState({ entries: next });
});
