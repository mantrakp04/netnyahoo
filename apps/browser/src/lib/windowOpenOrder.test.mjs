// The order windows open in (lib/windowOpenOrder.ts): at launch the focused window first and the others behind it, in
// the stack the focus order describes; later, the focused one last (as before).
import assert from "node:assert/strict";
import { test } from "node:test";

const { windowOpens } = await import("./windowOpenOrder.ts");

const state = (order, focused) => ({
  windowOrder: order,
  windows: Object.fromEntries(order.map((id) => [id, { id }])),
  ui: { focusedWindowId: focused },
});

test("launch: the focused window first, the rest behind it in window order", () => {
  assert.deepEqual(windowOpens(state(["a", "b", "c", "d"], "b"), ["a", "b", "c", "d"], true), [
    { id: "b", focus: true },
    { id: "a", focus: false, behind: "b" },
    { id: "c", focus: false, behind: "b" },
    { id: "d", focus: false, behind: "b" },
  ]);
});

test("each opened right under the focused one leaves the stack the focus order has", () => {
  // Front to back after placing each directly below the focused window.
  const opens = windowOpens(state(["a", "b", "c", "d"], "b"), ["a", "b", "c", "d"], true);
  const stack = [opens[0].id];
  for (const o of opens.slice(1)) stack.splice(stack.indexOf(o.behind) + 1, 0, o.id);
  // ui.focusOrder as hydrate builds it: the focused, then windowOrder's others newest first.
  assert.deepEqual(stack, ["b", "d", "c", "a"]);
});

test("one window, or no focused one", () => {
  assert.deepEqual(windowOpens(state(["a"], "a"), ["a"], true), [{ id: "a", focus: true }]);
  assert.deepEqual(windowOpens(state(["a", "b"], null), ["a", "b"], true), [{ id: "a", focus: false }, { id: "b", focus: false }]);
  assert.deepEqual(windowOpens(state(["a", "b"], "gone"), ["a", "b"], true), [{ id: "a", focus: false }, { id: "b", focus: false }]);
});

test("after launch: only the windows asked for, the focused one last so it comes to front", () => {
  assert.deepEqual(windowOpens(state(["a", "b", "c"], "c"), ["c"], false), [{ id: "c", focus: true }]);
  assert.deepEqual(windowOpens(state(["a", "b", "c"], "a"), ["c"], false), [{ id: "c", focus: false }]);
  assert.deepEqual(windowOpens(state(["a", "b", "c"], "c"), ["b", "c"], false), [{ id: "b", focus: false }, { id: "c", focus: true }]);
});

test("switched off (focusedWindowFirst): a launch opens them as before, the focused one last", async () => {
  const { docs } = await import("../test-native-stub.mjs");
  const ks = await import("./killSwitches.ts");
  docs.set("switches-cache.json", JSON.stringify({ version: 1, switches: { focusedWindowFirst: false } }));
  ks.reloadSwitches();
  try {
    assert.deepEqual(windowOpens(state(["a", "b", "c"], "b"), ["a", "b", "c"], true), [
      { id: "a", focus: false },
      { id: "c", focus: false },
      { id: "b", focus: true },
    ]);
  } finally {
    docs.delete("switches-cache.json");
    ks.reloadSwitches();
  }
});
