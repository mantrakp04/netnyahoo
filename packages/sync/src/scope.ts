import { canonical } from "./canon.ts";
import { hlcWall, type Clock, type HLC } from "./hlc.ts";

/**
 * One scope's replica (the app's settings and profiles, or one profile's data) and how it
 * merges. Each device writes only files of its own, never changes one, and every device
 * reads everyone's:
 *
 * - a **log** is a batch of this device's changes: `{ kind: "log", device, seq, ops }`, one
 *   file per batch, `seq` counting up per device and scope;
 * - a **snapshot** is a device's whole merged replica with the per-device `seq`s it covers
 *   (`vv`, a version vector). Files a snapshot covers can be deleted.
 *
 * The replica maps a key ("bm:<id>", "h:<url>", "set:appearance"…) to its newest record,
 * last writer wins by hybrid logical clock (hlc.ts); a deletion is a record with value null (a
 * tombstone). Merging is a join (commutative, associative, idempotent), so every device ends up
 * with the same replica whatever order files arrive in.
 */
export type Origin = [device: string, seq: number];
export type SyncRecord = { h: HLC; v: unknown; o: Origin };
export type Op = { k: string; h: HLC; v: unknown };

export type LogFile = { v: 1; kind: "log"; device: string; seq: number; at: number; ops: Op[] };
export type SnapshotFile = {
  v: 1;
  kind: "snapshot";
  device: string;
  at: number;
  vv: Record<string, number>;
  seen: Record<string, number>;
  records: Record<string, SyncRecord>;
};
export type SyncFile = LogFile | SnapshotFile;

type FileMeta = { d: string; k: "log" | "snapshot" | "bad"; s?: number; vv?: Record<string, number>; at: number };

export type ScopeState = {
  records: Record<string, SyncRecord>;
  /** The value of each key as the local store had it after the last publish or apply (canonical JSON). */
  base: Record<string, string>;
  /** Keys that changed remotely but couldn't be applied yet (their adapter was unavailable). */
  unapplied: string[];
  /** Per device, every seq up to this one is in `records`. */
  vv: Record<string, number>;
  /** Per device, seqs above `vv` that are in `records` too (files that arrived out of order). */
  extra: Record<string, number[]>;
  /** Files read or written (by id), so they're read once and can be pruned later. */
  files: Record<string, FileMeta>;
  /** Files that didn't open, and when that was first seen (ms). */
  damaged: Record<string, number>;
  /** This device's last written seq. */
  seq: number;
  /** Changes waiting to be written, as log seq + 1. */
  outbox: Op[];
  /** Per device, the time of its newest file (ms): when it last synced. */
  seen: Record<string, number>;
  /** False until the first cycle finishes: adapters that adopt remote values skip publishing. */
  joined: boolean;
  /**
   * Joining data another device made: stay unjoined until a file of another device has been
   * read (the sync client may not have listed any yet), so this device's defaults can't win.
   */
  awaitRemote?: boolean;
  /** When this device last wrote a snapshot. */
  snapshotAt: number;
  /** Files waiting to download (the last read), for the status line. */
  pending: number;
};

export const emptyScope = (): ScopeState => ({
  records: {},
  base: {},
  unapplied: [],
  vv: {},
  extra: {},
  files: {},
  damaged: {},
  seq: 0,
  outbox: [],
  seen: {},
  joined: false,
  snapshotAt: 0,
  pending: 0,
});

/** How a scope's files move: the folder (native) in the app, memory in tests. */
export interface Transport {
  write(scope: string, payload: string): Promise<string>;
  read(scope: string, known: string[]): Promise<Listing>;
  remove(scope: string, ids: string[]): Promise<void>;
}

export type Listing = {
  files: { id: string; payload: string }[];
  pending: string[];
  damaged: { id: string; age: number }[];
  present: string[];
};

/** What the local store holds for one kind of data (every key starting with `prefix`). */
export type Extraction = {
  /** Never null: a null record is a deletion (wrap values that can be null). */
  values: Map<string, unknown>;
  /** Keys this device keeps but doesn't sync right now (history older than the window): not deletions. */
  ignore?: (key: string) => boolean;
};

export interface Adapter {
  prefix: string;
  /** The local values, or null if they can't be read now (skips this adapter's publishing and applying). */
  extract(base: (key: string) => unknown): Extraction | null | Promise<Extraction | null>;
  /**
   * Makes the local store match `visible` (every live record with this prefix) for the
   * `changed` keys. Returns false if it couldn't (tried again next cycle). `base` is what the
   * store held after the last cycle, for adapters whose extraction can lag (passwords).
   */
  apply(visible: Map<string, unknown>, changed: Set<string>, base: (key: string) => unknown): boolean | void | Promise<boolean | void>;
  /** When a value was first made, for publishing existing data without beating later edits elsewhere. */
  editedAt?(value: unknown): number | undefined;
  /** Settings-like data: a device that joins takes the synced values instead of publishing its own first. */
  adoptRemoteOnJoin?: boolean;
}

