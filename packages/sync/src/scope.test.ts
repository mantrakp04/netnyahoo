import assert from "node:assert/strict";
import { test } from "node:test";
import { Clock, formatHLC, hlcWall, parseHLC } from "./hlc.ts";
import { assignPositions, positionBetween } from "./order.ts";
import { compact, emptyScope, syncScope, type Adapter, type Listing, type ScopeOptions, type ScopeState, type Transport } from "./scope.ts";

// A shared folder in memory. A file can be hidden (not synced to this Mac yet) or cut short
// (still being copied): readers see it as pending or damaged, as the native layer reports.
type Entry = { payload: string; hiddenFrom: Set<string>; partialFor: Set<string>; at: number };
class Folder {
  scopes = new Map<string, Map<string, Entry>>();
  counter = 0;
  now = 0;
  scope(name: string) {
    let s = this.scopes.get(name);
    if (!s) this.scopes.set(name, (s = new Map()));
    return s;
  }
  transport(device: string): Transport {
    return {
      write: async (scope, payload) => {
        const id = `f${++this.counter}`;
        this.scope(scope).set(id, { payload, hiddenFrom: new Set(), partialFor: new Set(), at: this.now });
        return id;
      },
      read: async (scope, known): Promise<Listing> => {
        const listing: Listing = { files: [], pending: [], damaged: [], present: [] };
        for (const [id, e] of this.scope(scope)) {
          listing.present.push(id);
          if (known.includes(id)) continue;
          if (e.hiddenFrom.has(device)) listing.pending.push(id);
          else if (e.partialFor.has(device)) listing.damaged.push({ id, age: 0 });
          else listing.files.push({ id, payload: e.payload });
        }
        return listing;
      },
      remove: async (scope, ids) => {
        for (const id of ids) this.scope(scope).delete(id);
      },
    };
  }
  fileCount(scope = "s") {
    return this.scope(scope).size;
  }
}

/** A device with a key-value store synced under "x:" (and settings-like "set:" keys). */
class Device {
  store = new Map<string, unknown>();
  settings = new Map<string, unknown>();
  state: ScopeState = emptyScope();
  clock: Clock;
  offset = 0;
  onRead?: () => void;
  readonly id: string;
  readonly folder: Folder;
  readonly options: ScopeOptions;
  constructor(id: string, folder: Folder, options: ScopeOptions = {}) {
    this.id = id;
    this.folder = folder;
    this.options = options;
    this.clock = new Clock(id, null, () => this.time());
  }
  time() {
    return this.folder.now + this.offset;
  }
  adapters(): Adapter[] {
    return [
      {
        prefix: "x:",
        extract: () => ({ values: new Map(this.store) }),
        apply: (visible, changed) => {
          for (const k of changed) visible.has(k) ? this.store.set(k, visible.get(k)) : this.store.delete(k);
        },
      },
      {
        prefix: "set:",
        adoptRemoteOnJoin: true,
        extract: () => ({ values: new Map(this.settings) }),
        apply: (visible, changed) => {
          for (const k of changed) if (visible.has(k)) this.settings.set(k, visible.get(k));
        },
      },
    ];
  }
  async sync() {
    const base = this.folder.transport(this.id);
    const transport: Transport = {
      ...base,
      read: async (scope, known) => {
        const listing = await base.read(scope, known);
        this.onRead?.();
        return listing;
      },
    };
    return syncScope({
      scope: "s",
      state: this.state,
      transport,
      adapters: this.adapters(),
      clock: this.clock,
      device: this.id,
      now: () => this.time(),
      options: { pruneGrace: 0, ...this.options },
    });
  }
  /** The state survives a relaunch as JSON. */
  relaunch() {
    this.state = JSON.parse(JSON.stringify(this.state)) as ScopeState;
    this.clock = new Clock(this.id, this.clock.last, () => this.time());
  }
}

const snapshot = (d: Device) => Object.fromEntries([...d.store].sort(([a], [b]) => a.localeCompare(b)));
async function syncAll(devices: Device[], rounds = 2) {
  for (let i = 0; i < rounds; i++) for (const d of devices) await d.sync();
}

