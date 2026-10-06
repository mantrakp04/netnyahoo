import { devCrash } from "@netnyahoo/shell";
import { createElement } from "react";
import { devState, flush, requestLog, setSharing, useTelemetry } from "./client";
import { captureException, installErrorReporting, reportNativeCrashes } from "./errors";
import { devJourneys, emitJourneys } from "./journeys";
import { devOmniboxSampler } from "./track";
import { devHourly, sessionEnding, startUsage } from "./usage";

export { installErrorReporting };

export function startTelemetry() {
  startUsage();
  if (__DEV__) {
    (globalThis as { nnTelemetry?: unknown }).nnTelemetry = {
      store: useTelemetry,
      state: devState,
      requests: requestLog,
      setSharing,
      flush,
      hourly: devHourly,
      omniboxSampler: devOmniboxSampler,
      journeys: devJourneys,
      emitJourneys,
      quit: sessionEnding,
      reportNativeCrashes,
      captureException,
      reportTestError: () =>
        captureException(
          new TypeError(`Telemetry test error reading /Users/someone/Library/secret.json for "Private Title" at https://private.example/page?q=1`),
          "onerror",
        ),
      rejectTestPromise: () => void Promise.reject(new RangeError("Telemetry test rejection at https://private.example/x")),
      showWhatsSent: () => {
        const { showSettingsSheet } = require("../components/settings/sheet") as typeof import("../components/settings/sheet");
        const { WhatsSentSheet } = require("../components/settings/panes/ShareDiagnostics") as typeof import("../components/settings/panes/ShareDiagnostics");
        showSettingsSheet(createElement(WhatsSentSheet));
      },
      crash: devCrash,
    };
  }
}
