import { writeDocument } from "@arcadia/shell";
import { sidebarEntries } from "../components/sidebar/entries";
import { rowIds, rowView } from "../components/sidebar/state";
import { useBrowser } from "../store/browser";

// The perf probe's "layout" option (lib/perfProbe.ts): through a launch's first seconds, after every React commit, where
// each sidebar row (tab, tile, group, split, live folder) is in its window. A row once on screen that is then somewhere
// else, with nothing done to the app, is late content shifting what was already shown (docs/perf/sprint.md, "Lessons":
// deferred rows and side pages must hold their room). At the end it lists the rows the shown page should have and
// doesn't (`missing`): a tab opened, closed or moved while the rows filled in must still get its row.
// "layoutEdit" also opens a tab, closes one and moves one at the launch's second commit, while the rows fill in.
// scripts/layout-shift-test.mjs reads `layout-watch.json`.

const WATCH_MS = 8000;
const MOVED = 0.5;

type Place = { x: number; y: number; width: number; height: number; commit: number };
type Move = { row: string; from: Place; to: Place };

const last = new Map<string, Place>();
const shown = new Set<string>();
const moves: Move[] = [];
let commits = 0;
let started = 0;
let finished = false;

function onScreen(p: Place, frame: readonly number[] | null | undefined): boolean {
  if (!p.width || !p.height) return false;
  const [width, height] = frame ? [frame[2]!, frame[3]!] : [Infinity, Infinity];
  return p.x >= 0 && p.x + p.width <= width + 1 && p.y + p.height > 0 && p.y < height;
}

function seen(key: string, place: Place, frame: readonly number[] | null | undefined) {
  const before = last.get(key);
  // Measurements come back in commit order; one from an older commit than what's recorded is stale.
  if (before && before.commit > place.commit) return;
  if (before && shown.has(key) && (Math.abs(before.x - place.x) > MOVED || Math.abs(before.y - place.y) > MOVED)) moves.push({ row: key, from: before, to: place });
  last.set(key, place);
  if (onScreen(place, frame)) shown.add(key);
}

// The rows each window's shown profile page should have mounted by now: its tiles, pinned groups, list entries.
function missingRows(): string[] {
  const s = useBrowser.getState();
  const missing: string[] = [];
  for (const windowId of s.windowOrder) {
    const w = s.windows[windowId];
    if (!w || !w.sidebarOpen) continue;
    const { tiles, pinnedGroups, list } = sidebarEntries(s, windowId, w.profileId);
    const ids = [...tiles, ...pinnedGroups, ...list.map((e) => (e.startsWith("s:") ? e : e.slice(2)))];
    for (const id of ids) if (!rowView(windowId, id)) missing.push(`${windowId}|${id}`);
  }
  return missing;
}

let edits: string[] = [];
// "layoutEdit": what a user (or a restore) does while the rows fill in.
function edit() {
  const s = useBrowser.getState();
  const windowId = s.ui.focusedWindowId ?? s.windowOrder[0];
  const w = windowId ? s.windows[windowId] : undefined;
  if (!w) return;
  const mine = w.tabIds.filter((id) => s.tabs[id]?.profileId === w.profileId && !s.tabs[id]?.pinned);
  const added = s.newTab(w.id, { url: "about:blank#layout-edit", background: true });
  s.moveTab(added, 0);
  const closed = mine[3];
  if (closed) s.closeTab(closed);
  const moved = mine[mine.length - 1];
  if (moved) s.moveTab(moved, 1);
  edits = [`added ${added}`, `closed ${closed}`, `moved ${moved}`];
}

function finish() {
  if (finished) return;
  finished = true;
  writeDocument("layout-watch.json", JSON.stringify({ commits, rows: last.size, shown: shown.size, ms: Date.now() - started, moves, missing: missingRows(), edits }));
}

/** A React commit landed (the probe's commit hook): measure every row after its layout. `editAt`: the commit to edit at. */
export function layoutCommitted(editAt = 0) {
  if (finished) return;
  if (!started) {
    started = Date.now();
    setTimeout(finish, WATCH_MS);
  }
  const commit = ++commits;
  if (commit === editAt) setTimeout(edit, 0);
  const s = useBrowser.getState();
  for (const windowId of s.windowOrder) {
    const frame = s.windows[windowId]?.frame;
    for (const id of rowIds(windowId)) {
      rowView(windowId, id)?.measureInWindow((x, y, width, height) => seen(`${windowId}|${id}`, { x, y, width, height, commit }, frame));
    }
  }
}