test("hybrid logical clocks order by wall time, then counter, then device", () => {
  let t = 1000;
  const clock = new Clock("a", null, () => t);
  const first = clock.tick();
  const second = clock.tick();
  assert.ok(second > first);
  assert.deepEqual(parseHLC(second), { wall: 1000, counter: 1, device: "a" });
  t = 900; // the wall clock went back
  assert.ok(clock.tick() > second);
  clock.observe(formatHLC(5000, 3, "b"));
  const after = clock.tick();
  assert.ok(after > formatHLC(5000, 3, "b"));
  assert.equal(hlcWall(after), 5000);
  // Backdated for data made earlier; doesn't move the clock.
  assert.equal(hlcWall(clock.at(200)), 200);
  assert.ok(clock.tick() > after);
});

test("positions sort in list order and keep what they can", () => {
  let keys: string[] = [];
  let prev = "";
  for (let i = 0; i < 200; i++) {
    const k = positionBetween(prev, null);
    assert.ok(k > prev);
    keys.push((prev = k));
  }
  for (let i = 0; i < 200; i++) {
    const a = keys[i]!;
    const b = keys[i + 1] ?? null;
    const m = positionBetween(a, b);
    assert.ok(m > a && (b === null || m < b), `${a} < ${m} < ${b}`);
    assert.ok(!m.endsWith("0"));
  }
  // Squeezing repeatedly into the same gap stays ordered.
  let lo = "a";
  const hi = "b";
  for (let i = 0; i < 100; i++) {
    lo = positionBetween(lo, hi);
    assert.ok(lo > "a" && lo < hi);
  }
  keys = assignPositions([undefined, undefined, undefined]);
  assert.ok(keys[0]! < keys[1]! && keys[1]! < keys[2]!);
  // Move the last item first: only it gets a new position.
  const moved = assignPositions([keys[2], keys[0], keys[1]]);
  assert.equal(moved[1], keys[0]);
  assert.equal(moved[2], keys[1]);
  assert.ok(moved[0]! < moved[1]!);
  // Duplicate positions (two Macs inserted at the same place) get separated.
  const dup = assignPositions([keys[0], keys[0], keys[1]]);
  assert.ok(dup[0]! < dup[1]! && dup[1]! < dup[2]!);
});

test("changes on one device reach the other, both ways", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.store.set("x:1", { title: "Netnyahoo" });
  await syncAll([a, b]);
  assert.deepEqual(snapshot(b), { "x:1": { title: "Netnyahoo" } });
  b.store.set("x:2", "from B");
  b.store.set("x:1", { title: "Renamed on B" });
  await syncAll([b, a]);
  assert.deepEqual(snapshot(a), snapshot(b));
  assert.deepEqual(snapshot(a), { "x:1": { title: "Renamed on B" }, "x:2": "from B" });
});

test("concurrent edits converge on the newest, whatever order devices sync in", async () => {
  for (const order of [["devA", "devB"], ["devB", "devA"]]) {
    const folder = new Folder();
    const a = new Device("devA", folder);
    const b = new Device("devB", folder);
    a.store.set("x:k", "base");
    await syncAll([a, b]);
    folder.now += 10;
    a.store.set("x:k", "A's edit");
    folder.now += 10;
    b.store.set("x:k", "B's edit (later)");
    const devices = order.map((id) => (id === "devA" ? a : b));
    await syncAll(devices, 3);
    assert.deepEqual(snapshot(a), snapshot(b));
    assert.equal(a.store.get("x:k"), "B's edit (later)");
    assert.deepEqual(a.state.records, b.state.records);
  }
});

test("deletes propagate; a re-add after a delete wins; an edit after a delete wins", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.store.set("x:1", "one");
  a.store.set("x:2", "two");
  await syncAll([a, b]);
  folder.now += 5;
  b.store.delete("x:1");
  await syncAll([b, a]);
  assert.equal(a.store.has("x:1"), false);
  folder.now += 5;
  a.store.set("x:1", "one again");
  await syncAll([a, b]);
  assert.equal(b.store.get("x:1"), "one again");
  // Delete on A, then a later edit on B before B saw the delete: the edit is newer.
  folder.now += 5;
  a.store.delete("x:2");
  folder.now += 5;
  b.store.set("x:2", "two, edited");
  await syncAll([a, b, a]);
  assert.equal(a.store.get("x:2"), "two, edited");
  assert.deepEqual(snapshot(a), snapshot(b));
});

