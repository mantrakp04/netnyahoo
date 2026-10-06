// The per-tab reads of a sidebar row outside the browser store: each wakes only the row of the tab it is about.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { usePages, patchPage, pageWatch } = await import("../components/layout/pageState.ts");
const { useMedia, setPictureInPictureState, pipWatch } = await import("../components/media/state.ts");
const { useSidebarUi, setSidebarUi, renamingWatch } = await import("../components/sidebar/state.ts");

const count = (watch, ids) => {
  const woke = Object.fromEntries(ids.map((id) => [id, 0]));
  const offs = ids.map((id) => watch.watch(id, () => woke[id]++));
  return { woke, done: () => offs.forEach((off) => off()) };
};

test("a page's state wakes that tab's readers", () => {
  usePages.setState({ pages: {}, browsers: {}, popover: {} });
  const { woke, done } = count(pageWatch, ["a", "b"]);
  patchPage("a", { blocked: 1 });
  assert.deepEqual(woke, { a: 1, b: 0 });
  patchPage("a", { blocked: 1 });
  assert.deepEqual(woke, { a: 1, b: 0 }, "the same value again");
  usePages.setState({ popover: { b: "zoom" } });
  assert.deepEqual(woke, { a: 1, b: 0 }, "other keys of the store");
  done();
  assert.equal(pageWatch.size(), 0);
});

test("Picture in Picture opening wakes that tab's badge only", () => {
  useMedia.setState({ pipOpen: {} });
  const { woke, done } = count(pipWatch, ["a", "b"]);
  setPictureInPictureState("b", { kind: "document", active: true });
  assert.deepEqual(woke, { a: 0, b: 1 });
  setPictureInPictureState("a", { kind: "document", active: false });
  assert.deepEqual(woke, { a: 0, b: 1 }, "closing what wasn't open");
  setPictureInPictureState("b", { kind: "video", active: true });
  assert.deepEqual(woke, { a: 0, b: 1 }, "open as another kind is still open");
  setPictureInPictureState("b", { kind: "video", active: false });
  assert.deepEqual(woke, { a: 0, b: 2 });
  done();
});

test("renaming wakes the row being renamed and the one that was", () => {
  useSidebarUi.setState({ renaming: null, hover: null });
  const { woke, done } = count(renamingWatch, ["a", "b", "c"]);
  setSidebarUi({ renaming: { kind: "tab", id: "a", windowId: "w" } });
  assert.deepEqual(woke, { a: 1, b: 0, c: 0 });
  setSidebarUi({ hover: { kind: "tab", id: "b", windowId: "w", anchor: { x: 0, y: 0, width: 1, height: 1 } } });
  assert.deepEqual(woke, { a: 1, b: 0, c: 0 }, "hovering doesn't wake rows");
  setSidebarUi({ renaming: { kind: "group", id: "b", windowId: "w" } });
  assert.deepEqual(woke, { a: 2, b: 0, c: 0 }, "a group's name isn't a tab's");
  setSidebarUi({ renaming: null });
  assert.deepEqual(woke, { a: 2, b: 0, c: 0 });
  done();
});
