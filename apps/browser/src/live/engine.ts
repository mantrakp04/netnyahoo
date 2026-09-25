import { onWindowEvent } from "@netnyahoo/shell";
import { useBrowser } from "../store/browser";
import { activeTabId, viewTabIds } from "../store/model";
import { SOURCES } from "./sources";
import { applyFetch, createFolder, finishCompleting, live, markRead, removeFolder, setStatus, useLive } from "./store";
import { LiveError, type CompletionState, type LiveFolderKind, type LiveItem, type LiveSourceId, type PullRequestSection } from "./types";

/**
 * Keeps live folders fresh: on creation, every few minutes, when a window comes
 * back into focus, shortly after you leave one of a folder's tabs (you may
 * have merged or reviewed something there), and on demand (the refresh button).
 */
const INTERVAL_MS: Record<LiveFolderKind, number> = { pullRequests: 3 * 60_000, documents: 10 * 60_000 };
const STALE_ON_FOCUS_MS = 60_000;
/** Dia's completion moment: the check pops, then the row folds away. */
export const COMPLETION_MS = 2600;

const inflight = new Map<string, Promise<void>>();
/** Sources each folder last fetched from (this session). */
const fetchedSources = new Map<string, Set<LiveSourceId>>();

const SECTION_ORDER: Record<PullRequestSection, number> = { authored: 0, review: 1, team: 2 };

function order(items: LiveItem[]): LiveItem[] {
  return [...items].sort(
    (a, b) => (SECTION_ORDER[a.section ?? "authored"] ?? 0) - (SECTION_ORDER[b.section ?? "authored"] ?? 0) || b.updatedAt - a.updatedAt,
  );
}

export function refreshFolder(folderId: string): Promise<void> {
  const running = inflight.get(folderId);
  if (running) return running;
  const task = run(folderId).finally(() => inflight.delete(folderId));
  inflight.set(folderId, task);
  return task;
}

async function run(folderId: string) {
  const folder = live().folders[folderId];
  if (!folder) return;
  const before = live();
  setStatus(folderId, { state: before.status[folderId]?.lastFetch ? "updating" : "initializing" });
  const prev = before.items[folderId] ?? [];
  const animating = new Set(before.completing[folderId] ?? []);
  const results = await Promise.allSettled(folder.sources.map((id) => SOURCES[id].fetch(folder)));

  const next: LiveItem[] = [];
  const failed: { source: LiveSourceId; error: unknown }[] = [];
  results.forEach((r, i) => {
    const source = folder.sources[i]!;
    if (r.status === "fulfilled") next.push(...r.value);
    else {
      failed.push({ source, error: r.reason });
      // Keep what the failing source showed last time.
      next.push(...prev.filter((it) => it.source === source && !animating.has(it.id)));
    }
  });
  if (!live().folders[folderId]) return;

  // PRs that left: merged, closed, or reviewed? (Only asked of sources that answered.)
  const ids = new Set(next.map((it) => it.id));
  const missing = prev.filter((it) => !ids.has(it.id) && !animating.has(it.id) && !failed.some((f) => f.source === it.source));
  const gone: Record<string, CompletionState> = {};
  for (const source of new Set(missing.map((it) => it.source))) {
    const resolve = SOURCES[source].resolveGone;
    if (!resolve) continue;
    Object.assign(gone, await resolve(missing.filter((it) => it.source === source)).catch(() => ({})));
  }

  const firstFailure = failed[0];
  if (firstFailure && failed.length === folder.sources.length && !prev.length && !before.status[folderId]?.lastFetch) {
    // Nothing to show yet: stay empty with the error (the header offers to sign in).
    setStatus(folderId, { state: "error", error: describe(firstFailure.source, firstFailure.error) });
    return;
  }
  // A source newly added to the folder isn't "new items".
  const lastSources = fetchedSources.get(folderId);
  const quiet = new Set(lastSources ? next.filter((it) => !lastSources.has(it.source)).map((it) => it.id) : []);
  fetchedSources.set(folderId, new Set(folder.sources.filter((id) => !failed.some((f) => f.source === id))));
  applyFetch(folderId, order(next), gone, Date.now(), quiet);
  if (firstFailure) setStatus(folderId, { state: "error", error: describe(firstFailure.source, firstFailure.error) });
  const leaving = Object.keys(gone);
  if (leaving.length) setTimeout(() => finishCompleting(folderId, leaving), COMPLETION_MS);
}

function describe(source: LiveSourceId, error: unknown) {
  if (error instanceof LiveError) return { kind: error.kind, message: error.message, source };
  return { kind: "other" as const, message: String((error as Error)?.message ?? error), source };
}

/** Tooltip / menu copy for a folder's status (Dia's live folder menu). */
export function statusText(folderId: string, now = Date.now()): string {
  const st = live().status[folderId];
  if (!st || st.state === "initializing") return "Loading…";
  if (st.state === "updating") return "Updating…";
  if (st.error) return errorText(st.error.kind, st.error.source);
  if (!st.lastFetch) return "Not updated yet";
  const min = Math.floor((now - st.lastFetch) / 60_000);
  return min < 1 ? "Updated just now" : min < 60 ? `Updated ${min} min ago` : `Updated ${Math.floor(min / 60)} hr ago`;
}

