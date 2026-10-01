// Page reports held at the bridge (lib/nativeEvents.ts): they replay in order, as one batch, before anything else runs.
import assert from "node:assert/strict";
import { test } from "node:test";
const { afterHeldReports, createHold, holdPageReports } = await import("./nativeEvents.ts");

function setup() {
  const log = [];
  const hooks = {};
  const bridge = {
    __callFunction: (module, method, args) => {
      if (args[2]?.throws) throw new Error(args[2].throws);
      log.push(module === "RCTEventEmitter" ? args[1] : `${module}.${method}`);
      // A handler that sets off a native module's listener, which applies what's held first.
      if (args[2]?.reenter) {
        hooks.flush();
        log.push("listener");
      }
    },
    __invokeCallback: (id) => log.push(`callback ${id}`),
  };
  const scheduled = [];
  const errors = [];
  let depth = 0;
  const batch = (update) => {
    if (!depth) log.push("[");
    depth++;
    try {
      update();
    } finally {
      depth--;
      if (!depth) log.push("]");
    }
  };
  const held = createHold({ batch, schedule: (callback) => scheduled.push(callback), report: (e) => errors.push(e.message) });
  holdPageReports(bridge, held);
  hooks.flush = held.flush;
  const event = (name, body = {}) => bridge.__callFunction("RCTEventEmitter", "receiveEvent", [1, name, body]);
  return { log, bridge, scheduled, errors, held, event };
}

test("page reports wait for the calls queued behind them, then apply in order as one batch", () => {
  const { log, scheduled, event } = setup();
  event("topNavigationChange");
  event("topProgress");
  event("topFavicon");
  assert.deepEqual(log, [], "held");
  assert.equal(scheduled.length, 1, "one flush scheduled for the run");
  scheduled[0]();
  assert.deepEqual(log, ["[", "topNavigationChange", "topProgress", "topFavicon", "]"]);
  scheduled[0]();
  assert.equal(log.length, 5, "a second flush has nothing left");
});

test("anything else applies the held reports before it runs: events, timers, callbacks", () => {
  const { log, bridge, scheduled, event } = setup();
  event("topNavigationChange");
  event("topOpenWindow");
  assert.deepEqual(log, ["[", "topNavigationChange", "]", "topOpenWindow"], "a page opening a window isn't held, and comes after");
  event("topProgress");
  bridge.__callFunction("JSTimers", "callTimers", [[1]]);
  event("topStatus");
  bridge.__invokeCallback(7, []);
  assert.deepEqual(log.slice(4), ["[", "topProgress", "]", "JSTimers.callTimers", "[", "topStatus", "]", "callback 7"]);
  assert.equal(scheduled.length, 3, "a new run after each flush schedules its own");
});

test("a report that throws doesn't drop the ones after it, and is reported from a task of its own", () => {
  const { log, errors, scheduled, event } = setup();
  event("topNavigationChange", { throws: "boom" });
  event("topProgress");
  scheduled[0]();
  assert.deepEqual(log, ["[", "topProgress", "]"]);
  assert.deepEqual(errors, []);
  scheduled[1]();
  assert.deepEqual(errors, ["boom"]);
});

test("a flush set off while one runs applies the rest first, in the same batch", () => {
  const { log, scheduled, event } = setup();
  event("topNavigationChange", { reenter: true });
  event("topProgress");
  event("topFavicon");
  scheduled[0]();
  assert.deepEqual(log, ["[", "topNavigationChange", "topProgress", "topFavicon", "listener", "]"]);
});

test("a reporter that throws can't drop reports or the call that applied them", () => {
  const log = [];
  const bridge = {
    __callFunction: (_m, method, args) => {
      if (args[2]?.throws) throw new Error("boom");
      log.push(args[1] ?? method);
    },
    __invokeCallback: (id) => log.push(`callback ${id}`),
  };
  const scheduled = [];
  holdPageReports(bridge, createHold({ batch: (u) => u(), schedule: (c) => scheduled.push(c), report: () => { throw new Error("reporter"); } }));
  bridge.__callFunction("RCTEventEmitter", "receiveEvent", [1, "topNavigationChange", { throws: true }]);
  bridge.__callFunction("RCTEventEmitter", "receiveEvent", [1, "topProgress", {}]);
  bridge.__invokeCallback(7, []);
  assert.deepEqual(log, ["topProgress", "callback 7"]);
  assert.throws(() => scheduled[1](), /reporter/, "the reporter's own error surfaces in its task");
  bridge.__callFunction("RCTEventEmitter", "receiveEvent", [1, "topMedia", { throws: true }]);
  bridge.__callFunction("RCTEventEmitter", "receiveEvent", [1, "topStatus", { throws: true }]);
  scheduled[2]();
  assert.equal(scheduled.length, 5, "two errors, two tasks: one throwing reporter can't swallow the other");
  bridge.__callFunction("RCTEventEmitter", "receiveEvent", [1, "topStatus", {}]);
  scheduled[5]();
  assert.deepEqual(log, ["topProgress", "callback 7", "topStatus"], "and the queue starts afresh");
});

test("a native module's listener runs after the held reports, in one batch with them", () => {
  const { log, held, scheduled, event } = setup();
  const added = new Map();
  const emitter = {
    addListener(name, listener) {
      added.set(name, [...(added.get(name) ?? []), listener]);
      return { remove: () => added.set(name, added.get(name).filter((l) => l !== listener)) };
    },
    removeListener(name, listener) {
      added.set(name, added.get(name).filter((l) => l !== listener));
    },
  };
  afterHeldReports(emitter, held);
  const emit = (name, ...args) => added.get(name)?.forEach((l) => l(...args));
  const onStrip = (tx) => log.push(`strip ${tx.rev}`);
  emitter.addListener("onTabStrip", onStrip);
  event("topNavigationChange");
  emit("onTabStrip", { rev: 4 });
  assert.deepEqual(log, ["[", "topNavigationChange", "strip 4", "]"]);
  emitter.removeListener("onTabStrip", onStrip);
  emit("onTabStrip", { rev: 5 });
  assert.equal(log.length, 4, "removeListener with the listener the app added removes it");
  const sub = emitter.addListener("onDownload", (d) => log.push(`download ${d}`));
  sub.remove();
  emit("onDownload", 1);
  assert.equal(log.length, 4, "and so does its subscription");
});
