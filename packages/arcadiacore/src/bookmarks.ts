import { engineCall, onEngineEvent } from "./engine";

// Chrome's bookmarks (BookmarkModel), the one store of them: chrome.bookmarks, Chrome's UI and the app share it.
// Nodes are named by their UUID; Chrome's two permanent folders are "bar" and "other".

/** `key`: the node's sync key when it isn't its UUID (kept as Chrome meta info). */
export type EngineBookmark = { id: string; k: "u" | "f"; t: string; u?: string; a: number; key?: string; c?: EngineBookmark[] };

/**
 * Applied in order, up to the first that can't apply (the rest were made against a tree Chrome doesn't have).
 * `index` is the node's index among `parent`'s children once added or moved. An add of an id Chrome has moves and
 * updates it instead, or leaves it with `ifAbsent`.
 */
export type BookmarkOp =
  | { op: "add"; id: string; k: "u" | "f"; t: string; u?: string; a: number; key?: string; parent: string; index?: number; ifAbsent?: boolean }
  | { op: "move"; id: string; parent: string; index: number }
  | { op: "update"; id: string; t?: string; u?: string }
  | { op: "remove"; id: string };

/** The bar's and the other folder's trees, once Chrome has loaded them. */
export const bookmarkTree = (profile: string) => engineCall<{ bar: EngineBookmark; other: EngineBookmark }>("ac_bookmarks_tree", profile);

/**
 * The app's own ops raise no `onBookmarksChanged`. `skipped` counts the ops from the first Chrome couldn't apply;
 * `invalid`, adds dropped for a URL Chrome can't keep.
 */
export const applyBookmarkOps = (profile: string, ops: BookmarkOp[]) =>
  engineCall<{ applied: number; skipped: number; invalid: string[] }>("ac_bookmarks_apply", profile, { ops });

/** Starts `onBookmarksChanged` for the profile. */
export const watchBookmarks = (profile: string) => engineCall("ac_bookmarks_watch", profile);

/** Something other than the app (an extension, Chrome's UI) changed the profile's bookmarks. */
export const onBookmarksChanged = (listener: (profile: string) => void) =>
  onEngineEvent((topic, p) => {
    if (topic === "bookmarks.changed") listener(p.profile);
  });
