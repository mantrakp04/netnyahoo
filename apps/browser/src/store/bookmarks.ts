import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { newId, without } from "./model";
import type { BookmarkFolder, BookmarkNode, Bookmarks } from "./types";

export type BookmarksSlice = {
  bookmarks: Bookmarks;

  /** Adds a bookmark (default: end of the Bookmarks Bar). Returns its id. */
  addBookmark(options: { profileId: string; url: string; title: string; favicon?: string | null; parentId?: string; index?: number }): string;
  addBookmarkFolder(options: { profileId: string; title: string; parentId?: string; index?: number }): string;
  updateBookmark(id: string, patch: { title?: string; url?: string; favicon?: string | null }): void;
  moveBookmark(id: string, parentId: string, index?: number): void;
  /** Removes a bookmark, or a folder with everything in it. Roots can't be removed. */
  removeBookmark(id: string): void;
  /** ⌘D: bookmarks the page, or removes every bookmark of it. Returns whether it's bookmarked now. */
  toggleBookmark(profileId: string, page: { url: string; title: string; favicon: string | null }): boolean;
  /** Adds a whole tree (import, Bookmark All Tabs) under `parentId`. Returns the top-level ids. */
  addBookmarkTree(profileId: string, drafts: BookmarkDraft[], parentId?: string, index?: number): string[];
  /** Removes several nodes at once; pass the result to restoreBookmarks to undo. */
  removeBookmarks(ids: string[]): RemovedBookmarks;
  restoreBookmarks(removed: RemovedBookmarks): void;
};

/** A bookmark (with `url`) or folder (with `children`) to add. */
export type BookmarkDraft = { title: string; url?: string; addedAt?: number; children?: BookmarkDraft[] };

/** What removeBookmarks took out: every node, and where each top-level one was. */
export type RemovedBookmarks = { nodes: BookmarkNode[]; places: { id: string; parentId: string; index: number }[] };

export const EMPTY_BOOKMARKS: Bookmarks = { nodes: {}, roots: {} };

export function bookmarkRoots(b: Bookmarks, profileId: string) {
  return b.roots[profileId];
}

/** Creates a profile's Bookmarks Bar / Other Bookmarks roots on first use. */
export function ensureRoots(b: Bookmarks, profileId: string): [Bookmarks, { bar: string; other: string }] {
  const existing = b.roots[profileId];
  if (existing) return [b, existing];
  const now = Date.now();
  const bar: BookmarkFolder = { kind: "folder", id: newId("bm"), parentId: null, title: "Bookmarks Bar", children: [], addedAt: now };
  const other: BookmarkFolder = { kind: "folder", id: newId("bm"), parentId: null, title: "Other Bookmarks", children: [], addedAt: now };
  const roots = { bar: bar.id, other: other.id };
  return [{ nodes: { ...b.nodes, [bar.id]: bar, [other.id]: other }, roots: { ...b.roots, [profileId]: roots } }, roots];
}

/** Every node id under `ids` (inclusive). */
function subtree(b: Bookmarks, ids: string[]): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    const node = b.nodes[id];
    if (!node) return;
    out.push(id);
    if (node.kind === "folder") node.children.forEach(walk);
  };
  ids.forEach(walk);
  return out;
}

/** Removes nodes (and their descendants) and unlinks them from their parents; with `profileId`, drops its roots. */
export function removeBookmarkTree(b: Bookmarks, ids: string[], profileId?: string): Bookmarks {
  const gone = new Set(subtree(b, ids));
  const nodes = without(b.nodes, gone);
  for (const node of Object.values(nodes)) {
    if (node.kind === "folder" && node.children.some((c) => gone.has(c))) {
      nodes[node.id] = { ...node, children: node.children.filter((c) => !gone.has(c)) };
    }
  }
  return { nodes, roots: profileId ? without(b.roots, [profileId]) : b.roots };
}

const urlIndex = new WeakMap<Bookmarks, Map<string, Map<string, string[]>>>();