export type ScopeOptions = {
  /** Records dropped from snapshots when too old (history outside its window). */
  expired?: (key: string, value: unknown, now: number) => boolean;
  /** Tombstones older than this are dropped from snapshots. */
  tombstoneTTL?: number;
  /** Write a snapshot when the scope has more files than this… */
  compactAfterFiles?: number;
  /** …and nobody wrote one for this long. */
  compactInterval?: number;
  /** Files covered by a snapshot are removed once they're this old, so peers read small logs first. */
  pruneGrace?: number;
  /** A file that still doesn't open after this long is given up on. */
  damagedGiveUp?: number;
};

const DEFAULTS: Required<ScopeOptions> = {
  expired: () => false,
  tombstoneTTL: 45 * 86_400_000,
  compactAfterFiles: 40,
  compactInterval: 10 * 60_000,
  pruneGrace: 60 * 60_000,
  damagedGiveUp: 86_400_000,
};

export const covered = (vv: Record<string, number>, [device, seq]: Origin) => (vv[device] ?? 0) >= seq;

function markApplied(state: ScopeState, device: string, seq: number) {
  if (covered(state.vv, [device, seq])) return;
  const extra = new Set(state.extra[device] ?? []);
  extra.add(seq);
  let top = state.vv[device] ?? 0;
  while (extra.delete(top + 1)) top++;
  state.vv[device] = top;
  if (extra.size) state.extra[device] = [...extra].sort((a, b) => a - b);
  else delete state.extra[device];
}

const isApplied = (state: ScopeState, [device, seq]: Origin) =>
  covered(state.vv, [device, seq]) || (state.extra[device]?.includes(seq) ?? false);

function see(state: ScopeState, device: string, at: number) {
  if (!(device in state.seen) || at > state.seen[device]!) state.seen[device] = at;
}

/** Merges a record; returns whether it won. */
function mergeRecord(state: ScopeState, key: string, record: SyncRecord, clock: Clock): boolean {
  clock.observe(record.h);
  const current = state.records[key];
  if (current && current.h >= record.h) return false;
  state.records[key] = record;
  return true;
}

export function ingestLog(state: ScopeState, file: LogFile, clock: Clock, changed: Set<string>) {
  see(state, file.device, file.at);
  // Covered by a snapshot already applied: its changes are in there (or were superseded, and
  // replaying it could bring back a record whose tombstone the snapshot dropped).
  if (isApplied(state, [file.device, file.seq])) return;
  for (const op of file.ops) {
    if (mergeRecord(state, op.k, { h: op.h, v: op.v, o: [file.device, file.seq] }, clock)) changed.add(op.k);
  }
  markApplied(state, file.device, file.seq);
}

export function ingestSnapshot(state: ScopeState, file: SnapshotFile, clock: Clock, changed: Set<string>) {
  for (const [device, at] of Object.entries(file.seen)) see(state, device, at);
  see(state, file.device, file.at);
  for (const [key, record] of Object.entries(file.records)) {
    if (mergeRecord(state, key, record, clock)) changed.add(key);
  }
  // A record the snapshot's author had (its file is covered) but the snapshot lacks was
  // deleted and its tombstone collected (or it expired): drop it here too.
  for (const [key, record] of Object.entries(state.records)) {
    if (!(key in file.records) && covered(file.vv, record.o)) {
      delete state.records[key];
      changed.add(key);
    }
  }
  for (const [device, seq] of Object.entries(file.vv)) {
    if (seq > (state.vv[device] ?? 0)) {
      state.vv[device] = seq;
      const extra = (state.extra[device] ?? []).filter((s) => s > seq);
      for (let top = seq; extra[0] === top + 1; top++) state.vv[device] = extra.shift()!;
      if (extra.length) state.extra[device] = extra;
      else delete state.extra[device];
    }
  }
}

/** Live values of every key with `prefix`. */
export function visible(state: ScopeState, prefix: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, record] of Object.entries(state.records)) {
    if (record.v !== null && key.startsWith(prefix)) out.set(key, record.v);
  }
  return out;
}

const parseBase = (json: string | undefined) => (json === undefined ? undefined : (JSON.parse(json) as unknown));

