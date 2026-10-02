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
  memoizedState: unknown;
  dependencies: { firstContext: ContextItem | null } | null;
  stateNode: unknown;
  // Set by React's profiling build only (the bench bundles it with --profiling).
  selfBaseDuration?: number;
  actualDuration?: number;
};

type ContextItem = { context: { displayName?: string }; memoizedValue: unknown; next: ContextItem | null };
type Hook = { memoizedState: unknown; queue: unknown; next: Hook | null };

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

// The file's contents name optional (slower) probes: "selectors" times every store selector by call site;
// "renders" says why each component rendered (props, state, context, or nothing: a wasted render).
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

// What the probe counts, as nnPerf.revision; js-bench stamps it into its reports and `compare` warns when two differ.
// Bump it whenever a change moves the numbers (a new kind of task timed, a counter redefined).
//   1  before 6232fa43 (0.2.21 and older): Expo module events (JSI) weren't timed as tasks
//   2  6232fa43: module events timed as module:<event> tasks, counted in taskMs; commitTasks
export const PERF_PROBE_REVISION = 2;
const rendersProbe = !!probeOptions?.includes("renders");
// "listeners" also times each store listener by the functions that subscribed it.
const listenersProbe = !!probeOptions?.includes("listeners");

const now = () => performance.now();
const bump = (c: Counter, key: string, by = 1) => void (c[key] = (c[key] ?? 0) + by);

function fresh() {
  return {
    since: now(),
    commits: 0,
    commitTimes: [] as number[],
    // The task of each commit in commitTimes.
    commitTaskLog: [] as string[],
    renders: {} as Counter,
    mounts: {} as Counter,
    hostUpdates: 0,
    walkMs: 0,
    storeUpdates: {} as Counter,
    storeKeys: {} as Counter,
    listenerCalls: {} as Counter,
    listenerMs: {} as Counter,
    // With the "listeners" probe: the same, by the store and the function that subscribed.
    listenerSiteCalls: {} as Counter,
    listenerSiteMs: {} as Counter,
    tasks: {} as Counter,
    taskMs: {} as Counter,
    // When each native→JS task other than a timer started: [label, time].
    taskLog: [] as [string, number][],
    // Commits by the task they happened in (a native→JS call, a timer, a native module's event).
    commitTasks: {} as Counter,
    timers: {} as Counter,
    timerMs: {} as Counter,
    selectorCalls: {} as Counter,
    selectorMs: {} as Counter,
    writes: {} as Counter,
    writeBytes: {} as Counter,
    writeMs: {} as Counter,
    // With the "renders" probe: per component, renders that changed nothing (wasted), their time, each
    // render's self time, and what changed (props:<key> real change, fn:<key> new function, obj:<key> new
    // but shallow-equal object, state, state~ new but shallow-equal state, context:<name>).
    wasted: {} as Counter,
    wastedMs: {} as Counter,
    unstable: {} as Counter,
    unstableMs: {} as Counter,
    renderMs: {} as Counter,
    causes: {} as Record<string, Counter>,
    // Components whose own state or context changed with their props unchanged: where an update starts.
    origins: {} as Counter,
    commitMs: 0,
  };
}

let stats = fresh();
const marks: Record<string, number> = {};
const startedAt = now();
const startup: [task: string, at: number, ms: number][] = [];
const roots = new Set<{ current: Fiber }>();
let firstCommit = 0;
// The native→JS task running now (bridge call, timer callback or native module event), for commitTasks.
let task: string | null = null;

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
      else if (c.flags & PERFORMED_WORK) {
        bump(stats.renders, nameOf(c.type));
        if (rendersProbe) classify(c, c.alternate);
      }
    } else if (c.tag === HOST_COMPONENT && c.alternate && c.flags & UPDATE) stats.hostUpdates++;
    walk(c);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function shallowEqual(a: unknown, b: unknown) {
  if (Object.is(a, b)) return true;
  if (!isObject(a) || !isObject(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]));
}

