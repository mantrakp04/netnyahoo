// The kill switches over the bar's preloading (lib/killSwitches.ts: omniboxPreload, newTabPrewarm): on, as lib/preload.test.mjs;
// off, the old behaviour (the bar tells the engine nothing, a New Tab page's tab is made by Enter).
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { docs } = await import("../test-native-stub.mjs");
const { useBrowser } = await import("../store/browser.ts");
const preload = await import("./preload.ts");
preload.setEngineForTests(true);
const ks = await import("./killSwitches.ts");

let calls = [];
globalThis.nnTestEngineCall = (name, profile, args) => {
  calls.push({ name, profile, ...args });
  return Promise.resolve({});
};
const setSwitches = (switches) => {
  docs.set("switches-cache.json", JSON.stringify({ version: 1, switches }));
  ks.reloadSwitches();
};
const setup = () => {
  useBrowser.getState().hydrate({});
  const w = useBrowser.getState().createWindow({ url: "https://a.com" });
  calls = [];
  return useBrowser.getState().windows[w].tabIds[0];
};
const page = (url) => ({ kind: "page", url, title: "", favicon: null, visited: true });

test("omniboxPreload on: typing and opening reach the engine", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  setSwitches({});
  const tab = setup();
  preload.barTyped(tab, "git", [page("https://github.com/")], 0);
  preload.barOpened(tab, "https://github.com/");
  assert.deepEqual(calls.map((c) => c.name), ["nn_omnibox_typed", "nn_omnibox_opened"]);
});

test("omniboxPreload off: the bar tells the engine nothing, however it's used", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  setSwitches({ omniboxPreload: false });
  const tab = setup();
  preload.barTyped(tab, "git", [page("https://github.com/")], 0);
  t.mock.timers.tick(500);
  preload.barOpened(tab, "https://github.com/");
  preload.barTyped(tab, "gi", [page("https://github.com/")], 0);
  preload.barOpened(tab, "");
  assert.deepEqual(calls, []);
});

test("omniboxPreload turned off while text waits: the waiting call is dropped", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  setSwitches({});
  const tab = setup();
  preload.barTyped(tab, "git", [page("https://github.com/")], 0);
  setSwitches({ omniboxPreload: false });
  t.mock.timers.tick(500);
  assert.deepEqual(calls, []);
});

test("newTabPrewarm follows its switch (and the bench's own setting)", () => {
  setSwitches({});
  assert.equal(preload.newTabPrewarmOn(), true);
  setSwitches({ newTabPrewarm: false });
  assert.equal(preload.newTabPrewarmOn(), false);
  setSwitches({});
  preload.setNewTabPrewarm(false);
  assert.equal(preload.newTabPrewarmOn(), false);
  preload.setNewTabPrewarm(true);
  assert.equal(preload.newTabPrewarmOn(), true);
});
