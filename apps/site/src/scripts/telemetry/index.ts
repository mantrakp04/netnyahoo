// First-party analytics for netnyahoo.com (replaces PostHog). Importing it starts everything once:
// $pageview/$pageleave (core.ts), clicks, rage and dead clicks (autocapture.ts), errors and console logs
// (errors.ts), web vitals (vitals.ts), the flags' super properties (flags.ts) and session replay (replay.ts).
import { enabled } from "./core";
import { startAutocapture } from "./autocapture";
import { startErrors } from "./errors";
import { registerFlags } from "./flags";
import { startReplay } from "./replay";
import { startVitals } from "./vitals";

if (enabled) {
  startErrors();
  startAutocapture();
  void registerFlags();
  startVitals();
  startReplay();
}

export { capture, enabled, flush, type CaptureOptions, type Props } from "./core";
export { getFeatureFlag } from "./flags";
