import type { StateCreator } from "zustand";

// Store transactions: inside `transaction(run)` every write applies at once (getState() is current throughout, for
// the writes and anyone reading), but the store's listeners hear about them together, once, when the outermost
// transaction ends: (the state then, the state they last heard). A page's reports applied in one flush
// (lib/nativeEvents.ts) were a store update apiece, each running every listener and every component's selector.
//
// `heardAlone(s, prev)` names a write whose state listeners must see before more writes land on it (a value that
// could flip back within the transaction, which hearing only the end would hide): right after it, listeners hear
// everything pending, it included. They're heard as zustand's setState calls them, with the transaction set aside:
// a listener's own write is heard at once, nested, and the writes after go on being held.
export function transactional<T>(heardAlone?: (s: T, prev: T) => boolean) {
  let depth = 0;
  // The state listeners last heard, while writes after it are pending.
  let heard: T | null = null;
  let hear = () => {};

  const middleware =
    (creator: StateCreator<T>): StateCreator<T> =>
    (set, get, api) => {
      type Listener = (s: T, prev: T) => void;
      const listeners = new Set<Listener>();
      // Each listener gets the state as it is when it's called, as zustand's setState does.
      const notify = (prev: T) => listeners.forEach((listener) => listener(api.getState(), prev));
      hear = () => {
        const prev = heard;
        if (prev === null) return;
        heard = null;
        if (api.getState() === prev) return;
        const held = depth;
        depth = 0;
        try {
          notify(prev);
        } finally {
          depth = held;
        }
      };
      api.subscribe((s, prev) => {
        if (!depth) return notify(prev);
        heard ??= prev;
        if (heardAlone?.(s, prev)) hear();
      });
      api.subscribe = (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      };
      return creator(set, get, api);
    };

  /** Runs `run`; the store's listeners hear its writes when the outermost transaction ends. */
  const transaction = (run: () => void) => {
    depth++;
    try {
      run();
    } finally {
      if (--depth === 0) hear();
    }
  };
  return { middleware, transaction };
}
