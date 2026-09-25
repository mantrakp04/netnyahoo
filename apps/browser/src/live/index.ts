import * as alerts from "./alerts";
import * as calendar from "./calendar";
import * as engine from "./engine";
import * as googleAuth from "./googleAuth";
import * as meetingGroups from "./meetingGroups";
import * as sources from "./sources";
import * as store from "./store";

/** Live folders and Live Calendar: started once, after the session is restored (sidebar effects). */
export function startLive() {
  engine.startLiveEngine();
  calendar.startCalendar();
  meetingGroups.startMeetingGroups();
  alerts.startMeetingAlerts();
  // DEV: dev-eval scripts (lib/devHarness) reach these as globalThis.nnLive.
  if (__DEV__) {
    // Sidebar hover cards, to show them without a pointer.
    const hover = require("../components/sidebar/hover") as typeof import("../components/sidebar/hover");
    const settings = require("../components/settings/windows") as typeof import("../components/settings/windows");
    (globalThis as { nnLive?: object }).nnLive = { alerts, calendar, engine, googleAuth, meetingGroups, sources, store, hover, settings };
  }
}
