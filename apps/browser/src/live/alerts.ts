import { onAppEvent, onWindowEvent, postNotification, removeNotifications } from "@netnyahoo/shell";
import { create } from "zustand";
import { useBrowser } from "../store/browser";
import { useCalendar } from "./calendar";
import { joinMeeting } from "./meetingGroups";
import { ALERT_LEADS, dueAlerts, joinLink, joinTitle, relativeTime, type CalendarEvent } from "./meetings";
import { dismissAlert, live } from "./store";

/**
 * Just-in-time meeting alerts ("Show Next Meeting Alert"): a card with the
 * meeting, its attendees and a one-click Join, shown in the front window a set
 * time before the start (components/live/MeetingAlert). With "Always", the
 * alert also goes to Notification Center while Netnyahoo isn't the active app
 * (clicking it brings the app forward to the card).
 */
export const useMeetingAlert = create<{ event: CalendarEvent | null }>()(() => ({ event: null }));

let appActive = true;
const notified = new Set<string>();

export function alertEvent(now = Date.now()): CalendarEvent | null {
  const lead = ALERT_LEADS.find((l) => l.value === live().calendar.alertLead)?.minutes;
  if (lead === null || lead === undefined) return null;
  return dueAlerts(useCalendar.getState().events, now, lead, new Set(live().dismissedAlerts))[0] ?? null;
}

function check() {
  const event = alertEvent();
  const current = useMeetingAlert.getState().event;
  if (event?.occurrence !== current?.occurrence) useMeetingAlert.setState({ event });
  if (!event || appActive || live().calendar.alertCondition !== "always" || notified.has(event.occurrence)) return;
  notified.add(event.occurrence);
  const link = joinLink(event);
  const when = relativeTime(event.start, Date.now());
  // Clicking it brings Netnyahoo forward, where the alert card has Join.
  void postNotification({
    id: `meeting:${event.occurrence}`,
    title: event.title || "Untitled event",
    body: `${when === "Now" ? "Starting now" : event.start < Date.now() ? `Started ${when}` : `Starts ${when}`}${link ? ` · ${joinTitle(link.provider)}` : ""}`,
    data: { meeting: event.occurrence },
  });
}

/** Join (or Open All and Join) from the alert, the calendar preview or a notification. */
export function joinEvent(event: CalendarEvent, openAll = false, windowId = frontWindow()) {
  const link = joinLink(event);
  if (!link || !windowId) return;
  joinMeeting(windowId, event, link.url, openAll);
  dismiss(event);
}

export function dismiss(event: CalendarEvent) {
  dismissAlert(event.occurrence);
  void removeNotifications([`meeting:${event.occurrence}`]);
  if (useMeetingAlert.getState().event?.occurrence === event.occurrence) useMeetingAlert.setState({ event: null });
  check();
}

const frontWindow = () => {
  const s = useBrowser.getState();
  const id = s.ui.focusedWindowId;
  return id && s.windows[id] && !s.windows[id]!.incognito ? id : s.windowOrder.find((w) => !s.windows[w]!.incognito);
};

let started = false;

export function startMeetingAlerts() {
  if (started) return;
  started = true;
  onAppEvent((e) => {
    if (e.type === "resignActive") appActive = false;
  });
  onWindowEvent((e) => {
    if (e.type === "focus") appActive = true;
  });
  useCalendar.subscribe((s, prev) => s.events !== prev.events && check());
  setInterval(check, 10_000);
  check();
}