/** Bookmark ids per URL in a profile's tree (memoised per bookmarks object). */
export function bookmarksByUrl(b: Bookmarks, profileId: string): Map<string, string[]> {
  let perProfile = urlIndex.get(b);
  if (!perProfile) urlIndex.set(b, (perProfile = new Map()));
  let index = perProfile.get(profileId);
  if (index) return index;
  index = new Map();
  const roots = b.roots[profileId];
  for (const id of roots ? subtree(b, [roots.bar, roots.other]) : []) {
    const node = b.nodes[id];
    if (node?.kind === "url") index.set(node.url, [...(index.get(node.url) ?? []), id]);
  }
  perProfile.set(profileId, index);
  return index;
}

export const isBookmarked = (b: Bookmarks, profileId: string, url: string) => !!url && bookmarksByUrl(b, profileId).has(url);

/** A folder's children, resolved. */
export function folderChildren(b: Bookmarks, folderId: string): BookmarkNode[] {
  const folder = b.nodes[folderId];
  return folder?.kind === "folder" ? folder.children.map((id) => b.nodes[id]).filter((n): n is BookmarkNode => !!n) : [];
}

function insertChild(b: Bookmarks, node: BookmarkNode, parentId: string, index?: number): Bookmarks {
  const parent = b.nodes[parentId];
  if (parent?.kind !== "folder") return b;
  const children = parent.children.filter((c) => c !== node.id);
  children.splice(Math.min(index ?? children.length, children.length), 0, node.id);
  return { ...b, nodes: { ...b.nodes, [node.id]: { ...node, parentId } as BookmarkNode, [parentId]: { ...parent, children } } };
}

/** Ancestors of a node, nearest first (for breadcrumbs and "is it under this root?"). */
export function bookmarkAncestors(b: Bookmarks, id: string): BookmarkFolder[] {
  const out: BookmarkFolder[] = [];
  let node = b.nodes[id];
  for (let i = 0; node?.parentId && i < 64; i++) {
    const parent = b.nodes[node.parentId];
    if (parent?.kind !== "folder") break;
    out.push(parent);
    node = parent;
  }
  return out;
}

/** Every link under a folder, depth-first (Open All). */
export function folderLinks(b: Bookmarks, folderId: string): Extract<BookmarkNode, { kind: "url" }>[] {
  return folderChildren(b, folderId).flatMap((n) => (n.kind === "url" ? [n] : folderLinks(b, n.id)));
}

