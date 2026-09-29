// Run from apps/browser:  node --import ./src/sync/test-loader.mjs --test src/sync/engine.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

// Cycles run only when the test calls syncNow.
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.__DEV__ = false;

const folder = new Map();
let onWrite = null;
let ids = 0;
globalThis.nnTestNativeModules = {
  NetnyahooSync: {
    newDeviceId: () => `dev${++ids}`,
    deviceName: () => "Test Mac",
    createPhrase: async () => true,
    createChain: async () => {},
    unlock: async () => true,
    forget: async () => {},
    chainStatus: async () => "ok",
    write: async (_folder, scope, payload) => {
      const id = `f${folder.size + 1}`;
      folder.set(id, { scope, payload });
      onWrite?.(JSON.parse(payload));
      return id;
    },
    read: async (_folder, scope, known) => {
      const here = [...folder].filter(([, f]) => f.scope === scope);
      const files = here.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
      return { files, pending: [], damaged: [], present: here.map(([id]) => id) };
    },
    remove: async (_folder, _scope, list) => list.forEach((id) => folder.delete(id)),
    sealLocal: async (text) => `sealed:${text}`,
    openLocal: async (sealed) => (sealed.startsWith("sealed:") ? sealed.slice(7) : null),
    readPasswords: async () => null,
  },
};

const shell = await import("@netnyahoo/shell");
const { useBrowser } = await import("../store/browser.ts");
const S = () => useBrowser.getState();

test("a crash after a batch lands: after the restart it's sent again as it was, and the next batch gets a new seq", async () => {
  S().hydrate({});
  const first = await import("./engine.ts?first");
  first.startSync();
  assert.ok("ok" in (await first.turnOnSync("/sync")));
  S().addBookmark({ profileId: "default", url: "https://one.example/", title: "One" });
  await first.syncNow();

  // The app quits the moment the batch with "Two" is in the folder: the disk stays as it is then.
  let disk = null;
  onWrite = (file) => {
    if (!disk && file.ops?.some((op) => op.v?.t === "Two")) disk = new Map(shell.docs);
  };
  S().addBookmark({ profileId: "default", url: "https://two.example/", title: "Two" });
  await first.syncNow();
  onWrite = null;
  assert.ok(disk);
  shell.docs.clear();
  for (const [name, contents] of disk) shell.docs.set(name, contents);

  const second = await import("./engine.ts?second");
  second.startSync();
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  S().addBookmark({ profileId: "default", url: "https://three.example/", title: "Three" });
  await second.syncNow();

  const batches = new Map();
  for (const { scope, payload } of folder.values()) {
    const file = JSON.parse(payload);
    if (file.kind !== "log") continue;
    const key = `${scope} ${file.device} ${file.seq}`;
    assert.equal(batches.get(key) ?? payload, payload, `${key} was published twice with different changes`);
    batches.set(key, payload);
  }
  const three = [...folder.values()].map((f) => JSON.parse(f.payload)).find((f) => f.ops?.some((op) => op.v?.t === "Three"));
  assert.deepEqual(three.ops.map((op) => op.v?.t), ["Three"], "only what's new");
  assert.equal(shell.docs.get("sync-journal.nns"), "", "the journal is emptied once the saved state has its batches");
});