/** One adapter's local edits since the last publish or apply become ops (in the replica and the outbox). */
export async function publishAdapter(state: ScopeState, adapter: Adapter, clock: Clock, device: string): Promise<Set<string>> {
  const published = new Set<string>();
  if (adapter.adoptRemoteOnJoin && !state.joined) return published;
  const extraction = await adapter.extract((key) => parseBase(state.base[key]));
  if (!extraction) return published;
  const put = (key: string, value: unknown) => {
    const known = state.records[key];
    const editedAt = !known && value !== null ? adapter.editedAt?.(value) : undefined;
    const h = editedAt !== undefined ? clock.at(editedAt) : clock.tick();
    // A backdated timestamp can't win over what's in the replica already.
    if (known && known.h >= h) return;
    state.records[key] = { h, v: value, o: [device, state.seq + 1] };
    state.outbox.push({ k: key, h, v: value });
    published.add(key);
  };
  for (const [key, value] of extraction.values) {
    if (value === null || value === undefined) throw new Error(`[sync] ${key}: a live value can't be null`);
    const json = canonical(value);
    if (state.base[key] === json) continue;
    state.base[key] = json;
    put(key, value);
  }
  for (const key of Object.keys(state.base)) {
    if (!key.startsWith(adapter.prefix) || extraction.values.has(key) || extraction.ignore?.(key)) continue;
    delete state.base[key];
    put(key, null);
  }
  return published;
}

export async function publish(state: ScopeState, adapters: Adapter[], clock: Clock, device: string): Promise<Set<string>> {
  const published = new Set<string>();
  for (const adapter of adapters) for (const key of await publishAdapter(state, adapter, clock, device)) published.add(key);
  return published;
}

/** Writes the outbox as the next log file. */
export async function flush(state: ScopeState, transport: Transport, scope: string, device: string, now: number) {
  if (!state.outbox.length) return;
  const file: LogFile = { v: 1, kind: "log", device, seq: state.seq + 1, at: now, ops: state.outbox };
  const id = await transport.write(scope, JSON.stringify(file));
  state.files[id] = { d: device, k: "log", s: file.seq, at: now };
  state.seq = file.seq;
  state.outbox = [];
  markApplied(state, device, file.seq);
  see(state, device, now);
}

/** Reads new files; returns the keys whose records changed. */
export async function pull(state: ScopeState, transport: Transport, scope: string, clock: Clock, now: number, options: ScopeOptions = {}) {
  const { damagedGiveUp } = { ...DEFAULTS, ...options };
  const listing = await transport.read(scope, Object.keys(state.files));
  const changed = new Set<string>();
  const parsed: { id: string; file: SyncFile }[] = [];
  const bad = (id: string) => {
    state.damaged[id] ??= now;
    if (now - state.damaged[id]! > damagedGiveUp) {
      state.files[id] = { d: "", k: "bad", at: now };
      delete state.damaged[id];
    }
  };
  for (const { id, payload } of listing.files) {
    try {
      const file = JSON.parse(payload) as SyncFile;
      if (file.v !== 1 || (file.kind !== "log" && file.kind !== "snapshot")) throw new Error("unknown file");
      parsed.push({ id, file });
    } catch {
      bad(id);
    }
  }
  for (const { id } of listing.damaged) bad(id);
  // Snapshots first: logs they cover are then skipped.
  parsed.sort((a, b) => (a.file.kind === b.file.kind ? 0 : a.file.kind === "snapshot" ? -1 : 1));
  for (const { id, file } of parsed) {
    if (file.kind === "snapshot") {
      ingestSnapshot(state, file, clock, changed);
      state.files[id] = { d: file.device, k: "snapshot", vv: file.vv, at: file.at };
    } else {
      ingestLog(state, file, clock, changed);
      state.files[id] = { d: file.device, k: "log", s: file.seq, at: file.at };
    }
    delete state.damaged[id];
  }
  // Forget files that are gone (pruned by whoever wrote a snapshot).
  const present = new Set(listing.present);
  for (const id of Object.keys(state.files)) if (!present.has(id)) delete state.files[id];
  for (const id of Object.keys(state.damaged)) if (!present.has(id)) delete state.damaged[id];
  state.pending = listing.pending.length;
  return changed;
}

/** Brings one adapter's part of the local store up to date; returns false if it couldn't. */
export async function applyAdapter(state: ScopeState, adapter: Adapter, keys: Set<string>): Promise<boolean> {
  const mine = new Set([...keys].filter((k) => k.startsWith(adapter.prefix)));
  if (!mine.size) return true;
  const view = visible(state, adapter.prefix);
  let ok: boolean | void = false;
  try {
    ok = await adapter.apply(view, mine, (key) => parseBase(state.base[key]));
  } catch (error) {
    console.warn(`[sync] applying ${adapter.prefix} failed`, error);
  }
  if (ok === false) return false;
  for (const key of mine) {
    if (view.has(key)) state.base[key] = canonical(view.get(key));
    else delete state.base[key];
  }
  return true;
}

