import { useBrowser } from "../../store/browser";
import { activeTabId, viewTabIds } from "../../store/model";
import type { HistoryEntry } from "../../store/types";

/** Popular web apps offered as pinned tabs (Dia's onboarding suggests the same kinds of sites). */
export type PinnableSite = { id: string; title: string; url: string };

export const PINNABLE_SITES: PinnableSite[] = [
  { id: "gmail", title: "Gmail", url: "https://mail.google.com/" },
  { id: "calendar", title: "Calendar", url: "https://calendar.google.com/" },
  { id: "slack", title: "Slack", url: "https://app.slack.com/" },
  { id: "notion", title: "Notion", url: "https://www.notion.so/" },
  { id: "figma", title: "Figma", url: "https://www.figma.com/" },
  { id: "github", title: "GitHub", url: "https://github.com/" },
  { id: "linear", title: "Linear", url: "https://linear.app/" },
  { id: "docs", title: "Docs", url: "https://docs.google.com/" },
  { id: "drive", title: "Drive", url: "https://drive.google.com/" },
  { id: "outlook", title: "Outlook", url: "https://outlook.office.com/mail/" },
  { id: "youtube", title: "YouTube", url: "https://www.youtube.com/" },
  { id: "spotify", title: "Spotify", url: "https://open.spotify.com/" },
];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * Sites to pre-select: the suggestions the user already visits most (e.g. from an import
 * just now), like Dia's ranked top sites. At most four, busiest first.
 */
export function preselectedSites(history: HistoryEntry[]): string[] {
  const visits = new Map<string, number>();
  for (const entry of history) {
    const host = hostOf(entry.url);
    if (host) visits.set(host, (visits.get(host) ?? 0) + entry.visits);
  }
  return PINNABLE_SITES.map((site) => ({ id: site.id, visits: visits.get(hostOf(site.url)) ?? 0 }))
    .filter((s) => s.visits >= 3)
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 4)
    .map((s) => s.id);
}

/** Pins the chosen suggestions in a window (skipping ones already pinned), in the order shown. */
export function pinSites(windowId: string, ids: string[]) {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!w) return;
  const pinned = new Set(viewTabIds(s, w.id).map((id) => s.tabs[id]!).filter((t) => t.pinned).map((t) => t.url));
  const selectedTab = activeTabId(s, w.id);
  for (const site of PINNABLE_SITES) {
    // They load when first selected, like restored tabs.
    if (ids.includes(site.id) && !pinned.has(site.url)) {
      useBrowser.getState().newTab(w.id, { url: site.url, pinned: true, background: true, snapshot: { title: site.title } });
    }
  }
  // Keep the New Tab page selected underneath.
  if (selectedTab) useBrowser.getState().activate(selectedTab);
}
