import { applyBookmarkOps, bookmarkTree, onBookmarksChanged, watchBookmarks, type BookmarkOp, type EngineBookmark } from "@netnyahoo/cef";
import { readDocument, removeDocument } from "@netnyahoo/shell";
import { bookmarkUuidFor, isBookmarkUuid, rootIdsFor } from "../store/bookmarks";
import { useBrowser, type BrowserState } from "../store/browser";
import { engineProfile, isIncognitoProfile } from "../store/model";
import type { BookmarkFolder, BookmarkNode, Bookmarks } from "../store/types";

// Bookmarks are Chrome's (BookmarkModel), so chrome.bookmarks and the app see one tree. The store's `bookmarks`
// stays the app's model of it (its UI, sync and imports change it as before); this keeps the two alike:
// - each engine profile's tree is read from Chrome at launch and again when anything else changes it (an
//   extension, Chrome's own UI);
// - each change to the store's tree goes to Chrome as the ops that make Chrome's tree the same (`shadow` is what
//   Chrome has; the app's own ops raise no event there).
// Once, it moves the app's old bookmarks.json into Chrome.

const LEGACY_FILE = "bookmarks.json";
// Chrome saves its bookmarks file a moment after a change; the old file stays until then, so a crash before it
// moves it again (adding only what Chrome lacks).
const LEGACY_KEPT_MS = 10_000;
const store = () => useBrowser.getState();

// MARK: Trees

type FlatNode = { kind: "url" | "folder"; parent: string | null; title: string; url?: string; addedAt: number; key?: string };
/** A tree as the diff reads it: each node's place and fields, and each folder's children in order. */
export type Flat = { nodes: Map<string, FlatNode>; children: Map<string, string[]> };

const emptyFlat = (): Flat => ({ nodes: new Map(), children: new Map() });
const cloneFlat = (f: Flat): Flat => ({ nodes: new Map(f.nodes), children: new Map([...f.children].map(([id, c]) => [id, [...c]])) });

/** The store's tree under an engine profile's roots. A node reachable twice (a broken tree) counts once. */
export function flatFromStore(b: Bookmarks, engine: string): Flat {
  const roots = rootIdsFor(engine);
  const flat = emptyFlat();
  const walk = (id: string, parent: string | null) => {
    const node = b.nodes[id];
    if (!node || flat.nodes.has(id)) return;
    flat.nodes.set(id, {
      kind: node.kind,
      parent,
      title: node.title,
      ...(node.kind === "url" ? { url: node.url } : {}),
      addedAt: node.addedAt,
      ...(node.syncKey ? { key: node.syncKey } : {}),
    });
    if (node.kind !== "folder") return;
    const kids: string[] = [];
    for (const c of node.children) {
      if (!b.nodes[c] || flat.nodes.has(c)) continue;
      walk(c, id);
      kids.push(c);
    }
    flat.children.set(id, kids);
  };
  walk(roots.bar, null);
  walk(roots.other, null);
  return flat;
}

function flatFromEngine(tree: { bar: EngineBookmark; other: EngineBookmark }, engine: string): Flat {
  const roots = rootIdsFor(engine);
  const flat = emptyFlat();
  const walk = (node: EngineBookmark, id: string, parent: string | null) => {
    flat.nodes.set(id, {
      kind: node.k === "u" ? "url" : "folder",
      parent,
      title: node.t,
      ...(node.k === "u" ? { url: node.u ?? "" } : {}),
      addedAt: node.a,
      ...(node.key ? { key: node.key } : {}),
    });
    if (node.k === "f") {
      flat.children.set(id, (node.c ?? []).map((c) => c.id));
      for (const c of node.c ?? []) walk(c, c.id, id);
    }
  };
  walk(tree.bar, roots.bar, null);
  walk(tree.other, roots.other, null);
  return flat;
}

const opParent = (engine: string, id: string) => {
  const roots = rootIdsFor(engine);
  return id === roots.bar ? "bar" : id === roots.other ? "other" : id;
};
const flatParent = (engine: string, id: string) => {
  const roots = rootIdsFor(engine);
  return id === "bar" ? roots.bar : id === "other" ? roots.other : id;
};

/**
 * The ops that turn `from` into `to`: adds and moves top-down, so each folder is in place before what goes into
 * it, then removals of what's left, topmost first. A move's index is the node's index once moved.
 */
