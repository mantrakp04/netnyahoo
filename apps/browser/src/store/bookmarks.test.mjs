// Bookmarks are Chrome's (BookmarkModel): the store's tree and Chrome's stay alike, and bookmarks.json moved in once.
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { bookmarkUuidFor } = await import("./bookmarks.ts");
const { migrateBookmarksFile, reloadBookmarks, startBookmarks } = await import("../lib/bookmarks.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const settle = () => new Promise((r) => setTimeout(r, 0));

// Chrome's tree and the store's, as "title" for a link and { title: [...] } for a folder.
function chromeTree(profile = "") {
  const db = stub.chromeBookmarks(profile);
  const walk = (id) => {
    const n = db.get(id);
    return n.k === "u" ? `${n.t}=${n.u}` : { [n.t]: n.children.map(walk) };
  };
  return { bar: walk("bar"), other: walk("other") };
}
function storeTree(profileId = "default") {
  const b = S().bookmarks;
  const roots = b.roots[profileId];
  const walk = (id) => {
    const n = b.nodes[id];
    return n.kind === "url" ? `${n.title}=${n.url}` : { [n.title]: n.children.map(walk) };
  };
  return { bar: walk(roots.bar), other: walk(roots.other) };
}

function legacyFile() {
  const bar = "bm-bar1", other = "bm-other1";
  const node = (id, parentId, extra) => ({ id, parentId, addedAt: 5, ...extra });
  return {
    version: 2,
    bookmarks: {
      roots: { default: { bar, other }, gone: { bar: "bm-x", other: "bm-y" } },
      nodes: {
        [bar]: node(bar, null, { kind: "folder", title: "Bookmarks Bar", children: ["bm-a", "bm-f"] }),
        [other]: node(other, null, { kind: "folder", title: "Other Bookmarks", children: ["bm-c"] }),
        "bm-a": node("bm-a", bar, { kind: "url", title: "A", url: "https://a.example/", favicon: null }),
        "bm-f": node("bm-f", bar, { kind: "folder", title: "F", children: ["bm-b"] }),
        "bm-b": node("bm-b", "bm-f", { kind: "url", title: "B", url: "https://b.example/", favicon: null }),
        "bm-c": node("bm-c", other, { kind: "url", title: "C", url: "https://c.example/", favicon: null }),
      },
    },
  };
}

test("bookmarks.json moves into Chrome once, each bookmark under the UUID sync renames it to", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  stub.docs.set("bookmarks.json", JSON.stringify(legacyFile()));
  assert.equal(await migrateBookmarksFile({ keepMs: 0 }), "moved");
  const expected = { bar: { "Bookmarks Bar": ["A=https://a.example/", { F: ["B=https://b.example/"] }] }, other: { "Other Bookmarks": ["C=https://c.example/"] } };
  assert.deepEqual(chromeTree(), expected);
  assert.ok(stub.chromeBookmarks("").has(bookmarkUuidFor("bm-b")), "the UUID its old id maps to");
  assert.equal(stub.chromeBookmarks("").get(bookmarkUuidFor("bm-b")).key, "bm-b", "the old id stays its sync key");
  assert.equal(stub.docs.has("bookmarks.json"), false);

  // A launch that stopped before deleting the file moves it again: nothing is doubled, and a bookmark moved since
  // stays where it is now.
  stub.chromeBookmarkEdit("", [{ op: "move", id: bookmarkUuidFor("bm-c"), parent: "bar", index: 0 }]);
  stub.docs.set("bookmarks.json", JSON.stringify(legacyFile()));
  assert.equal(await migrateBookmarksFile({ keepMs: 0 }), "moved");
  assert.deepEqual(chromeTree(), { bar: { "Bookmarks Bar": ["C=https://c.example/", ...expected.bar["Bookmarks Bar"]] }, other: { "Other Bookmarks": [] } });
  assert.equal(await migrateBookmarksFile({ keepMs: 0 }), "none");
});