test("clock skew: an edit made after seeing another device's wins even with a slow clock", async () => {
  const folder = new Folder();
  folder.now = 10_000_000;
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  b.offset = -3_600_000; // an hour behind
  a.store.set("x:k", "A");
  await syncAll([a, b]);
  assert.equal(b.store.get("x:k"), "A");
  folder.now += 1000;
  b.store.set("x:k", "B, after seeing A");
  await syncAll([b, a]);
  assert.equal(a.store.get("x:k"), "B, after seeing A");
  // A clock days ahead only wins edits concurrent with it; later edits elsewhere still win.
  const c = new Device("devC", folder);
  c.offset = 3 * 86_400_000;
  c.store.set("x:k", "C from the future");
  await syncAll([c, a, b]);
  assert.equal(a.store.get("x:k"), "C from the future");
  folder.now += 1000;
  a.store.set("x:k", "A, after C");
  await syncAll([a, b, c]);
  for (const d of [a, b, c]) assert.equal(d.store.get("x:k"), "A, after C");
});

test("files arriving late, out of order or cut short are read when they're whole", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.store.set("x:1", "v1");
  await a.sync();
  a.store.set("x:1", "v2");
  a.store.set("x:2", "second");
  await a.sync();
  const [first, second] = [...folder.scope("s").values()];
  first!.hiddenFrom.add("devB"); // iCloud hasn't downloaded it
  second!.partialFor.add("devB"); // mid-copy
  const r = await b.sync();
  assert.equal(r.pending, 1);
  assert.equal(b.store.size, 0);
  assert.equal(Object.keys(b.state.damaged).length, 1);
  second!.partialFor.clear(); // the second arrives first
  await b.sync();
  assert.deepEqual(snapshot(b), { "x:1": "v2", "x:2": "second" });
  assert.equal(b.state.vv.devA ?? 0, 0);
  assert.deepEqual(b.state.extra.devA, [2]);
  first!.hiddenFrom.clear(); // the older one lands: it must not win
  await b.sync();
  assert.deepEqual(snapshot(b), { "x:1": "v2", "x:2": "second" });
  assert.equal(b.state.vv.devA, 2);
  assert.equal(b.state.extra.devA, undefined);
});

test("a local edit made while files are read isn't overwritten", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.store.set("x:k", "old");
  await syncAll([a, b]);
  folder.now += 10;
  a.store.set("x:k", "A remote");
  await a.sync();
  folder.now += 10;
  // While B reads, the user edits the same key on B.
  b.onRead = () => {
    b.store.set("x:k", "B, typed during the read");
    b.onRead = undefined;
  };
  await b.sync();
  assert.equal(b.store.get("x:k"), "B, typed during the read");
  await syncAll([a, b]);
  assert.equal(a.store.get("x:k"), "B, typed during the read");
});

test("a joining device adopts synced settings, then its own new ones sync", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  a.settings.set("set:appearance", "dark");
  await syncAll([a]);
  const b = new Device("devB", folder);
  b.state.awaitRemote = true;
  b.settings.set("set:appearance", "light"); // B's default
  b.settings.set("set:onlyB", true);
  // The folder hasn't shown B any file yet: B stays unjoined.
  for (const e of folder.scope("s").values()) e.hiddenFrom.add("devB");
  await b.sync();
  assert.equal(b.state.joined, false);
  for (const e of folder.scope("s").values()) e.hiddenFrom.clear();
  await syncAll([b, a, b]);
  assert.equal(b.settings.get("set:appearance"), "dark");
  assert.equal(a.settings.get("set:appearance"), "dark");
  assert.equal(a.settings.get("set:onlyB"), true);
});

test("compaction: a snapshot replaces the logs it covers; new devices start from it", async () => {
  const folder = new Folder();
  const opts = { compactAfterFiles: 10, compactInterval: 0 };
  const a = new Device("devA", folder, opts);
  const b = new Device("devB", folder, opts);
  for (let i = 0; i < 30; i++) {
    folder.now += 100;
    a.store.set(`x:${i % 7}`, `a${i}`);
    if (i % 3 === 0) b.store.set(`x:b${i}`, i);
    await a.sync();
    await b.sync();
  }
  await syncAll([a, b]);
  assert.deepEqual(snapshot(a), snapshot(b));
  assert.ok(folder.fileCount() <= 12, `files: ${folder.fileCount()}`);
  const kinds = [...folder.scope("s").values()].map((e) => (JSON.parse(e.payload) as { kind: string }).kind);
  assert.ok(kinds.includes("snapshot"));
  const c = new Device("devC", folder, opts);
  await c.sync();
  assert.deepEqual(snapshot(c), snapshot(a));
});