export function bookmarkOps(from: Flat, to: Flat, engine: string): BookmarkOp[] {
  const roots = rootIdsFor(engine);
  const parentOf = new Map([...from.nodes].map(([id, n]) => [id, n.parent]));
  const kids = new Map([...from.children].map(([id, c]) => [id, [...c]]));
  const ops: BookmarkOp[] = [];
  const queue = [roots.bar, roots.other];
  while (queue.length) {
    const folder = queue.shift()!;
    if (!kids.has(folder)) kids.set(folder, []);
    (to.children.get(folder) ?? []).forEach((id, index) => {
      const node = to.nodes.get(id)!;
      const was = from.nodes.get(id);
      const current = kids.get(folder)!;
      if (!parentOf.has(id)) {
        ops.push({
          op: "add",
          id,
          k: node.kind === "url" ? "u" : "f",
          t: node.title,
          ...(node.url !== undefined ? { u: node.url } : {}),
          a: node.addedAt,
          ...(node.key ? { key: node.key } : {}),
          parent: opParent(engine, folder),
          index,
        });
        current.splice(index, 0, id);
        parentOf.set(id, folder);
        if (node.kind === "folder") kids.set(id, []);
      } else {
        if (parentOf.get(id) !== folder || current.indexOf(id) !== index) {
          const old = kids.get(parentOf.get(id)!);
          if (old) old.splice(old.indexOf(id), 1);
          current.splice(index, 0, id);
          parentOf.set(id, folder);
          ops.push({ op: "move", id, parent: opParent(engine, folder), index });
        }
        if (was && (was.title !== node.title || (node.url !== undefined && was.url !== node.url))) {
          ops.push({ op: "update", id, t: node.title, ...(node.url !== undefined ? { u: node.url } : {}) });
        }
      }
      if (node.kind === "folder") queue.push(id);
    });
  }
  for (const [id, n] of from.nodes) {
    if (to.nodes.has(id) || n.parent === null) continue;
    let under = false;
    for (let at = parentOf.get(id); at; at = parentOf.get(at)) if (!to.nodes.has(at)) under = true;
    if (!under) ops.push({ op: "remove", id });
  }
  return ops;
}

/**
 * `ops` applied to a tree as Chrome applies them (nn_bookmarks_apply): in order, stopping at the first that can't
 * apply. For merging the app's edits into a tree read from Chrome meanwhile.
 */
export function applyOps(tree: Flat, ops: BookmarkOp[], engine: string): Flat {
  const flat = cloneFlat(tree);
  const detach = (id: string) => {
    const parent = flat.nodes.get(id)?.parent;
    const list = parent ? flat.children.get(parent) : undefined;
    if (list) list.splice(list.indexOf(id), 1);
  };
  const attach = (id: string, parent: string, index: number | undefined) => {
    const list = flat.children.get(parent)!;
    list.splice(Math.max(0, Math.min(index ?? list.length, list.length)), 0, id);
    flat.nodes.set(id, { ...flat.nodes.get(id)!, parent });
  };
  const inside = (id: string, of: string) => {
    for (let at: string | null | undefined = of; at; at = flat.nodes.get(at)?.parent) if (at === id) return true;
    return false;
  };
  for (const op of ops) {
    const node = flat.nodes.get(op.id);
    if (op.op === "remove") {
      if (!node || node.parent === null) break;
      detach(op.id);
      const drop = (id: string) => {
        for (const c of flat.children.get(id) ?? []) drop(c);
        flat.nodes.delete(id);
        flat.children.delete(id);
      };
      drop(op.id);
      continue;
    }
    if (op.op === "update") {
      if (!node || node.parent === null) break;
      flat.nodes.set(op.id, { ...node, ...(op.t !== undefined ? { title: op.t } : {}), ...(op.u && node.kind === "url" ? { url: op.u } : {}) });
      continue;
    }
    const parent = flatParent(engine, op.parent);
    if (flat.nodes.get(parent)?.kind !== "folder") break;
    if (op.op === "move" || node) {
      if (!node || node.parent === null || inside(op.id, parent)) break;
      detach(op.id);
      attach(op.id, parent, op.index);
      if (op.op === "add") flat.nodes.set(op.id, { ...flat.nodes.get(op.id)!, title: op.t, ...(op.u && node.kind === "url" ? { url: op.u } : {}) });
      continue;
    }
    flat.nodes.set(op.id, {
      kind: op.k === "u" ? "url" : "folder",
      parent,
      title: op.t,
      ...(op.k === "u" ? { url: op.u ?? "" } : {}),
      addedAt: op.a,
      ...(op.key ? { key: op.key } : {}),
    });
    if (op.k === "f") flat.children.set(op.id, []);
    attach(op.id, parent, op.index);
  }
  return flat;
}