export function errorText(kind: LiveError["kind"], source: LiveSourceId): string {
  const name = SOURCES[source].name;
  switch (kind) {
    case "notConfigured":
      return `Connect ${name} in Settings`;
    case "signedOut":
      return `Sign back in to ${name}`;
    case "sso":
      return `${name} needs Single Sign-On for this organization`;
    case "rateLimited":
      return `${name} rate limit exceeded. Try again in a few minutes.`;
    case "network":
      return `Couldn't connect to ${name}`;
    default:
      return `We're having trouble connecting to ${name}`;
  }
}

// MARK: Folder actions

/** Right-click › New Live Folder › …: makes the folder and fills it. */
export function newLiveFolder(windowId: string, kind: LiveFolderKind): string | null {
  const w = useBrowser.getState().windows[windowId];
  if (!w || w.incognito) return null;
  const s = live();
  const sources: LiveSourceId[] =
    kind === "pullRequests"
      ? (["github", "bitbucket"] as const).filter((id) => s.accounts[id])
      : (["notion", "confluence", "gdrive"] as const).filter((id) => s.accounts[id]);
  const id = createFolder(w.profileId, kind, sources.length ? sources : undefined);
  void refreshFolder(id);
  return id;
}

/** Opens an item as a tab inside its folder (or selects the tab it's already open in). */
export function openLiveItem(windowId: string, folderId: string, item: LiveItem, options: { background?: boolean } = {}) {
  const s = useBrowser.getState();
  markRead(folderId, [item.id]);
  const existing = viewTabIds(s, windowId).find((id) => s.tabs[id]?.liveItem?.itemId === item.id && s.tabs[id]?.liveItem?.folderId === folderId);
  if (existing) {
    if (!options.background) s.activate(existing);
    return existing;
  }
  const id = s.newTab(windowId, { url: item.url, background: options.background });
  useBrowser.getState().updateTab(id, { liveItem: { folderId, itemId: item.id } });
  return id;
}

/** Tabs a folder has open in a window. */
export function folderTabIds(windowId: string, folderId: string): string[] {
  const s = useBrowser.getState();
  return viewTabIds(s, windowId).filter((id) => s.tabs[id]?.liveItem?.folderId === folderId);
}

/** Delete Live Folder: its tabs close too (Reopen Closed Tab brings them back as ordinary tabs). */
export function deleteLiveFolder(folderId: string) {
  const s = useBrowser.getState();
  const tabs = Object.values(s.tabs).filter((t) => t.liveItem?.folderId === folderId).map((t) => t.id);
  if (tabs.length) s.closeTabs(tabs);
  removeFolder(folderId);
}

// MARK: Background refresh

let started = false;
const lastNudge = new Map<string, number>();

export function startLiveEngine() {
  if (started) return;
  started = true;

  // Tabs that point at folders that no longer exist go back to the ordinary list.
  const orphans = () => {
    const s = useBrowser.getState();
    const folders = live().folders;
    for (const t of Object.values(s.tabs)) if (t.liveItem && !folders[t.liveItem.folderId]) s.updateTab(t.id, { liveItem: undefined });
  };
  orphans();
  useLive.subscribe((s, prev) => {
    if (s.folders !== prev.folders) orphans();
  });

  // Folders of deleted profiles go with them.
  useBrowser.subscribe((s, prev) => {
    if (s.profiles === prev.profiles) return;
    for (const f of Object.values(live().folders)) if (!s.profiles[f.profileId]) removeFolder(f.id);
  });

  const due = (id: string, maxAge: number) => {
    const f = live().folders[id];
    const st = live().status[id];
    return !!f && (!st?.lastFetch || Date.now() - st.lastFetch >= maxAge);
  };
  setTimeout(() => live().folderOrder.forEach((id) => void refreshFolder(id)), 2500);
  setInterval(() => {
    for (const id of live().folderOrder) if (due(id, INTERVAL_MS[live().folders[id]!.kind])) void refreshFolder(id);
  }, 30_000);
  onWindowEvent((e) => {
    if (e.type === "focus") for (const id of live().folderOrder) if (due(id, STALE_ON_FOCUS_MS)) void refreshFolder(id);
  });

  // A folder's tab that gets pinned becomes an ordinary pinned tab.
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    for (const id in s.tabs) {
      const t = s.tabs[id]!;
      if (t.pinned && t.liveItem && !prev.tabs[id]?.pinned) useBrowser.getState().updateTab(id, { liveItem: undefined });
    }
  });

  // Leaving a folder's tab: you may have merged or reviewed it there.
  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows) return;
    for (const windowId of s.windowOrder) {
      const before = activeTabId(prev, windowId);
      if (!before || before === activeTabId(s, windowId)) continue;
      const folderId = s.tabs[before]?.liveItem?.folderId;
      if (!folderId || Date.now() - (lastNudge.get(folderId) ?? 0) < 20_000) continue;
      lastNudge.set(folderId, Date.now());
      setTimeout(() => void refreshFolder(folderId), 3000);
    }
  });
}
