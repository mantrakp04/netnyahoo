// Runs React hooks in plain Node, without a renderer, for tests that check what a component would show after the stores
// change: React's hooks call the dispatcher in React's internals, so a small one here stands in for the renderer's.
//
//   const row = mount(() => useTab("a"));      // renders once
//   store.updateTab("a", { title: "B" });      // a subscription that sees a new snapshot marks it for a render
//   row.value                                  // renders what is pending, then the latest value
//   row.rerender(props) / row.setContext(Context, value) / row.unmount()
//
// It keeps React's rules where staleness lives: a useSyncExternalStore subscription renders again only when the
// snapshot it reads (the latest getSnapshot) is a new value (Object.is); memo, ref and state keep their slots by call
// order; effects run after each render when their deps change, cleanups before the next run and at unmount. It subscribes
// during render rather than after commit; tests change the stores between renders, so that difference never shows.
import React from "react";

const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
const sameDeps = (a, b) => !!a && !!b && a.length === b.length && a.every((d, i) => Object.is(d, b[i]));

/** Mounts `render(props)` as a component; `contexts`: [[Context, value], …] its providers give it. */
export function mount(render, { props, contexts = [] } = {}) {
  const slots = [];
  const provided = new Map(contexts);
  let at = 0;
  let current = props;
  let value;
  let dirty = false;
  let alive = true;
  let renders = 0;
  let effects = [];

  const schedule = () => {
    if (alive) dirty = true;
  };
  const slot = (make) => (slots[at] ??= make());

  const dispatcher = {
    readContext: (ctx) => (provided.has(ctx) ? provided.get(ctx) : ctx._currentValue),
    useContext: (ctx) => (provided.has(ctx) ? provided.get(ctx) : ctx._currentValue),
    useMemo(make, deps) {
      const s = slot(() => ({}));
      at++;
      if (!("value" in s) || !deps || !sameDeps(s.deps, deps)) {
        s.value = make();
        s.deps = deps;
      }
      return s.value;
    },
    useCallback: (fn, deps) => dispatcher.useMemo(() => fn, deps),
    useRef(initial) {
      const s = slot(() => ({ current: initial }));
      at++;
      return s;
    },
    useState(initial) {
      const s = slot(() => {
        const state = { value: typeof initial === "function" ? initial() : initial };
        state.set = (next) => {
          const v = typeof next === "function" ? next(state.value) : next;
          if (Object.is(v, state.value)) return;
          state.value = v;
          schedule();
        };
        return state;
      });
      at++;
      return [s.value, s.set];
    },
    useReducer(reducer, arg, init) {
      const [state, set] = dispatcher.useState(() => (init ? init(arg) : arg));
      return [state, (action) => set((s) => reducer(s, action))];
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const s = slot(() => ({}));
      at++;
      s.getSnapshot = getSnapshot;
      s.value = getSnapshot();
      if (s.subscribe !== subscribe) {
        s.unsubscribe?.();
        s.subscribe = subscribe;
        s.unsubscribe = subscribe(() => {
          if (!Object.is(s.getSnapshot(), s.value)) schedule();
        });
      }
      return s.value;
    },
    useEffect(effect, deps) {
      const s = slot(() => ({}));
      at++;
      if (s.ran && deps && sameDeps(s.deps, deps)) return;
      s.deps = deps;
      effects.push(() => {
        s.cleanup?.();
        s.ran = true;
        const cleanup = effect();
        s.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      });
    },
    useLayoutEffect: (effect, deps) => dispatcher.useEffect(effect, deps),
    useInsertionEffect: (effect, deps) => dispatcher.useEffect(effect, deps),
    useDebugValue() {},
    useId: () => "id",
    useTransition: () => [false, (fn) => fn()],
    useDeferredValue: (v) => v,
  };

  const renderNow = () => {
    const previous = internals.H;
    internals.H = dispatcher;
    at = 0;
    dirty = false;
    try {
      value = render(current);
      renders++;
    } finally {
      internals.H = previous;
    }
    const run = effects;
    effects = [];
    for (const effect of run) effect();
  };
  // Renders until nothing is pending (an effect's setState renders again, as React does).
  const settle = () => {
    for (let n = 0; dirty && alive; n++) {
      if (n > 50) throw new Error("render loop: a snapshot changes on every read (getSnapshot should be cached)");
      renderNow();
    }
  };

  renderNow();
  settle();
  return {
    get value() {
      settle();
      return value;
    },
    /** Whether a store change marked it for a render (what React would schedule), without rendering. */
    get pending() {
      return dirty;
    },
    get renders() {
      settle();
      return renders;
    },
    /** A provider above it gives a new value: its consumers render again, through memo, as React's do. */
    setContext(ctx, next) {
      if (provided.get(ctx) === next) return value;
      provided.set(ctx, next);
      renderNow();
      settle();
      return value;
    },
    rerender(next = current) {
      current = next;
      renderNow();
      settle();
      return value;
    },
    unmount() {
      alive = false;
      for (const s of slots) {
        s?.unsubscribe?.();
        s?.cleanup?.();
      }
    },
  };
}