export const createBookmarksSlice: StateCreator<BrowserState, [], [], BookmarksSlice> = (set, get) => ({
  bookmarks: EMPTY_BOOKMARKS,

  addBookmark({ profileId, url, title, favicon = null, parentId, index }) {
    const [b, roots] = ensureRoots(get().bookmarks, profileId);
    const node: BookmarkNode = { kind: "url", id: newId("bm"), parentId: parentId ?? roots.bar, title, url, favicon, addedAt: Date.now() };
    set({ bookmarks: insertChild(b, node, node.parentId, index) });
    return node.id;
  },

  addBookmarkFolder({ profileId, title, parentId, index }) {
    const [b, roots] = ensureRoots(get().bookmarks, profileId);
    const node: BookmarkNode = { kind: "folder", id: newId("bm"), parentId: parentId ?? roots.bar, title, children: [], addedAt: Date.now() };
    set({ bookmarks: insertChild(b, node, node.parentId!, index) });
    return node.id;
  },

  updateBookmark(id, patch) {
    set((s) => {
      const node = s.bookmarks.nodes[id];
      if (!node) return {};
      const next = node.kind === "url" ? { ...node, ...patch } : { ...node, ...(patch.title !== undefined ? { title: patch.title } : {}) };
      return { bookmarks: { ...s.bookmarks, nodes: { ...s.bookmarks.nodes, [id]: next } } };
    });
  },

  moveBookmark(id, parentId, index) {
    set((s) => {
      const node = s.bookmarks.nodes[id];
      // Roots stay put, and a folder can't move into itself.
      if (!node || node.parentId === null || subtree(s.bookmarks, [id]).includes(parentId)) return {};
      const oldParent = s.bookmarks.nodes[node.parentId];
      let b = s.bookmarks;
      if (oldParent?.kind === "folder") {
        b = { ...b, nodes: { ...b.nodes, [oldParent.id]: { ...oldParent, children: oldParent.children.filter((c) => c !== id) } } };
      }
      return { bookmarks: insertChild(b, node, parentId, index) };
    });
  },

  removeBookmark(id) {
    set((s) => {
      const node = s.bookmarks.nodes[id];
      if (!node || node.parentId === null) return {};
      return { bookmarks: removeBookmarkTree(s.bookmarks, [id]) };
    });
  },

  addBookmarkTree(profileId, drafts, parentId, index) {
    let [b, roots] = ensureRoots(get().bookmarks, profileId);
    const nodes = { ...b.nodes };
    const build = (d: BookmarkDraft, parent: string): string => {
      const id = newId("bm");
      const addedAt = d.addedAt ?? Date.now();
      if (d.url !== undefined && !d.children) {
        nodes[id] = { kind: "url", id, parentId: parent, title: d.title, url: d.url, favicon: null, addedAt };
      } else {
        nodes[id] = { kind: "folder", id, parentId: parent, title: d.title, children: [], addedAt };
        (nodes[id] as BookmarkFolder).children = (d.children ?? []).map((c) => build(c, id));
      }
      return id;
    };
    const target = parentId && b.nodes[parentId]?.kind === "folder" ? parentId : roots.bar;
    const ids = drafts.map((d) => build(d, target));
    const parent = nodes[target] as BookmarkFolder;
    const children = [...parent.children];
    children.splice(Math.min(index ?? children.length, children.length), 0, ...ids);
    nodes[target] = { ...parent, children };
    set({ bookmarks: { ...b, nodes } });
    return ids;
  },

  removeBookmarks(ids) {
    const b = get().bookmarks;
    // Roots stay; a node inside another removed folder goes with it.
    const removable = ids.filter((id) => b.nodes[id]?.parentId);
    const tops = removable.filter((id) => !bookmarkAncestors(b, id).some((a) => removable.includes(a.id)));
    const places = tops.map((id) => {
      const parentId = b.nodes[id]!.parentId!;
      const parent = b.nodes[parentId];
      return { id, parentId, index: parent?.kind === "folder" ? parent.children.indexOf(id) : 0 };
    });
    const nodes = subtree(b, tops).map((id) => b.nodes[id]!);
    if (tops.length) set({ bookmarks: removeBookmarkTree(b, tops) });
    return { nodes, places };
  },

  restoreBookmarks({ nodes, places }) {
    set((s) => {
      const next = { ...s.bookmarks.nodes };
      for (const n of nodes) next[n.id] = n;
      // Put each back at its old index, in order, so siblings land where they were.
      for (const p of [...places].sort((a, b) => a.index - b.index)) {
        const parent = next[p.parentId];
        if (parent?.kind !== "folder") {
          delete next[p.id];
          continue;
        }
        const children = parent.children.filter((c) => c !== p.id);
        children.splice(Math.min(p.index, children.length), 0, p.id);
        next[p.parentId] = { ...parent, children };
      }
      return { bookmarks: { ...s.bookmarks, nodes: next } };
    });
  },

  toggleBookmark(profileId, page) {
    const s = get();
    if (!page.url) return false;
    const existing = bookmarksByUrl(s.bookmarks, profileId).get(page.url);
    if (existing?.length) {
      set({ bookmarks: removeBookmarkTree(s.bookmarks, existing) });
      return false;
    }
    get().addBookmark({ profileId, url: page.url, title: page.title, favicon: page.favicon });
    return true;
  },
});