test("a device offline for weeks catches up, keeps its offline edits, and learns collected deletes", async () => {
  const folder = new Folder();
  const day = 86_400_000;
  const opts: ScopeOptions = { compactAfterFiles: 3, compactInterval: 0, tombstoneTTL: 7 * day };
  const a = new Device("devA", folder, opts);
  const b = new Device("devB", folder, opts);
  a.store.set("x:keep", 1);
  a.store.set("x:doomed", 2);
  await syncAll([a, b]);
  assert.equal(b.store.get("x:doomed"), 2);
  // B goes offline. While away it edits something; meanwhile A deletes x:doomed and, weeks
  // later, compacts: the tombstone is collected and the logs are pruned.
  b.store.set("x:offline", "made offline");
  folder.now += day;
  a.store.delete("x:doomed");
  await a.sync();
  for (let i = 0; i < 6; i++) {
    folder.now += 5 * day;
    a.store.set(`x:w${i}`, i);
    await a.sync();
  }
  await compact(a.state, folder.transport("devA"), "s", "devA", folder.now, { ...opts, pruneGrace: 0 }, true);
  const tombstones = Object.values(a.state.records).filter((r) => r.v === null);
  assert.equal(tombstones.length, 0);
  b.relaunch();
  await syncAll([b, a, b]);
  assert.equal(b.store.has("x:doomed"), false, "the collected delete reached B");
  assert.equal(a.store.get("x:offline"), "made offline");
  assert.deepEqual(snapshot(a), snapshot(b));
});

test("expired records leave snapshots without deleting anything a device still keeps", async () => {
  const folder = new Folder();
  const opts: ScopeOptions = { compactAfterFiles: 0, compactInterval: 0, expired: (_k, v, now) => (v as { t: number }).t < now - 1000 };
  const a = new Device("devA", folder, opts);
  a.store.set("x:old", { t: 0 });
  a.store.set("x:new", { t: 5000 });
  folder.now = 5000;
  await a.sync();
  const snap = [...folder.scope("s").values()].map((e) => JSON.parse(e.payload) as { kind: string; records?: object }).find((f) => f.kind === "snapshot");
  assert.ok(snap?.records && !("x:old" in snap.records) && "x:new" in snap.records);
});

test("three devices, random edits and sync orders, converge", async () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let compactions = 0;
  for (let run = 0; run < 40; run++) {
    const folder = new Folder();
    const opts = { compactAfterFiles: 6, compactInterval: 0 };
    const devices = ["devA", "devB", "devC"].map((id) => new Device(id, folder, opts));
    for (let step = 0; step < 40; step++) {
      folder.now += Math.floor(random() * 50);
      const d = devices[Math.floor(random() * 3)]!;
      const key = `x:${Math.floor(random() * 6)}`;
      const r = random();
      if (r < 0.5) d.store.set(key, `${d.id}-${step}`);
      else if (r < 0.7) d.store.delete(key);
      else if (r < 0.8) d.relaunch();
      else await d.sync();
      if (random() < 0.3) await devices[Math.floor(random() * 3)]!.sync();
      // The sync client is slow and uneven: new files reach some Macs late, some half-copied.
      for (const e of folder.scope("s").values()) {
        if (random() < 0.15) e.hiddenFrom.add(devices[Math.floor(random() * 3)]!.id);
        if (random() < 0.1) e.partialFor.add(devices[Math.floor(random() * 3)]!.id);
        if (random() < 0.3) e.hiddenFrom.clear();
        if (random() < 0.3) e.partialFor.clear();
      }
    }
    for (const e of folder.scope("s").values()) {
      e.hiddenFrom.clear();
      e.partialFor.clear();
    }
    await syncAll(devices, 3);
    compactions += [...folder.scope("s").values()].filter((e) => e.payload.includes('"snapshot"')).length;
    const [a, b, c] = devices;
    assert.deepEqual(snapshot(a!), snapshot(b!), `run ${run}`);
    assert.deepEqual(snapshot(b!), snapshot(c!), `run ${run}`);
    assert.deepEqual(a!.state.records, b!.state.records, `run ${run}`);
  }
  assert.ok(compactions > 0);
});
