import { updaterState } from "@netnyahoo/shell";
import { afterFirstWindow } from "./afterFirstWindow";
import { refreshSwitches } from "./killSwitches";

/**
 * Fetches netnyahoo.com/switches.json once this launch, after the first window is up, and only where the update check
 * runs too: a build with an updater that's set up and automatic checks on. Turning those off (Settings › General) stops
 * this request along with them. A test instance has no updater, so it never asks; NETNYAHOO_SWITCHES sets its values.
 */
export function startKillSwitches() {
  afterFirstWindow(() => {
    void updaterState().then(
      (state) => {
        if (state.available && state.configured && state.automaticChecks) void refreshSwitches();
      },
      () => {},
    );
  });
}
