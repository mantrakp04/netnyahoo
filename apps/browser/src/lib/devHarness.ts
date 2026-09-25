import * as shell from "@netnyahoo/shell";
import { readDocument, writeDocument } from "@netnyahoo/shell";
import { omniboxDrivers } from "../components/omnibox/devDriver";
import { pagesDrivers } from "../components/pages/devDrivers";
import { usePages } from "../components/layout/pageState";
import { openSettings } from "../components/settings/windows";
import { useBrowser } from "../store/browser";
import * as actions from "./actions";
import { runCommand } from "./commands";
import * as favicons from "./favicons";
import { webviews } from "./webviews";

/**
 * DEV builds only: lets tooling drive this instance's JS. Write a script to
 * `$NETNYAHOO_DATA_DIR/dev-eval.js` (first line `// <id>`); it runs with
 * `nn` = { store, actions, runCommand, webviews, shell, omnibox } in scope and its return
 * value (awaited if it's a promise) lands in `dev-eval-result.json` as { id, result } or { id, error }.
 */
export function startDevHarness() {
  // Console errors/warnings also go to `dev-console.log` (LogBox itself can't be shown: its
  // views use RN shadow props, which crash react-native-macos — see index.js).
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        const line = `${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" ")}\n`;
        writeDocument("dev-console.log", (readDocument("dev-console.log") ?? "").slice(-200_000) + line);
      } catch {}
    };
  }

  const nn = {
    store: useBrowser, actions, runCommand, webviews, shell, omnibox: omniboxDrivers, pages: pagesDrivers,
    /** Per-tab page state (prompts, the autofill menu…). */
    pageState: usePages,
    /** Opens Settings at a pane (and profile): `nn.openSettings("profiles", id)`. */
    openSettings,
    /** The favicon cache (lib/favicons): `nn.favicons.useFavicons.getState().profiles`. */
    favicons,
    /** The default-browser week check-in (loaded on first use, like the New Tab page does). */
    get checkIn(): typeof import("./defaultBrowserCheckIn") {
      return require("./defaultBrowserCheckIn");
    },
    /** Media state, e.g. pending screen-share requests: `nn.media.getState().displayRequests`. */
    get media(): typeof import("../components/media/state").useMedia {
      return require("../components/media/state").useMedia;
    },
    /** Answers a tab's pending permission prompt: `nn.permissions.answerPermission(tabId, "accept")`. */
    get permissions(): typeof import("../components/site/permissions") {
      return require("../components/site/permissions");
    },
    /** Extensions (install, toolbar actions, popups): `nn.extensions.activateExtension(windowId, ext, anchor)`. */
    get extensions(): typeof import("../components/extensions/state") {
      return require("../components/extensions/state");
    },
  };
  (globalThis as { nn?: typeof nn }).nn = nn;
  const scriptId = (source: string | null) => source?.match(/^\/\/ *(\S+)/)?.[1];
  // A script left over from before a reload has already run.
  let lastId = scriptId(readDocument("dev-eval.js")) ?? "";
  setInterval(() => {
    const source = readDocument("dev-eval.js");
    const id = scriptId(source);
    if (!source || !id || id === lastId) return;
    lastId = id;
    const done = (body: object) => writeDocument("dev-eval-result.json", JSON.stringify({ id, ...body }));
    try {
      // Hermes can't compile async functions at runtime; return a promise to wait on one.
      const fn = new Function("nn", source) as (n: typeof nn) => unknown;
      Promise.resolve(fn(nn)).then(
        (result) => done({ result: result ?? null }),
        (error: unknown) => done({ error: String(error) }),
      );
    } catch (error) {
      done({ error: String(error) });
    }
  }, 250);
}
