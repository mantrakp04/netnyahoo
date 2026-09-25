import {
  calendarAuthorization,
  launchEnvironment,
  onCalendarChanged,
  readDocument,
  requestCalendarAccess,
  systemCalendarEvents,
  systemCalendars,
  type CalendarAuthorization,
  type SystemCalendar,
} from "@netnyahoo/shell";
import { useEffect, useState } from "react";
import { create } from "zustand";
import type { CalendarEvent } from "./meetings";
import { live, updateCalendarSettings, useLive } from "./store";

/**
 * Live Calendar's data: today's and tomorrow's events from macOS Calendar
 * (EventKit — whatever accounts the Mac has: iCloud, Google, Exchange…).
 * Nothing here prompts for access; `connectCalendar` does, and only runs from
 * a click. DEV builds launched with NETNYAHOO_CALENDAR_FIXTURE=1 read
 * `calendar-fixture.json` from the data directory instead (times in minutes
 * from launch), so tests never touch the real calendar or its permission.
 */
type CalendarData = {
  access: CalendarAuthorization | "fixture";
  calendars: SystemCalendar[];
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
};

export const useCalendar = create<CalendarData>()(() => ({
  access: "notDetermined",
  calendars: [],
  events: [],
  loading: false,
  error: null,
  lastFetch: null,
}));

const HORIZON_MS = 36 * 3_600_000;

type Fixture = {
  calendars: SystemCalendar[];
  events: (Omit<CalendarEvent, "start" | "end" | "occurrence"> & { startInMinutes: number; durationMinutes: number })[];
};

const fixtureMode = (() => {
  try {
    return typeof __DEV__ !== "undefined" && __DEV__ && launchEnvironment("NETNYAHOO_CALENDAR_FIXTURE") === "1";
  } catch {
    return false;
  }
})();
const launchedAt = Date.now();

function loadFixture(): { calendars: SystemCalendar[]; events: CalendarEvent[] } {
  const raw = JSON.parse(readDocument("calendar-fixture.json") ?? '{"calendars":[],"events":[]}') as Fixture;
  // Minutes are relative to the minute the app launched, so a fixture reads the same every run.
  const base = Math.floor(launchedAt / 60_000) * 60_000;
  const events = raw.events.map(({ startInMinutes, durationMinutes, ...e }) => {
    const start = base + startInMinutes * 60_000;
    return { ...e, start, end: start + durationMinutes * 60_000, occurrence: `${e.id}@${start}` };
  });
  return { calendars: raw.calendars, events };
}

const visible = (calendars: SystemCalendar[]) => {
  const hidden = new Set(live().calendar.hiddenCalendarIds);
  return calendars.filter((c) => !hidden.has(c.id)).map((c) => c.id);
};

let inflight: Promise<void> | null = null;

export function refreshCalendar(): Promise<void> {
  if (inflight) return inflight;
  const run = async () => {
    useCalendar.setState({ loading: true });
    try {
      if (fixtureMode) {
        const { calendars, events } = loadFixture();
        const ids = new Set(visible(calendars));
        useCalendar.setState({ access: "fixture", calendars, events: events.filter((e) => ids.has(e.calendarId)), error: null, lastFetch: Date.now() });
        return;
      }
      const access = calendarAuthorization();
      if (access !== "fullAccess") {
        useCalendar.setState({ access, calendars: [], events: [], error: null });
        return;
      }
      const calendars = await systemCalendars();
      const ids = visible(calendars);
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      // Every calendar hidden: nothing to show (an empty list would mean "all").
      const events = ids.length ? await systemCalendarEvents(start.getTime(), Date.now() + HORIZON_MS, ids) : [];
      useCalendar.setState({ access, calendars, events: events.sort((a, b) => a.start - b.start), error: null, lastFetch: Date.now() });
    } catch (error) {
      useCalendar.setState({ error: String((error as Error)?.message ?? error) });
    } finally {
      useCalendar.setState({ loading: false });
    }
  };
  // Cleared asynchronously: the fixture path finishes synchronously.
  inflight = run().finally(() => (inflight = null));
  return inflight;
}

/** The permission prompt (first time), then events. Only call from a user action. */
export async function connectCalendar(): Promise<boolean> {
  if (fixtureMode) {
    await refreshCalendar();
    return true;
  }
  const granted = await requestCalendarAccess();
  await refreshCalendar();
  return granted;
}

export const calendarConnected = () => {
  const access = useCalendar.getState().access;
  return access === "fullAccess" || access === "fixture";
};

let started = false;

export function startCalendar() {
  if (started) return;
  started = true;
  void refreshCalendar();
  onCalendarChanged(() => void refreshCalendar());
  setInterval(() => void refreshCalendar(), 5 * 60_000);
  // Midnight rolls today over; hidden calendars change what's shown.
  useLive.subscribe((s, prev) => {
    if (s.calendar.hiddenCalendarIds !== prev.calendar.hiddenCalendarIds) void refreshCalendar();
  });
}

export const setCalendarHidden = (id: string, hidden: boolean) => {
  const ids = live().calendar.hiddenCalendarIds.filter((c) => c !== id);
  updateCalendarSettings({ hiddenCalendarIds: hidden ? [...ids, id] : ids });
};

/** Re-renders every `intervalMs` while `enabled` (countdowns, "in 5 min"). */
export function useNow(intervalMs = 15_000, enabled = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}