// MARK: Keeping them alike

type EngineState = {
  shadow: Flat | null;
  // Ops sent: a read that started before some was made against an older tree.
  sent: number;
  reading: Promise<void> | null;
  again: boolean;
};
const engines = new Map<string, EngineState>();
const stateOf = (engine: string) => {
  let state = engines.get(engine);
  if (!state) engines.set(engine, (state = { shadow: null, sent: 0, reading: null, again: false }));
  return state;
};

const engineProfiles = (s: Pick<BrowserState, "profiles">) =>
  [...new Set(Object.keys(s.profiles).filter((id) => !isIncognitoProfile(id)).map(engineProfile))];
const profilesUsing = (s: Pick<BrowserState, "profiles">, engine: string) =>
  Object.keys(s.profiles).filter((id) => !isIncognitoProfile(id) && engineProfile(id) === engine);

// Puts a tree in the store: the engine's subtree is replaced; icons the store knew stay.
function adopt(engine: string, flat: Flat) {
  useBrowser.setState((s) => {
    const roots = rootIdsFor(engine);
    const old = flatFromStore(s.bookmarks, engine);
    const nodes = { ...s.bookmarks.nodes };
    for (const id of old.nodes.keys()) delete nodes[id];
    for (const [id, n] of flat.nodes) {
      const was = s.bookmarks.nodes[id];
      const key = n.key ? { syncKey: n.key } : {};
      nodes[id] =
        n.kind === "url"
          ? { kind: "url", id, parentId: n.parent!, title: n.title, url: n.url ?? "", favicon: was?.kind === "url" ? was.favicon : null, addedAt: n.addedAt, ...key }
          : ({ kind: "folder", id, parentId: n.parent, title: n.title, children: flat.children.get(id) ?? [], addedAt: n.addedAt, ...key } satisfies BookmarkFolder);
    }
    nodes[roots.bar] = { ...(nodes[roots.bar] as BookmarkFolder), title: "Bookmarks Bar" };
    nodes[roots.other] = { ...(nodes[roots.other] as BookmarkFolder), title: "Other Bookmarks" };
    const ids = profilesUsing(s, engine);
    return {
      bookmarks: { nodes, roots: { ...s.bookmarks.roots, ...Object.fromEntries(ids.map((id) => [id, roots])) } },
      bookmarksReady: { ...s.bookmarksReady, ...Object.fromEntries(ids.map((id) => [id, true as const])) },
    };
  });
}

function send(engine: string, ops: BookmarkOp[]) {
  if (!ops.length) return;
  const state = stateOf(engine);
  state.sent++;
  void applyBookmarkOps(engine, ops).then(
    (result) => {
      // Chrome stopped at an op it couldn't apply (its tree had changed): its tree wins.
      if (result.skipped) void read(engine);
    },
    (error) => {
      console.warn("[bookmarks] couldn't save to Chrome", error);
      void read(engine);
    },
  );
}

function read(engine: string): Promise<void> {
  const state = stateOf(engine);
  if (state.reading) {
    state.again = true;
    return state.reading;
  }
  state.reading = (async () => {
    try {
      do {
        state.again = false;
        const sentBefore = state.sent;
        // What the store had when the read started: its edits after that are made again on what Chrome has.
        const base = flatFromStore(store().bookmarks, engine);
        await watchBookmarks(engine);
        const fetched = flatFromEngine(await bookmarkTree(engine), engine);
        if (state.sent !== sentBefore) {
          state.again = true;
          continue;
        }
        // The app's edits since the read started, made again on Chrome's tree (and sent, as `push` held them).
        const edits = bookmarkOps(base, flatFromStore(store().bookmarks, engine), engine);
        const merged = edits.length ? applyOps(fetched, edits, engine) : fetched;
        state.shadow = merged;
        adopt(engine, merged);
        send(engine, edits);
      } while (state.again);
    } catch (error) {
      console.warn(`[bookmarks] couldn't read ${engine || "the default profile"}'s bookmarks`, error);
    } finally {
      state.reading = null;
    }
  })();
  return state.reading;
}

