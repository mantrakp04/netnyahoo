import * as shell from "@netnyahoo/shell";
import { readDocument, writeDocument } from "@netnyahoo/shell";
import { omniboxDrivers } from "../components/omnibox/devDriver";
import { pagesDrivers } from "../components/pages/devDrivers";
import { usePages } from "../components/layout/pageState";
import { openSettings } from "../components/settings/windows";
import { useSidebarUi } from "../components/sidebar/state";
import { useBrowser } from "../store/browser";
import * as actions from "./actions";
import { runCommand } from "./commands";
import * as favicons from "./favicons";
import { probeStore } from "./perfProbe";
import { useLifecycle } from "./tabLifecycle";
import { webviews } from "./webviews";

export function startDevHarness() {
  probeStore("pages", usePages);
  probeStore("sidebarUi", useSidebarUi);
  probeStore("favicons", favicons.useFavicons);
  probeStore("lifecycle", useLifecycle);
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
    pageState: usePages,
    openSettings,
    favicons,
    get checkIn(): typeof import("./defaultBrowserCheckIn") {
      return require("./defaultBrowserCheckIn");
    },
    get media(): typeof import("../components/media/state").useMedia {
      return require("../components/media/state").useMedia;
    },
    get permissions(): typeof import("../components/site/permissions") {
      return require("../components/site/permissions");
    },
    get translate(): typeof import("../components/site/translate") {
      return require("../components/site/translate");
    },
    get toasts(): typeof import("../components/layout/splitActions").useToasts {
      return require("../components/layout/splitActions").useToasts;
    },
    get extensions(): typeof import("../components/extensions/state") {
      return require("../components/extensions/state");
    },
    // The ⌃Tab switcher: a test ends it as the user does (Esc cancels, releasing ⌃ commits), which a hidden instance
    // can't send.
    get switcher(): typeof import("../components/sidebar/switcher") {
      return require("../components/sidebar/switcher");
    },
    get toolbarAutoHide(): typeof import("../components/layout/toolbarAutoHide") {
      return require("../components/layout/toolbarAutoHide");
    },
    // Hovering moves nothing but a HoverSlot's contents (scripts/hover-shift-test.mjs).
    get hoverShift(): typeof import("./hoverShift") {
      return require("./hoverShift");
    },
    // Live folders without a service: a test makes a folder and hands it items.
    get live(): { store: typeof import("../live/store"); engine: typeof import("../live/engine") } {
      return { store: require("../live/store"), engine: require("../live/engine") };
    },
  };
  (globalThis as { nn?: typeof nn }).nn = nn;
  const scriptId = (source: string | null) => source?.match(/^\/\/ *(\S+)/)?.[1];
  let lastId = scriptId(readDocument("dev-eval.js")) ?? "";
  setInterval(function pollDevEval() {
    const source = readDocument("dev-eval.js");
    const id = scriptId(source);
    if (!source || !id || id === lastId) return;
    lastId = id;
    const done = (body: object) => writeDocument("dev-eval-result.json", JSON.stringify({ id, ...body }));
    try {
      const fn = new Function("nn", source) as (n: typeof nn) => unknown;
      Promise.resolve(fn(nn)).then(
        (result) => done({ result: result ?? null }),
        (error: unknown) => done({ error: String(error) }),
      );
    } catch (error) {
      done({ error: String(error) });
    }
    // Test scripts wait on every answer (scripts/lib/instance.mjs); a Release build's perf probe keeps the slow poll.
  }, __DEV__ ? 50 : 250);
}