/** Brings the local store up to date with remote changes (and ones that couldn't be applied before). */
export async function applyRemote(state: ScopeState, adapters: Adapter[], changed: Set<string>) {
  const keys = new Set([...state.unapplied, ...changed]);
  const unapplied: string[] = [];
  for (const adapter of adapters) {
    if (!(await applyAdapter(state, adapter, keys))) unapplied.push(...[...keys].filter((k) => k.startsWith(adapter.prefix)));
  }
  // Keys no adapter here handles (a kind of data turned off) wait for one.
  const handled = (k: string) => adapters.some((a) => k.startsWith(a.prefix));
  state.unapplied = [...unapplied, ...[...keys].filter((k) => !handled(k))];
}

/**
 * Writes a snapshot of the whole replica when the scope has gathered enough files, then
 * removes the files it covers. Tombstones and expired records are left out (and dropped here).
 */
export async function compact(state: ScopeState, transport: Transport, scope: string, device: string, now: number, options: ScopeOptions = {}, force = false) {
  const o = { ...DEFAULTS, ...options };
  const count = Object.keys(state.files).length;
  const newestSnapshot = Math.max(state.snapshotAt, ...Object.values(state.files).filter((f) => f.k === "snapshot").map((f) => f.at));
  if (!force && (count <= o.compactAfterFiles || now - newestSnapshot < o.compactInterval)) return false;
  // Unwritten changes go first, so the snapshot's vv covers them.
  await flush(state, transport, scope, device, now);
  const records: Record<string, SyncRecord> = {};
  for (const [key, record] of Object.entries(state.records)) {
    const drop = record.v === null ? now - hlcWall(record.h) > o.tombstoneTTL : o.expired(key, record.v, now);
    if (drop) delete state.records[key];
    else records[key] = record;
  }
  const vv = { ...state.vv };
  const file: SnapshotFile = { v: 1, kind: "snapshot", device, at: now, vv, seen: { ...state.seen }, records };
  const id = await transport.write(scope, JSON.stringify(file));
  state.files[id] = { d: device, k: "snapshot", vv, at: now };
  state.snapshotAt = now;
  const dominated = (other: Record<string, number>) => Object.entries(other).every(([d, s]) => (vv[d] ?? 0) >= s);
  const prune = Object.entries(state.files)
    .filter(([fileId, f]) => {
      if (fileId === id || now - f.at < o.pruneGrace) return false;
      if (f.k === "log") return covered(vv, [f.d, f.s ?? Infinity]);
      if (f.k === "snapshot") return dominated(f.vv ?? {});
      return false;
    })
    .map(([fileId]) => fileId);
  if (prune.length) {
    await transport.remove(scope, prune);
    for (const fileId of prune) delete state.files[fileId];
  }
  return true;
}

export type CycleResult = { published: number; changed: number; pending: number; compacted: boolean };

/**
 * One round for a scope: publish local edits, write them, read everyone's new files, publish
 * again whatever changed locally while that ran (so it isn't overwritten), apply remote
 * changes, and compact when due.
 */
export async function syncScope(args: {
  scope: string;
  state: ScopeState;
  transport: Transport;
  adapters: Adapter[];
  clock: Clock;
  device: string;
  now?: () => number;
  options?: ScopeOptions;
}): Promise<CycleResult> {
  const { scope, state, transport, adapters, clock, device, options } = args;
  const now = args.now ?? Date.now;
  let published = (await publish(state, adapters, clock, device)).size;
  await flush(state, transport, scope, device, now());
  const changed = await pull(state, transport, scope, clock, now(), options);
  // Per adapter, with no wait between the two steps: edits made while files were read are
  // published (so they win), then remote changes are applied over a store that has no
  // unpublished edits of this kind.
  const keys = new Set([...state.unapplied, ...changed]);
  const unapplied: string[] = [];
  for (const adapter of adapters) {
    const late = await publishAdapter(state, adapter, clock, device);
    published += late.size;
    for (const key of late) keys.delete(key);
    if (!(await applyAdapter(state, adapter, keys))) unapplied.push(...[...keys].filter((k) => k.startsWith(adapter.prefix)));
  }
  state.unapplied = [...unapplied, ...[...keys].filter((k) => !adapters.some((a) => k.startsWith(a.prefix)))];
  if (!state.awaitRemote || Object.keys(state.seen).some((d) => d !== device)) {
    state.joined = true;
    delete state.awaitRemote;
  }
  await flush(state, transport, scope, device, now());
  const compacted = await compact(state, transport, scope, device, now(), options);
  return { published, changed: changed.size, pending: state.pending, compacted };
}
