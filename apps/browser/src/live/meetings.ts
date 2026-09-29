import type { CalendarParticipant, SystemCalendarEvent } from "@netnyahoo/shell";

export type CalendarEvent = SystemCalendarEvent;
export type MeetingProvider = "meet" | "zoom" | "teams" | "webex" | "other";

const host = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const path = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};

export function isCalendarUrl(url: string): boolean {
  const h = host(url);
  const p = path(url);
  if (h === "calendar.google.com" || h === "calendar.notion.so" || h === "calendar.proton.me" || h === "app.fantastical.com") return true;
  if (/^outlook\.(live|office|office365)\.com$/.test(h) || h === "outlook.cloud.microsoft") return p.startsWith("/calendar");
  if (h === "teams.microsoft.com" || h === "teams.cloud.microsoft" || h === "teams.live.com") return !isMeetingUrl(url);
  if (h === "www.icloud.com" || h === "icloud.com") return p.startsWith("/calendar");
  return false;
}

export function meetingOf(url: string): { provider: MeetingProvider; key: string } | null {
  const h = host(url);
  const p = path(url);
  if (h === "meet.google.com") {
    const code = p.match(/^\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})\b/i)?.[1];
    return code ? { provider: "meet", key: `meet:${code.toLowerCase()}` } : null;
  }
  if (h === "zoom.us" || h.endsWith(".zoom.us") || h === "zoom.com" || h.endsWith(".zoom.com")) {
    const id = p.match(/^\/(?:j|s|w|wc(?:\/join)?|my)\/([\w.-]+)/)?.[1] ?? p.match(/^\/wc\/([\d]+)\/join/)?.[1];
    return id ? { provider: "zoom", key: `zoom:${id.toLowerCase()}` } : null;
  }
  if (h === "teams.microsoft.com" || h === "teams.cloud.microsoft" || h === "teams.live.com") {
    if (p.startsWith("/l/meetup-join/") || p.startsWith("/meet/") || (p.startsWith("/v2/") && url.includes("meetup-join"))) {
      return { provider: "teams", key: `teams:${decodeURIComponent(p).slice(0, 160)}` };
    }
    return null;
  }
  if (h.endsWith(".webex.com") && /^\/(meet|join|[\w-]+\/j\.php)/.test(p)) return { provider: "webex", key: `webex:${h}${p}` };
  return null;
}

export const isMeetingUrl = (url: string) => !!meetingOf(url);

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;
const NOISE = [
  /(^|\.)support\.google\.com$/,
  /(^|\.)accounts\.google\.com$/,
  /^tel\./,
  /(^|\.)aka\.ms$/,
  /(^|\.)go\.microsoft\.com$/,
  /(^|\.)microsoft\.com$/,
  /(^|\.)zoom\.us$/,
  /(^|\.)zoom\.com$/,
  /(^|\.)apple\.com$/,
  /^calendar\.google\.com$/,
  /^meet\.google\.com$/,
];

function links(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))];
}

export function joinLink(event: Pick<CalendarEvent, "url" | "location" | "notes">): { url: string; provider: MeetingProvider } | null {
  for (const text of [event.url, event.location, event.notes]) {
    for (const url of links(text ?? "")) {
      const m = meetingOf(url);
      if (m) return { url, provider: m.provider };
    }
  }
  return null;
}

export function relatedLinks(event: Pick<CalendarEvent, "url" | "location" | "notes">): string[] {
  const join = joinLink(event)?.url;
  return links(`${event.url ?? ""} ${event.location ?? ""} ${event.notes ?? ""}`).filter((u) => {
    if (u === join || isMeetingUrl(u)) return false;
    const h = host(u);
    return !!h && !NOISE.some((re) => re.test(h));
  });
}

export const isMeeting = (e: CalendarEvent) => !e.allDay && !e.cancelled && !e.declined;

export function currentOrNext(events: CalendarEvent[], now: number): CalendarEvent | null {
  const meetings = events.filter(isMeeting).filter((e) => e.end > now);
  const current = meetings.filter((e) => e.start <= now).sort((a, b) => b.start - a.start)[0];
  return current ?? meetings.sort((a, b) => a.start - b.start)[0] ?? null;
}

export function eventForCall(events: CalendarEvent[], url: string, now: number): CalendarEvent | null {
  const key = meetingOf(url)?.key;
  if (!key) return null;
  const matches = events.filter((e) => isMeeting(e) && meetingOf(joinLink(e)?.url ?? "")?.key === key);
  return matches.sort((a, b) => Math.abs(a.start - now) - Math.abs(b.start - now))[0] ?? null;
}

const MINUTE = 60_000;

export function badgeText(events: CalendarEvent[], now: number, withinMs = 60 * MINUTE): string | null {
  const e = currentOrNext(events, now);
  if (!e) return null;
  if (e.start <= now) return "Now";
  const ms = e.start - now;
  if (ms > withinMs) return null;
  const min = Math.ceil(ms / MINUTE);
  return min >= 60 ? `${Math.floor(min / 60)}h` : `${min}m`;
}

export function relativeTime(at: number, now: number): string {
  const min = Math.round((at - now) / MINUTE);
  if (min === 0) return "Now";
  const abs = Math.abs(min);
  const text = abs >= 60 ? `${Math.floor(abs / 60)} hr${abs % 60 ? ` ${abs % 60} min` : ""}` : `${abs} min`;
  return min > 0 ? `in ${text}` : `${text} ago`;
}

export function ago(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / MINUTE);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function timeRemaining(end: number, now: number): string {
  const min = Math.ceil((end - now) / MINUTE);
  if (min <= 0) return "Ending now";
  return min >= 60 ? `${Math.floor(min / 60)} hr ${min % 60} min left` : `${min} min left`;
}

// Dia: 5 / 2 min.
export const WIGGLE_MARKS_MIN = [5, 2];

const displayName = (p: CalendarParticipant) => p.name || p.email.split("@")[0] || "Guest";

export function attendeesLabel(event: Pick<CalendarEvent, "attendees">): string {
  const others = event.attendees.filter((p) => !p.me);
  const names = others.map(displayName);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

export function guestsLabel(event: Pick<CalendarEvent, "attendees">): string {
  const n = event.attendees.length;
  return n === 1 ? "1 guest" : `${n} guests`;
}

export function timeRange(event: Pick<CalendarEvent, "start" | "end">): string {
  const fmt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${fmt(event.start)} – ${fmt(event.end)}`;
}

export function joinTitle(provider: MeetingProvider | undefined): string {
  if (provider === "meet") return "Join with Google Meet";
  if (provider === "zoom") return "Join with Zoom";
  if (provider === "teams") return "Join Microsoft Teams Meeting";
  return "Join";
}

export const ALERT_LEADS: { value: string; title: string; minutes: number | null }[] = [
  { value: "never", title: "Never", minutes: null },
  { value: "start", title: "At Meeting Start", minutes: 0 },
  { value: "1", title: "One Minute Before", minutes: 1 },
  { value: "2", title: "Two Minutes Before", minutes: 2 },
  { value: "3", title: "Three Minutes Before", minutes: 3 },
  { value: "5", title: "Five Minutes Before", minutes: 5 },
  { value: "10", title: "Ten Minutes Before", minutes: 10 },
];

export function dueAlerts(events: CalendarEvent[], now: number, leadMinutes: number, dismissed: Set<string>): CalendarEvent[] {
  return events
    .filter(isMeeting)
    .filter((e) => !dismissed.has(e.occurrence) && now >= e.start - leadMinutes * MINUTE && now < Math.min(e.end, e.start + 5 * MINUTE))
    .sort((a, b) => a.start - b.start);
}
