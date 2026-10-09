import type * as ImportApi from "@arcadia/import";

let api: typeof ImportApi | null | undefined;

export function importModule(): typeof ImportApi | null {
  if (api === undefined) {
    try {
      api = require("@arcadia/import") as typeof ImportApi;
    } catch {
      api = null;
    }
  }
  return api;
}
