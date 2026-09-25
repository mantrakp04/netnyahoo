// Bookmark trees (import, Bookmark All Tabs, bulk delete + undo) and history import.
// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/store/bookmarks.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { folderChildren, folderLinks, bookmarkAncestors } = await import("./bookmarks.ts");

const S = () => useBrowser.getState();
// hydrate({}) keeps the current bookmarks; start each test from an empty tree.
const reset = () => {
  useBrowser.setState({ bookmarks: { nodes: {}, roots: {} }, history: {} });
  S().hydrate({});
};
const titles = (folderId) => folderChildren(S().bookmarks, folderId).map((n) => n.title);

test("addBookmarkTree adds nested folders at an index", () => {
  reset();
  const { bar } = S().bookmarks.roots.default;
  S().addBookmark({ profileId: "default", url: "https://a.com/", title: "A" });
  const [folder] = S().addBookmarkTree(
    "default",
    [{ title: "Tabs", children: [{ title: "B", url: "https://b.com/" }, { title: "Sub", children: [{ title: "C", url: "https://c.com/" }] }] }],
    bar,
    0,
  );
  assert.deepEqual(titles(bar), ["Tabs", "A"]);
  assert.deepEqual(titles(folder), ["B", "Sub"]);
  assert.deepEqual(folderLinks(S().bookmarks, bar).map((n) => n.title), ["B", "C", "A"]);
  const c = folderLinks(S().bookmarks, folder).find((n) => n.title === "C");
  assert.deepEqual(bookmarkAncestors(S().bookmarks, c.id).map((f) => f.title), ["Sub", "Tabs", "Bookmarks Bar"]);
});

test("removeBookmarks + restoreBookmarks put everything back in place", () => {
  reset();
  const { bar } = S().bookmarks.roots.default;
  const ids = ["A", "B", "C", "D"].map((t) => S().addBookmark({ profileId: "default", url: `https://${t}.com/`, title: t }));
  const [folder] = S().addBookmarkTree("default", [{ title: "F", children: [{ title: "E", url: "https://e.com/" }] }]);
  const inner = folderChildren(S().bookmarks, folder)[0].id;
  // The folder's child goes with the folder; roots can't be removed.
  const removed = S().removeBookmarks([ids[1], ids[3], folder, inner, bar]);
  assert.equal(removed.places.length, 3);
  assert.deepEqual(titles(bar), ["A", "C"]);
  assert.equal(S().bookmarks.nodes[inner], undefined);
  S().restoreBookmarks(removed);
  assert.deepEqual(titles(bar), ["A", "B", "C", "D", "F"]);
  assert.deepEqual(titles(folder), ["E"]);
});

test("importHistory merges visits and keeps the newest first", () => {
  reset();
  S().recordVisit("default", "https://a.com/", "A", null, true);
  const added = S().importHistory("default", [
    { url: "https://a.com/", title: "Other title", visits: 3, lastVisit: 1 },
    { url: "https://old.com/", title: "Old", visits: 2, lastVisit: 5 },
    { url: "javascript:alert(1)", title: "", visits: 1, lastVisit: 9 },
  ]);
  assert.equal(added, 1);
  const list = S().history.default;
  assert.deepEqual(list.map((h) => h.url), ["https://a.com/", "https://old.com/"]);
  assert.equal(list[0].title, "A");
  assert.equal(list[0].visits, 4);
});
