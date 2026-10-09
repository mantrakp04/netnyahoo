// The benchmark's command channel (bench-entry.js loads it once the app has loaded).
import * as shell from "@arcadia/shell";
import { readDocument, writeDocument } from "@arcadia/shell";
import * as actions from "../../src/lib/actions";
import { runCommand } from "../../src/lib/commands";
import { webviews } from "../../src/lib/webviews";
import { usePages } from "../../src/components/layout/pageState";
import { useBrowser } from "../../src/store/browser";
import { devJourneys } from "../../src/telemetry/journeys";
import { devState as telemetryState } from "../../src/telemetry/client";

writeDocument("bench-boot.json", JSON.stringify({ jsStart: Date.now() }));

let pausedUntil = 0;
const ac = {
  store: useBrowser,
  pages: usePages,
  actions,
  runCommand,
  webviews,
  shell,
  now: () => Date.now(),
  // The field timing's own view (telemetry/journeys.ts): pending journeys, the steps it has timed, the native marks.
  journeys: devJourneys,
  telemetry: telemetryState,
  blockedFetches: () => globalThis.__nnBlockedFetches?.() ?? [],
  // The New Tab page's prewarm (src/lib/preload.ts).
  get preload() {
    return require("../../src/lib/preload");
  },
  pause(ms) {
    pausedUntil = Date.now() + ms;
  },
};
globalThis.ac = ac;

const idOf = (source) => source?.match(/^\/\/ *(\S+)/)?.[1];
let lastId = idOf(readDocument("bench-cmd.js")) ?? "";

function poll() {
  const wait = pausedUntil - Date.now();
  if (wait > 0) return void setTimeout(poll, wait);
  const source = readDocument("bench-cmd.js");
  const id = idOf(source);
  if (source && id && id !== lastId) {
    lastId = id;
    const done = (body) => writeDocument("bench-result.json", JSON.stringify({ id, ...body }));
    try {
      Promise.resolve(new Function("ac", source)(ac)).then(
        (result) => done({ result: result ?? null }),
        (error) => done({ error: String(error) }),
      );
    } catch (error) {
      done({ error: String(error) });
    }
  }
  setTimeout(poll, 50);
}
setTimeout(poll, 50);
