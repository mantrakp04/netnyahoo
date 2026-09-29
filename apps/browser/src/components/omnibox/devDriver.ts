import { useEffect, useRef } from "react";

/**
 * DEV builds only: lets tooling (lib/devHarness.ts → `nn.omnibox`) type into a command bar and
 * press its keys without focusing the app, then read back what it shows.
 */
export type OmniboxDriver = {
  /** Replaces the text as if typed (typing over a longer text reads as a deletion: no completion). */
  type(text: string): void;
  clear(): void;
  key(key: string, mods?: { metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean }): void;
  submit(): void;
  state(): unknown;
  /** The bar's frame in window coordinates. */
  measure(): Promise<{ x: number; y: number; width: number; height: number }>;
};

const drivers = new Map<string, OmniboxDriver>();

/**
 * A command bar render, for timing typing (epoch ms): `heard` is when the field's last change
 * reached JS, `committed` when React committed the render showing rows for `typed`.
 */
export type OmniboxTrace = { bar: string; typed: string; heard: number; committed: number };
let trace: OmniboxTrace[] | null = null;

/** Records a render while tooling traces (`nn.omnibox.trace.start()` / `.stop()`). */
export function traceOmnibox(entry: OmniboxTrace) {
  if (__DEV__ && trace) trace.push(entry);
}

/** `nn.omnibox.get("<windowId>:hero" | "<windowId>:panel")`. */
export const omniboxDrivers = {
  get: (id: string) => drivers.get(id),
  ids: () => [...drivers.keys()],
  trace: {
    start: () => void (trace = []),
    stop: () => {
      const out = trace ?? [];
      trace = null;
      return out;
    },
  },
};

export function useOmniboxDriver(id: string, driver: OmniboxDriver) {
  const latest = useRef(driver);
  latest.current = driver;
  useEffect(() => {
    if (!__DEV__) return;
    const proxy: OmniboxDriver = {
      type: (text) => latest.current.type(text),
      clear: () => latest.current.clear(),
      key: (key, mods) => latest.current.key(key, mods),
      submit: () => latest.current.submit(),
      state: () => latest.current.state(),
      measure: () => latest.current.measure(),
    };
    drivers.set(id, proxy);
    return () => {
      if (drivers.get(id) === proxy) drivers.delete(id);
    };
  }, [id]);
}
