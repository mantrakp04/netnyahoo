import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

/** EventKit's authorization; "unavailable" = an app build without the calendar module. */
export type CalendarAuthorization = "fullAccess" | "writeOnly" | "denied" | "restricted" | "notDetermined" | "unavailable";

export type SystemCalendar = {
  id: string;
  title: string;
  /** "#RRGGBB". */
  color: string;
  /** The account (source) it belongs to, e.g. "iCloud" or an email address. */
  account: string;
  accountType: "local" | "exchange" | "calDAV" | "subscribed" | "birthdays" | "other";
  /** False for subscribed / birthday / read-only calendars. */
  owned: boolean;
};

export type CalendarParticipant = { name: string; email: string; status: "accepted" | "declined" | "tentative" | "pending"; me: boolean };

export type SystemCalendarEvent = {
  id: string;
  /** Unique per occurrence of a recurring event. */
  occurrence: string;
  calendarId: string;
  color: string;
  title: string;
  /** ms since the epoch. */
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  notes: string;
  url: string;
  cancelled: boolean;
  /** The user declined the invitation. */
  declined: boolean;
  organizer: CalendarParticipant | null;
  attendees: CalendarParticipant[];
};

const Calendar = requireOptionalNativeModule<{
  addListener(name: "onCalendarChanged", listener: () => void): EventSubscription;
  authorizationStatus(): CalendarAuthorization;
  requestAccess(): Promise<boolean>;
  calendars(): Promise<SystemCalendar[]>;
  events(start: number, end: number, calendarIds: string[]): Promise<SystemCalendarEvent[]>;
}>("NetnyahooCalendar");

/** Never prompts. */
export const calendarAuthorization = (): CalendarAuthorization => Calendar?.authorizationStatus() ?? "unavailable";
/** Shows macOS's calendar permission prompt (first time only). Call only from a user action. */
export const requestCalendarAccess = async () => (await Calendar?.requestAccess()) ?? false;
export const systemCalendars = async () => (await Calendar?.calendars()) ?? [];
/** Events overlapping [start, end] in the given calendars (every calendar when the list is empty). */
export const systemCalendarEvents = async (start: number, end: number, calendarIds: string[] = []) =>
  (await Calendar?.events(start, end, calendarIds)) ?? [];
/** Calendar data changed (an event edited here or synced from the account). */
export const onCalendarChanged = (listener: () => void) => Calendar?.addListener("onCalendarChanged", listener) ?? { remove() {} };

const Keychain = requireOptionalNativeModule<{
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<boolean>;
  delete(account: string): Promise<boolean>;
}>("NetnyahooKeychain");

/** False on app builds without the keychain module (secrets then last until quit). */
export const hasKeychain = !!Keychain;
const memory = new Map<string, string>();

/** A connected service's secret from the login keychain (null when absent). */
export const keychainGet = async (account: string) => (Keychain ? await Keychain.get(account) : (memory.get(account) ?? null));
export const keychainSet = async (account: string, secret: string) => {
  if (Keychain) return Keychain.set(account, secret);
  memory.set(account, secret);
  return true;
};
export const keychainDelete = async (account: string) => {
  if (Keychain) return Keychain.delete(account);
  memory.delete(account);
  return true;
};
