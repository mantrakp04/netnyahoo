import { devCrash } from "@netnyahoo/shell";
import { createElement } from "react";
import { devState, flush, requestLog, setSharing, useTelemetry } from "./client";
import { captureException, installErrorReporting, reportNativeCrashes } from "./errors";
import { devOmniboxSampler } from "./track";
import { devHourly, sessionEnding, startUsage } from "./usage";

/**
 * Opt-in, anonymous telemetry (PostHog): crash and error reports, coarse feature counts and
 * performance numbers, off until the user turns it on. What's sent is listed in copy.ts
 * (Settings › Privacy & Security › What's Sent) and filtered by sanitize.ts.
 *
 * Startup: `installErrorReporting()` first thing, `startTelemetry()` once the session and sync
 * have started.
 */
export { installErrorReporting };
export { dismissAsk, setSharing, useTelemetry, type SharingSource } from "./client";

export function startTelemetry() {
  startUsage();
  if (__DEV__) {
    // DEV: the dev harness reaches it as `globalThis.nnTelemetry`.
    (globalThis as { nnTelemetry?: unknown }).nnTelemetry = {
      store: useTelemetry,
      state: devState,
      requests: requestLog,
      setSharing,
      flush,
      hourly: devHourly,
      omniboxSampler: devOmniboxSampler,
      /** What quitting does (willQuit): ends the session and writes the queue to disk. */
      quit: sessionEnding,
      reportNativeCrashes,
      captureException,
      /**
       * An error with an address, a path and quoted text in it (all must be scrubbed), reported the
       * way the global handler reports it. (A real uncaught error in DEV opens LogBox, which
       * crashes react-native-macos.)
       */
      reportTestError: () =>
        captureException(
          new TypeError(`Telemetry test error reading /Users/someone/Library/secret.json for "Private Title" at https://private.example/page?q=1`),
          "onerror",
        ),
      /** A real unhandled rejection, through Hermes' tracker. */
      rejectTestPromise: () => void Promise.reject(new RangeError("Telemetry test rejection at https://private.example/x")),
      /** Settings › Privacy & Security › What's Sent, over an open Settings window. */
      showWhatsSent: () => {
        const { showSettingsSheet } = require("../components/settings/sheet") as typeof import("../components/settings/sheet");
        const { WhatsSentSheet } = require("../components/settings/panes/ShareDiagnostics") as typeof import("../components/settings/panes/ShareDiagnostics");
        showSettingsSheet(createElement(WhatsSentSheet));
      },
      /** Crashes the app (native): its report is sent on the next launch. */
      crash: devCrash,
    };
  }
}
