// Opt-in probe for the JS benchmark (apps/browser/scripts/perf/js-bench.mjs). It turns on only in an
// isolated instance (NETNYAHOO_DATA_DIR or NETNYAHOO_BACKGROUND) whose data folder holds a `perf-probe`
// file; otherwise it installs nothing.
// index.js imports it first, so React's renderer finds the hook below when it loads.
//
// With it on: React commits, component renders and mounts, host view updates, store updates and the time
// their subscribers take, native→JS calls (events, timers) with their time, timer callbacks and document
// writes, all readable through `globalThis.nnPerf` from the dev harness.

type Fiber = {
  tag: number;
  flags: number;
  type: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  memoizedProps: Record<string, unknown> | null;
  stateNode: unknown;
};

type Store = {
  subscribe: (listener: (s: unknown, prev: unknown) => void) => () => void;
  getState: () => unknown;
};

type Counter = Record<string, number>;

// This runs before anything has imported expo-modules-core, and the legacy bridge installs `expo` ahead of the bundle
// only when its runtime exists by then: install it as expo-modules-core's ensureNativeModulesAreInstalled does, or the
// probe stays off in some launches.
if (!(globalThis as { expo?: unknown }).expo) {
  try {
    const { TurboModuleRegistry } = require("react-native") as typeof import("react-native");
    (TurboModuleRegistry.get("ExpoModulesCore") as { installModules?: () => void } | null)?.installModules?.();
  } catch {}
}
const modules = (globalThis as { expo?: { modules?: Record<string, Record<string, (...a: unknown[]) => unknown>> } }).expo?.modules;
const shell = modules?.NetnyahooShell;

// The file's contents name optional (slower) probes: "selectors" times every store selector by call site.
const probeOptions = (() => {
  try {
    const info = modules?.NetnyahooApp?.systemInfo?.() as { isolatedInstance?: boolean } | undefined;
    if (!info?.isolatedInstance || typeof shell?.readDocument !== "function") return null;
    const file = shell.readDocument("perf-probe");
    return typeof file === "string" ? file : null;
  } catch {
    return null;
  }
})();

export const perfProbeEnabled = probeOptions !== null;

const now = () => performance.now();
const bump = (c: Counter, key: string, by = 1) => void (c[key] = (c[key] ?? 0) + by);

function fresh() {
  return {
    since: now(),
    commits: 0,
    commitTimes: [] as number[],
    renders: {} as Counter,
    mounts: {} as Counter,
    hostUpdates: 0,
    walkMs: 0,
    storeUpdates: {} as Counter,
    storeKeys: {} as Counter,
    listenerCalls: {} as Counter,
    listenerMs: {} as Counter,
    tasks: {} as Counter,
    taskMs: {} as Counter,
    timers: {} as Counter,
    timerMs: {} as Counter,
    selectorCalls: {} as Counter,
    selectorMs: {} as Counter,
    writes: {} as Counter,
    writeBytes: {} as Counter,
    writeMs: {} as Counter,
  };
}

let stats = fresh();
const marks: Record<string, number> = {};
const roots = new Set<{ current: Fiber }>();
let firstCommit = 0;

function nameOf(type: unknown): string {
  if (typeof type === "function") return (type as { displayName?: string }).displayName || type.name || "Anonymous";
  if (type && typeof type === "object") {
    const t = type as { displayName?: string; render?: unknown; type?: unknown };
    if (t.displayName) return t.displayName;
    if (t.render) return nameOf(t.render);
    if (t.type) return nameOf(t.type);
  }
  return String(type);
}

const COMPONENT_TAGS = new Set([0, 1, 11, 15]);
const PERFORMED_WORK = 1;
const UPDATE = 4;
const HOST_COMPONENT = 5;

// Walks only the part of the tree React reconciled: a fiber whose child list is the one it had before
// wasn't visited this commit (React's DevTools skips the same way).
function walk(fiber: Fiber) {
  if (fiber.alternate && fiber.child === fiber.alternate.child) return;
  for (let c = fiber.child; c; c = c.sibling) {
    if (COMPONENT_TAGS.has(c.tag)) {
      if (!c.alternate) bump(stats.mounts, nameOf(c.type));
      else if (c.flags & PERFORMED_WORK) bump(stats.renders, nameOf(c.type));
    } else if (c.tag === HOST_COMPONENT && c.alternate && c.flags & UPDATE) stats.hostUpdates++;
    walk(c);
  }
}

function installReactHook() {
  let ids = 0;
  (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => ++ids,
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id: number, root: { current: Fiber }) {
      const t = now();
      firstCommit ||= Date.now();
      roots.add(root);
      stats.commits++;
      if (stats.commitTimes.length < 5000) stats.commitTimes.push(t);
      try {
        walk(root.current);
      } catch {}
      stats.walkMs += now() - t;
    },
  };
}

let traceTimers = false;

const callers = (stack: string | undefined, depth = 4) =>
  (stack ?? "")
    .split("\n")
    .slice(2, 2 + depth)
    .map((line) => /at (\S+)/.exec(line)?.[1] ?? "?")
    .join(" < ");

