import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

export type CalendarAuthorization = "fullAccess" | "writeOnly" | "denied" | "restricted" | "notDetermined" | "unavailable";

export type SystemCalendar = {
  id: string;
  title: string;
  color: string;
  account: string;
  accountType: "local" | "exchange" | "calDAV" | "subscribed" | "birthdays" | "other";
  owned: boolean;
};

export type CalendarParticipant = { name: string; email: string; status: "accepted" | "declined" | "tentative" | "pending"; me: boolean };

export type SystemCalendarEvent = {
  id: string;
  occurrence: string;
  calendarId: string;
  color: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  notes: string;
  url: string;
  cancelled: boolean;
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

export const calendarAuthorization = (): CalendarAuthorization => Calendar?.authorizationStatus() ?? "unavailable";
export const requestCalendarAccess = async () => (await Calendar?.requestAccess()) ?? false;
export const systemCalendars = async () => (await Calendar?.calendars()) ?? [];
export const systemCalendarEvents = async (start: number, end: number, calendarIds: string[] = []) =>
  (await Calendar?.events(start, end, calendarIds)) ?? [];
export const onCalendarChanged = (listener: () => void) => Calendar?.addListener("onCalendarChanged", listener) ?? { remove() {} };

const Keychain = requireOptionalNativeModule<{
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<boolean>;
  delete(account: string): Promise<boolean>;
}>("NetnyahooKeychain");

const memory = new Map<string, string>();

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
