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

/** `nn.omnibox.get("<windowId>:hero" | "<windowId>:panel")`. */
export const omniboxDrivers = { get: (id: string) => drivers.get(id), ids: () => [...drivers.keys()] };

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
