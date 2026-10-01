import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { engineProfile, without } from "./model";
import type { BookmarkFolder, BookmarkNode, Bookmarks } from "./types";

export type BookmarksSlice = {
  bookmarks: Bookmarks;
  // Profiles whose tree has been read from Chrome (until then it's empty, not "no bookmarks").
  bookmarksReady: Record<string, true>;

  addBookmark(options: { profileId: string; url: string; title: string; favicon?: string | null; parentId?: string; index?: number }): string;
  addBookmarkFolder(options: { profileId: string; title: string; parentId?: string; index?: number }): string;
  updateBookmark(id: string, patch: { title?: string; url?: string; favicon?: string | null }): void;
  moveBookmark(id: string, parentId: string, index?: number): void;
  removeBookmark(id: string): void;
  toggleBookmark(profileId: string, page: { url: string; title: string; favicon: string | null }): boolean;
  addBookmarkTree(profileId: string, drafts: BookmarkDraft[], parentId?: string, index?: number): string[];
  removeBookmarks(ids: string[]): RemovedBookmarks;
  restoreBookmarks(removed: RemovedBookmarks): void;
};

export type BookmarkDraft = { title: string; url?: string; addedAt?: number; children?: BookmarkDraft[] };

export type RemovedBookmarks = { nodes: BookmarkNode[]; places: { id: string; parentId: string; index: number }[] };

export const EMPTY_BOOKMARKS: Bookmarks = { nodes: {}, roots: {} };

// Bookmarks are Chrome's (BookmarkModel; lib/bookmarks.ts keeps Chrome's tree and this one alike). A node's id is
// its Chrome UUID, so sync and chrome.bookmarks name it the same way; Chrome's two permanent folders are each
// engine profile's roots.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isBookmarkUuid = (id: string) => UUID.test(id);

function uuidFrom(words: number[]): string {
  const hex = words.map((w) => (w >>> 0).toString(16).padStart(8, "0")).join("");
  // Version 4, variant 10xx: what Chrome generates.
  const v = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${v}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const newBookmarkId = () => uuidFrom(Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x1_0000_0000)));

/**
 * The UUID a bookmark saved before Chrome kept them gets, from its old id ("bm-…"), which stays its sync key: the
 * same on every Mac, so the bookmarks.json move and a synced record keyed by the old id make one bookmark. A UUID
 * stays as it is.
 */
export function bookmarkUuidFor(id: string): string {
  if (isBookmarkUuid(id)) return id;
  const text = `netnyahoo-bookmark:${id}`;
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return uuidFrom([h1, h2, h3, h4]);
}

/** An engine profile's permanent folders, as store ids. */
export const rootIdsFor = (engine: string) => ({ bar: `bar@${engine || "default"}`, other: `other@${engine || "default"}` });

export function bookmarkRoots(b: Bookmarks, profileId: string) {
  return b.roots[profileId];
}

export function ensureRoots(b: Bookmarks, profileId: string): [Bookmarks, { bar: string; other: string }] {
  const existing = b.roots[profileId];
  if (existing) return [b, existing];
  const roots = rootIdsFor(engineProfile(profileId));
  const nodes = { ...b.nodes };
  nodes[roots.bar] ??= { kind: "folder", id: roots.bar, parentId: null, title: "Bookmarks Bar", children: [], addedAt: 0 };
  nodes[roots.other] ??= { kind: "folder", id: roots.other, parentId: null, title: "Other Bookmarks", children: [], addedAt: 0 };
  return [{ nodes, roots: { ...b.roots, [profileId]: roots } }, roots];
}

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

export function folderLinks(b: Bookmarks, folderId: string): Extract<BookmarkNode, { kind: "url" }>[] {
  return folderChildren(b, folderId).flatMap((n) => (n.kind === "url" ? [n] : folderLinks(b, n.id)));
}

export const createBookmarksSlice: StateCreator<BrowserState, [], [], BookmarksSlice> = (set, get) => ({
  bookmarks: EMPTY_BOOKMARKS,
  bookmarksReady: {},

  addBookmark({ profileId, url, title, favicon = null, parentId, index }) {
    const [b, roots] = ensureRoots(get().bookmarks, profileId);
    const node: BookmarkNode = { kind: "url", id: newBookmarkId(), parentId: parentId ?? roots.bar, title, url, favicon, addedAt: Date.now() };
    set({ bookmarks: insertChild(b, node, node.parentId, index) });
    return node.id;
  },

  addBookmarkFolder({ profileId, title, parentId, index }) {
    const [b, roots] = ensureRoots(get().bookmarks, profileId);
    const node: BookmarkNode = { kind: "folder", id: newBookmarkId(), parentId: parentId ?? roots.bar, title, children: [], addedAt: Date.now() };
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
      const id = newBookmarkId();
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
