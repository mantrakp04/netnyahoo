import type * as ImportApi from "@netnyahoo/import";

let api: typeof ImportApi | null | undefined;

/**
 * @netnyahoo/import, loaded on first use: its native module only exists in app
 * builds made after it was linked, and requiring it throws in older ones (Metro
 * serves the same JS to every build). Null when it isn't available.
 */
export function importModule(): typeof ImportApi | null {
  if (api === undefined) {
    try {
      api = require("@netnyahoo/import") as typeof ImportApi;
    } catch {
      api = null;
    }
  }
  return api;
}