test("the store's tree and Chrome's stay alike: the app's edits go as ops, an extension's come back", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  const stop = startBookmarks();
  await settle();
  await reloadBookmarks();
  assert.ok(S().bookmarksReady.default);
  const same = () => assert.deepEqual(chromeTree(), storeTree());

  const a = S().addBookmark({ profileId: "default", url: "https://a.example/", title: "A" });
  const f = S().addBookmarkFolder({ profileId: "default", title: "F" });
  const g = S().addBookmarkFolder({ profileId: "default", title: "G", parentId: f });
  const b = S().addBookmark({ profileId: "default", url: "https://b.example/", title: "B", parentId: g });
  await settle();
  same();
  S().moveBookmark(a, f, 0);
  S().moveBookmark(g, S().bookmarks.roots.default.other);
  S().updateBookmark(b, { title: "B, renamed", url: "https://b2.example/" });
  await settle();
  same();
  // A folder deleted with a link moved out of it first.
  S().moveBookmark(a, S().bookmarks.roots.default.bar, 0);
  S().removeBookmark(f);
  await settle();
  same();
  // Undo puts the same ids back.
  const removed = S().removeBookmarks([g]);
  await settle();
  S().restoreBookmarks(removed);
  await settle();
  same();
  assert.ok(stub.chromeBookmarks("").has(b), "ids are Chrome's UUIDs");

  // An extension adds a bookmark (chrome.bookmarks): it shows in the store, and nothing echoes back.
  const sent = stub.bookmarkOpsSent.length;
  stub.chromeBookmarkEdit("", [{ op: "add", id: "0f0f0f0f-0000-4000-8000-000000000001", k: "u", t: "Ext", u: "https://ext.example/", a: 1, parent: "bar", index: 1 }]);
  await settle();
  await reloadBookmarks();
  same();
  assert.equal(S().bookmarks.nodes["0f0f0f0f-0000-4000-8000-000000000001"]?.title, "Ext");
  assert.equal(stub.bookmarkOpsSent.length, sent, "the app sends nothing back for it");
  stop();
});

test("an edit made at launch, before Chrome's tree is read, reaches Chrome and stays", async () => {
  S().hydrate({ bookmarks: { nodes: {}, roots: {} } });
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  stub.chromeBookmarkEdit("", [{ op: "add", id: "0f0f0f0f-0000-4000-8000-0000000000a1", k: "u", t: "In Chrome", u: "https://chrome.example/", a: 1, parent: "bar" }]);
  S().addBookmark({ profileId: "default", url: "https://early.example/", title: "Early" });
  const stop = startBookmarks();
  await reloadBookmarks();
  assert.deepEqual(chromeTree().bar, { "Bookmarks Bar": ["Early=https://early.example/", "In Chrome=https://chrome.example/"] });
  assert.deepEqual(storeTree(), chromeTree());
  stop();
});

test("ops Chrome can't apply (an extension moved things meanwhile) stop there: nothing the store kept is removed", async () => {
  S().hydrate({ bookmarks: { nodes: {}, roots: {} } });
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  const stop = startBookmarks();
  await reloadBookmarks();
  const b = S().addBookmarkFolder({ profileId: "default", title: "B" });
  const f = S().addBookmarkFolder({ profileId: "default", title: "F" });
  const a = S().addBookmarkFolder({ profileId: "default", title: "A", parentId: f });
  await reloadBookmarks();
  // An extension puts B inside A; before the app hears of it, the app moves A into B and deletes F.
  const db = stub.chromeBookmarks("");
  db.get("bar").children = db.get("bar").children.filter((c) => c !== b);
  db.get(a).children.push(b);
  db.get(b).parent = a;
  S().moveBookmark(a, b, 0);
  S().removeBookmark(f);
  await reloadBookmarks();
  assert.ok(db.has(a) && db.has(b), "A and B are still in Chrome");
  assert.deepEqual(storeTree(), chromeTree(), "the store shows Chrome's tree");
  stop();
});