function wrapTimers() {
  const g = globalThis as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const name of ["setTimeout", "setInterval", "requestAnimationFrame", "setImmediate"]) {
    const original = g[name];
    if (typeof original !== "function") continue;
    g[name] = function (this: unknown, callback: unknown, ...rest: unknown[]) {
      if (typeof callback !== "function") return original.call(this, callback, ...rest);
      let label = `${name}:${callback.name || "anonymous"}`;
      // With nnPerf.traceTimers on, anonymous callbacks are named by the functions that scheduled them.
      if (traceTimers && !callback.name) label += ` <${callers(new Error().stack)}>`;
      return original.call(
        this,
        function (this: unknown, ...args: unknown[]) {
          const t = now();
          try {
            return (callback as (...a: unknown[]) => unknown).apply(this, args);
          } finally {
            bump(stats.timers, label);
            bump(stats.timerMs, label, now() - t);
          }
        },
        ...rest,
      );
    };
  }
}

// Times each useSyncExternalStore snapshot (a zustand selector), keyed by the hooks and component that
// called it. Stack capture on every render makes this slow; use it to find costly selectors, not to time.
function wrapSelectors() {
  const react = require("react") as { useSyncExternalStore: (...a: unknown[]) => unknown };
  const original = react.useSyncExternalStore;
  react.useSyncExternalStore = (subscribe: unknown, getSnapshot: unknown, getServerSnapshot: unknown) => {
    const label = callers(new Error().stack, 4);
    const get = getSnapshot as () => unknown;
    const timed = () => {
      const t = now();
      try {
        return get();
      } finally {
        bump(stats.selectorCalls, label);
        bump(stats.selectorMs, label, now() - t);
      }
    };
    return original(subscribe, timed, getServerSnapshot);
  };
}

// Every native→JS call (events, timers, callbacks) goes through the bridge queue; time each one.
function wrapBridge() {
  const queue = (globalThis as { __fbBatchedBridge?: Record<string, (...a: unknown[]) => unknown> }).__fbBatchedBridge;
  if (!queue) return;
  const wrap = (method: string, label: (args: unknown[]) => string) => {
    const original = queue[method];
    if (typeof original !== "function") return;
    queue[method] = (...args: unknown[]) => {
      const t = now();
      try {
        return original.apply(queue, args);
      } finally {
        const key = label(args);
        bump(stats.tasks, key);
        bump(stats.taskMs, key, now() - t);
      }
    };
  };
  wrap("callFunctionReturnFlushedQueue", ([module, method, args]) => {
    if (module === "RCTEventEmitter" && Array.isArray(args)) return `event:${String(args[1])}`;
    if (module === "RCTDeviceEventEmitter" && Array.isArray(args)) return `device:${String(args[0])}`;
    return `${String(module)}.${String(method)}`;
  });
  wrap("invokeCallbackAndReturnFlushedQueue", () => "callback");
}

function wrapWrites() {
  const original = shell?.writeDocument;
  if (typeof original !== "function") return;
  try {
    shell!.writeDocument = (name: unknown, contents: unknown) => {
      const t = now();
      try {
        return original(name, contents);
      } finally {
        const key = String(name);
        bump(stats.writes, key);
        bump(stats.writeBytes, key, typeof contents === "string" ? contents.length : 0);
        bump(stats.writeMs, key, now() - t);
      }
    };
  } catch {}
}

// Counts a store's updates (by top-level key) and times every subscriber it notifies.
export function probeStore(name: string, store: Store) {
  if (!perfProbeEnabled) return;
  const subscribe = store.subscribe;
  store.subscribe = (listener) =>
    subscribe((s, prev) => {
      const t = now();
      try {
        listener(s, prev);
      } finally {
        bump(stats.listenerCalls, name);
        bump(stats.listenerMs, name, now() - t);
      }
    });
  subscribe((s, prev) => {
    bump(stats.storeUpdates, name);
    const a = s as Record<string, unknown>;
    const b = prev as Record<string, unknown>;
    for (const key in a) if (a[key] !== b[key]) bump(stats.storeKeys, `${name}.${key}`);
  });
}

export function perfMark(name: string) {
  if (perfProbeEnabled && !marks[name]) marks[name] = Date.now();
}

function findFibers(name: string, limit = 50): Fiber[] {
  const out: Fiber[] = [];
  const visit = (f: Fiber | null) => {
    for (let c = f; c && out.length < limit; c = c.sibling) {
      if (COMPONENT_TAGS.has(c.tag) && nameOf(c.type) === name) out.push(c);
      visit(c.child);
    }
  };
  for (const root of roots) visit(root.current);
  return out;
}

if (perfProbeEnabled) {
  marks.bundleStart = Date.now();
  installReactHook();
  wrapTimers();
  wrapBridge();
  wrapWrites();
  if (probeOptions?.includes("selectors")) wrapSelectors();
  (globalThis as { nnPerf?: unknown }).nnPerf = {
    marks,
    get firstCommit() {
      return firstCommit;
    },
    reset: () => void (stats = fresh()),
    set traceTimers(on: boolean) {
      traceTimers = on;
    },
    read: () => ({ ...stats, elapsed: now() - stats.since }),
    now,
    batch: (fn: () => void) => (require("react-native") as typeof import("react-native")).unstable_batchedUpdates(fn),
    findFibers,
    nameOf,
  };
}
