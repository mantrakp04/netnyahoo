// JS entry for native-bench.mjs: the app's own index.js plus a small command channel, bundled in production
// mode (no dev React, no Metro) so a Release build can be driven. Never part of a shipped bundle.
//
// The bench writes `bench-cmd.js` (first line `// <id>`) into NETNYAHOO_DATA_DIR; the body gets `nn` and its
// return value (or promise) lands in `bench-result.json`. Polling stops while the bench measures idle
// (`nn.pause(ms)`), so the channel adds no wakeups to what it measures.
import "../../index";
import * as shell from "@netnyahoo/shell";
import { readDocument, writeDocument } from "@netnyahoo/shell";
import * as actions from "../../src/lib/actions";
import { runCommand } from "../../src/lib/commands";
import { webviews } from "../../src/lib/webviews";
import { usePages } from "../../src/components/layout/pageState";
import { useBrowser } from "../../src/store/browser";

writeDocument("bench-boot.json", JSON.stringify({ jsStart: Date.now() }));

let pausedUntil = 0;
const nn = {
  store: useBrowser,
  pages: usePages,
  actions,
  runCommand,
  webviews,
  shell,
  now: () => Date.now(),
  pause(ms) {
    pausedUntil = Date.now() + ms;
  },
};
globalThis.nn = nn;

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
      Promise.resolve(new Function("nn", source)(nn)).then(
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