function push(s: BrowserState) {
  for (const engine of engineProfiles(s)) {
    const state = stateOf(engine);
    // Edits made while a read is out are merged when it lands.
    if (!state.shadow || state.reading) continue;
    const desired = flatFromStore(s.bookmarks, engine);
    if (!desired.nodes.size) continue;
    const ops = bookmarkOps(state.shadow, desired, engine);
    state.shadow = desired;
    send(engine, ops);
  }
}

// MARK: The old file

/**
 * Adds bookmarks.json's trees to Chrome: each bookmark under the UUID its old id maps to, with the old id as its
 * sync key, so records synced under it still name it. A bookmark Chrome already has (a second run) is left where
 * it is. The file goes once Chrome has saved; a failed add keeps it for the next launch. Profiles that no longer
 * exist are dropped.
 */
export async function migrateBookmarksFile({ keepMs = LEGACY_KEPT_MS } = {}): Promise<"none" | "moved" | "kept"> {
  let file: { bookmarks?: Bookmarks } | null = null;
  try {
    const json = readDocument(LEGACY_FILE);
    file = json ? JSON.parse(json) : null;
  } catch (error) {
    console.warn(`[bookmarks] ${LEGACY_FILE} is unreadable; leaving it`, error);
    return "kept";
  }
  if (!file) return "none";
  const b = file.bookmarks ?? { nodes: {}, roots: {} };
  const s = store();
  const done = new Set<string>();
  try {
    for (const [profileId, roots] of Object.entries(b.roots ?? {})) {
      if (!s.profiles[profileId] || isIncognitoProfile(profileId)) continue;
      const engine = engineProfile(profileId);
      if (done.has(engine)) continue;
      done.add(engine);
      const ops: BookmarkOp[] = [];
      const seen = new Set<string>();
      const walk = (folderId: string, parent: string) => {
        const folder = b.nodes[folderId];
        if (folder?.kind !== "folder") return;
        folder.children.forEach((childId, index) => {
          const node: BookmarkNode | undefined = b.nodes[childId];
          if (!node || seen.has(node.id)) return;
          seen.add(node.id);
          const id = bookmarkUuidFor(node.id);
          const key = node.syncKey ?? (isBookmarkUuid(node.id) ? undefined : node.id);
          const common = { op: "add" as const, id, t: node.title, a: node.addedAt, ...(key ? { key } : {}), parent, index, ifAbsent: true };
          ops.push(node.kind === "url" ? { ...common, k: "u", u: node.url } : { ...common, k: "f" });
          if (node.kind === "folder") walk(node.id, id);
        });
      };
      walk(roots.bar, "bar");
      walk(roots.other, "other");
      if (!ops.length) continue;
      // An add with a URL Chrome can't keep is dropped; anything else that fails keeps the file.
      const result = await applyBookmarkOps(engine, ops);
      if (result.skipped) throw new Error(`${result.skipped} of ${ops.length} bookmarks couldn't be added`);
    }
  } catch (error) {
    console.warn(`[bookmarks] moving ${LEGACY_FILE} into Chrome failed; trying again next launch`, error);
    return "kept";
  }
  if (keepMs) setTimeout(() => removeDocument(LEGACY_FILE), keepMs);
  else removeDocument(LEGACY_FILE);
  return "moved";
}

// MARK: Start

export function startBookmarks() {
  const changes = onBookmarksChanged((engine) => {
    if (stateOf(engine).shadow) void read(engine);
  });
  let stopped = false;
  void migrateBookmarksFile().then(() => {
    if (!stopped) for (const engine of engineProfiles(store())) void read(engine);
  });
  const stop = useBrowser.subscribe((s, prev) => {
    if (s.profiles !== prev.profiles) {
      for (const engine of engineProfiles(s)) if (!stateOf(engine).shadow && !stateOf(engine).reading) void read(engine);
    }
    if (s.bookmarks !== prev.bookmarks) push(s);
  });
  return () => {
    stopped = true;
    changes.remove();
    stop();
  };
}

/** Reads every profile's bookmarks from Chrome again (the dev harness, tests). */
export const reloadBookmarks = () => Promise.all(engineProfiles(store()).map(read));
