// Native events that arrive together land as one React commit (docs/store-api.md › "Native events").
//
// Every native→JS call is its own task, and React Native commits at the end of each: a tab opening sent about ten
// page reports (address, title, progress, security, icon…) and drew ten commits. Here a page's reports are held
// until the calls queued behind them have run, then applied in the order they came, inside one React batch.
// Whatever reaches JS next first applies the held ones, then runs: another event, a timer, a callback, a native
// module's event (a tab strip transaction, a download). So nothing is reordered, and nothing a user action waits on
// is held: only page reports wait, and only for the calls already queued behind them.

/** React Native's MessageQueue (`__fbBatchedBridge`): every native→JS call and callback runs through these. */
export type Bridge = {
  __callFunction(module: string, method: string, args: unknown[]): void;
  __invokeCallback(id: number, args: unknown[]): void;
};
/** Expo's EventEmitter prototype: native modules' events reach their listeners through JSI, not the bridge. */
export type Emitter = {
  addListener(this: unknown, name: string, listener: (...args: unknown[]) => unknown): unknown;
  removeListener(this: unknown, name: string, listener: unknown): unknown;
};
type Options = {
  /** Runs updates as one React commit (React Native's unstable_batchedUpdates). */
  batch: (update: () => void) => void;
  /** Calls back once the calls queued now have run (also how errors are reported, from a task of their own). */
  schedule: (callback: () => void) => void;
  /** An error a held report threw (the bridge's own guard reports it the same way). */
  report: (error: unknown) => void;
};
export type Hold = ReturnType<typeof createHold>;

// The WebView's live page state (packages/nncore WebView.tsx). Opening windows, focus, activation, page commands,
// find results, zoom, prompts, crashes and a new page's ready report (its browser id, mute) are never held.
export const HELD_EVENTS: ReadonlySet<string> = new Set([
  "topNavigationChange",
  "topProgress",
  "topFavicon",
  "topMedia",
  "topNowPlaying",
  "topStatus",
  "topSecurity",
  "topContentBlocked",
  "topMediaAccess",
  "topLoadError",
]);
/** The queue: `hold` keeps a report for later, `flush` applies everything held, in order, as one batch. */
export function createHold({ batch, schedule, report }: Options) {
  let held: (() => void)[] = [];
  // The next held report to apply. A flush that starts while one runs (a listener a report set off) goes on from
  // there, so what it runs still comes after every report held before it.
  let next = 0;
  let flushing = false;

  const drain = (errors: unknown[]) => {
    while (next < held.length) {
      // One report's error doesn't drop the ones after it.
      try {
        held[next++]!();
      } catch (error) {
        errors.push(error);
      }
    }
  };
  const flush = () => {
    if (next >= held.length) return;
    const errors: unknown[] = [];
    if (flushing) drain(errors);
    else {
      flushing = true;
      try {
        batch(() => drain(errors));
      } finally {
        held = [];
        next = 0;
        flushing = false;
      }
    }
    // Each from a task of its own: a reporter that throws can't drop a report, another error, or the call that set
    // off the flush.
    for (const error of errors) schedule(() => report(error));
  };
  const hold = (run: () => void) => {
    if (!held.length) schedule(flush);
    held.push(run);
  };
  return { hold, flush, batch };
}

/** Holds page reports at `bridge`; every other call and callback applies what's held first. */
export function holdPageReports(bridge: Bridge, { hold, flush }: Hold) {
  const call = bridge.__callFunction.bind(bridge);
  const invoke = bridge.__invokeCallback.bind(bridge);
  bridge.__callFunction = (module, method, args) => {
    if (module === "RCTEventEmitter" && method === "receiveEvent" && HELD_EVENTS.has(args[1] as string)) {
      hold(() => call(module, method, args));
      return;
    }
    flush();
    call(module, method, args);
  };
  bridge.__invokeCallback = (id, args) => {
    flush();
    invoke(id, args);
  };
}

/** Makes every listener added to `emitter` apply what's held first, in one React commit with it. */
export function afterHeldReports(emitter: Emitter, { flush, batch }: Hold) {
  const add = emitter.addListener;
  const remove = emitter.removeListener;
  // Per listener and event, so removeListener finds what addListener added.
  const wrapped = new WeakMap<object, Map<string, (...args: unknown[]) => unknown>>();
  emitter.addListener = function (name, listener) {
    if (typeof listener !== "function") return add.call(this, name, listener);
    let byName = wrapped.get(listener);
    if (!byName) wrapped.set(listener, (byName = new Map()));
    let wrapper = byName.get(name);
    if (!wrapper) {
      wrapper = function (this: unknown, ...args: unknown[]) {
        let result: unknown;
        batch(() => {
          flush();
          result = listener.apply(this, args);
        });
        return result;
      };
      byName.set(name, wrapper);
    }
    return add.call(this, name, wrapper);
  };
  emitter.removeListener = function (name, listener) {
    return remove.call(this, name, (typeof listener === "function" && wrapped.get(listener)?.get(name)) || listener);
  };
}

// Installed once per JS context (a Fast Refresh evaluates this module again): the flush lives on the global.
const g = globalThis as unknown as {
  __nnApplyHeldReports?: () => void;
  __fbBatchedBridge?: Bridge;
  expo?: { EventEmitter?: { prototype: Emitter } };
  ErrorUtils?: { reportFatalError(error: unknown): void };
};
const bridge = g.__fbBatchedBridge;
const emitter = g.expo?.EventEmitter?.prototype;
if (!g.__nnApplyHeldReports && bridge && emitter && typeof bridge.__callFunction === "function" && typeof bridge.__invokeCallback === "function") {
  // Required here, not imported: tests load this module without React Native.
  const batch = (update: () => void) => (require("react-native") as typeof import("react-native")).unstable_batchedUpdates(update);
  // A 0 ms timer runs at once on the JS thread (RCTTiming), so its call queues behind the ones already waiting.
  const held = createHold({ batch, schedule: (callback) => setTimeout(callback, 0), report: (error) => g.ErrorUtils?.reportFatalError(error) });
  holdPageReports(bridge, held);
  afterHeldReports(emitter, held);
  g.__nnApplyHeldReports = held.flush;
}

/**
 * Applies held page reports now. JSI settles native promises without passing the bridge, so code that decides from
 * a page's live state after awaiting the engine (may this tab sleep? close it?) calls this first.
 */
export const applyHeldReports = () => g.__nnApplyHeldReports?.();
