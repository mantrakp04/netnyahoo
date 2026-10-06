// The New Tab page's prewarm (lib/preload.ts): on only with an engine that has its fixes (it answers nn_omnibox_opened),
// and only while its kill switch and the bench's own setting say so.
import assert from "node:assert/strict";
import { mock, test } from "node:test";

globalThis.__DEV__ = false;
const { docs } = await import("../test-native-stub.mjs");
const ks = await import("./killSwitches.ts");

let calls = [];
let answer = () => Promise.resolve({});
globalThis.nnTestEngineCall = (name, profile, args) => {
  calls.push({ name, profile, ...args });
  return answer(name);
};
// The module asks the engine once, 1.5 s after it loads: on mocked timers, so each test drives the probe itself.
mock.timers.enable({ apis: ["setTimeout"] });
const preload = await import("./preload.ts");
const settle = () => new Promise((r) => setImmediate(r));
const setSwitches = (switches) => {
  docs.set("switches-cache.json", JSON.stringify({ version: 1, switches }));
  ks.reloadSwitches();
};

test("the engine is asked once, a moment after launch, with a call that changes nothing", async () => {
  // A profile that isn't loaded yet: asked again.
  answer = () => Promise.reject(new Error("profile not loaded"));
  assert.equal(preload.newTabPrewarmOn(), false);
  mock.timers.tick(1500);
  await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { name: "nn_omnibox_opened", profile: "" });
  assert.equal(preload.newTabPrewarmOn(), false);
  answer = () => Promise.resolve({ prewarm: 2 });
  mock.timers.tick(1500);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(preload.engineHasPrewarmFixes(), true);
  mock.timers.tick(10_000);
  await settle();
  assert.equal(calls.length, 2);
});

test("newTabPrewarm follows its switch (and the bench's own setting)", () => {
  preload.setEngineForTests(true);
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

test("an engine that answers without the window-close fix ({}, 5c9d0422's) makes no page ahead", async () => {
  // A fresh copy of the module (its own probe), on that engine.
  answer = () => Promise.resolve({});
  const older = await import(`./preload.ts?older`);
  mock.timers.tick(1500);
  await settle();
  assert.equal(older.engineHasPrewarmFixes(), false);
  assert.equal(older.newTabPrewarmOn(), false);
});

test("an engine without the fixes (it doesn't know the call): no prewarm", () => {
  preload.setEngineForTests(false);
  setSwitches({});
  assert.equal(preload.newTabPrewarmOn(), false);
});