// Why a component rendered this commit, against what it rendered with last time (its alternate).
function classify(fiber: Fiber, before: Fiber) {
  const name = nameOf(fiber.type);
  const causes: string[] = [];
  const props = fiber.memoizedProps ?? {};
  const prev = before.memoizedProps ?? {};
  let propsChanged = false;
  let realProps = false;
  if (props !== prev) {
    for (const key of new Set([...Object.keys(props), ...Object.keys(prev)])) {
      const a = props[key];
      const b = prev[key];
      if (Object.is(a, b)) continue;
      propsChanged = true;
      if (typeof a === "function" && typeof b === "function") causes.push(`fn:${key}`);
      else if (key !== "children" && isObject(a) && isObject(b) && shallowEqual(a, b)) causes.push(`obj:${key}`);
      else {
        realProps = true;
        causes.push(`props:${key}`);
      }
    }
  }
  let stateChanged = false;
  if (fiber.tag === 1) {
    if (!shallowEqual(fiber.memoizedState, before.memoizedState)) {
      stateChanged = true;
      causes.push("state");
    }
  } else {
    // Only hooks with an update queue hold state (useState, useReducer, useSyncExternalStore: zustand
    // selectors); memo, ref and effect hooks follow from props and state.
    let h = fiber.memoizedState as Hook | null;
    let o = before.memoizedState as Hook | null;
    for (; h && o; h = h.next, o = o.next) {
      if (h.queue == null || Object.is(h.memoizedState, o.memoizedState)) continue;
      stateChanged = true;
      causes.push(shallowEqual(h.memoizedState, o.memoizedState) ? "state~" : "state");
    }
  }
  let contextChanged = false;
  let ci = fiber.dependencies?.firstContext ?? null;
  let co = before.dependencies?.firstContext ?? null;
  for (; ci; ci = ci.next, co = co?.next ?? null) {
    if (co && Object.is(ci.memoizedValue, co.memoizedValue)) continue;
    contextChanged = true;
    causes.push(`context:${ci.context.displayName ?? "?"}`);
  }
  const ms = fiber.selfBaseDuration ?? 0;
  bump(stats.renderMs, name, ms);
  const counter = (stats.causes[name] ??= {});
  if (!propsChanged && !stateChanged && !contextChanged) {
    bump(stats.wasted, name);
    bump(stats.wastedMs, name, ms);
    bump(counter, "wasted");
  } else {
    if (!propsChanged) bump(stats.origins, name);
    // Only new functions or new-but-equal objects: stable props (memo, callbacks) would have skipped it.
    else if (!realProps && !stateChanged && !contextChanged) {
      bump(stats.unstable, name);
      bump(stats.unstableMs, name, ms);
    }
    for (const cause of new Set(causes)) bump(counter, cause);
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
      bump(stats.commitTasks, task ?? "other");
      if (stats.commitTimes.length < 5000) {
        stats.commitTimes.push(t);
        stats.commitTaskLog.push(task ?? "other");
      }
      try {
        walk(root.current);
      } catch {}
      stats.commitMs += root.current.actualDuration ?? 0;
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
          const outer = task;
          task = label;
          try {
            return (callback as (...a: unknown[]) => unknown).apply(this, args);
          } finally {
            task = outer;
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
      const key = label(args);
      task = key;
      if (key !== "JSTimers.callTimers" && stats.taskLog.length < 5000) stats.taskLog.push([key, t]);
      try {
        return original.apply(queue, args);
      } finally {
        task = null;
        const end = now();
        bump(stats.tasks, key);
        bump(stats.taskMs, key, end - t);
        // Until the first window is up: when each task ran (ms from the bundle's start) and for how long.
        if (!marks.firstWindow && startup.length < 1000) startup.push([key, Math.round(t - startedAt), Math.round((end - t) * 10) / 10]);
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

// Native modules' events (Expo's, through JSI) don't go through the bridge queue: time each listener call as a
// `module:<event>` task. A listener an event of the JS side's own runs inside its task and isn't counted again.
function wrapModuleEvents() {
  const proto = (globalThis as unknown as { expo?: { EventEmitter?: { prototype: Record<string, unknown> } } }).expo?.EventEmitter?.prototype;
  const add = proto?.addListener as ((this: unknown, name: string, listener: (...a: unknown[]) => void) => unknown) | undefined;
  const remove = proto?.removeListener as ((this: unknown, name: string, listener: unknown) => unknown) | undefined;
  if (!proto || typeof add !== "function" || typeof remove !== "function") return;
  // Per listener and event, so removeListener finds what addListener added.
  const wrapped = new WeakMap<object, Map<string, (...a: unknown[]) => void>>();
  proto.addListener = function (this: unknown, name: string, listener: (...a: unknown[]) => void) {
    if (typeof listener !== "function") return add.call(this, name, listener);
    const key = `module:${name}`;
    const byName = wrapped.get(listener) ?? new Map<string, (...a: unknown[]) => void>();
    wrapped.set(listener, byName);
    const timed =
      byName.get(name) ??
      function (this: unknown, ...args: unknown[]) {
        if (task !== null) return listener.apply(this, args);
        const t = now();
        task = key;
        if (stats.taskLog.length < 5000) stats.taskLog.push([key, t]);
        try {
          return listener.apply(this, args);
        } finally {
          task = null;
          bump(stats.tasks, key);
          bump(stats.taskMs, key, now() - t);
        }
      };
    byName.set(name, timed);
    return add.call(this, name, timed);
  };
  proto.removeListener = function (this: unknown, name: string, listener: unknown) {
    return remove.call(this, name, (typeof listener === "function" && wrapped.get(listener)?.get(name)) || listener);
  };
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
  store.subscribe = (listener) => {
    const site = listenersProbe ? `${name} ${callers(new Error().stack, 3)}` : "";
    return subscribe((s, prev) => {
      const t = now();
      try {
        listener(s, prev);
      } finally {
        const ms = now() - t;
        bump(stats.listenerCalls, name);
        bump(stats.listenerMs, name, ms);
        if (site) {
          bump(stats.listenerSiteCalls, site);
          bump(stats.listenerSiteMs, site, ms);
        }
      }
    });
  };
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
  wrapModuleEvents();
  wrapWrites();
  if (probeOptions?.includes("selectors")) wrapSelectors();
  (globalThis as { nnPerf?: unknown }).nnPerf = {
    revision: PERF_PROBE_REVISION,
    marks,
    startup,
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
