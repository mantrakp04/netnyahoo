import { confirm } from "@netnyahoo/shell";
import { useBrowser, type BrowserState } from "../store/browser";
import { activeTabId } from "../store/model";
import { groupOf } from "../store/organize";
import { connectCalendar, useCalendar } from "./calendar";
import { eventForCall, isCalendarUrl, meetingOf, relatedLinks, type CalendarEvent } from "./meetings";
import { live, setMeetingGroup, updateCalendarSettings } from "./store";

/**
 * Tab Groups for Meetings (Dia 1.14): joining a call — opening a Meet, Zoom or
 * Teams link — makes a meeting group around it, named after the calendar event;
 * links opened from the meeting's tabs join it. It counts down near the end
 * (the header wiggles at 5 and 2 minutes left, see GroupBlock), becomes a
 * normal group when the meeting is over, and closes itself (to Recently Closed
 * Groups) once it has sat unused for a while after.
 */
export const MEETING_FALLBACK_TITLE = "Meeting";
const CLEANUP_IDLE_MS = 30 * 60_000;

const store = () => useBrowser.getState();

/** Makes (or finds) the meeting group for a call tab. Returns the group id, or "". */
export function groupCall(tabId: string, event?: CalendarEvent | null): string {
  const s = store();
  const tab = s.tabs[tabId];
  const call = tab && meetingOf(tab.url);
  if (!tab || !call || tab.pinned) return "";
  const current = groupOf(s, tabId);
  if (current) return live().meetingGroups[current.id] ? current.id : "";
  const match = event ?? eventForCall(useCalendar.getState().events, tab.url, Date.now());
  // Rejoining a call whose group is still open puts the tab back in it.
  const same = Object.values(live().meetingGroups).find((m) => {
    const g = s.groups[m.groupId];
    const callTab = s.tabs[m.callTabId];
    return g && g.windowId === tab.windowId && !m.endedAt && ((!!m.occurrence && m.occurrence === match?.occurrence) || (!!callTab && meetingOf(callTab.url)?.key === call.key));
  });
  if (same) {
    s.addTabsToGroup(same.groupId, [tabId]);
    return same.groupId;
  }
  const title = match?.title || MEETING_FALLBACK_TITLE;
  const groupId = s.createGroup([tabId], { name: title });
  if (!groupId) return "";
  setMeetingGroup({ groupId, callTabId: tabId, occurrence: match?.occurrence ?? null, title, start: match?.start ?? null, end: match?.end ?? null, endedAt: null });
  return groupId;
}

/**
 * Join / Open All and Join: opens the call as a tab (grouped when "Automatically
 * group tabs for meetings" is on) and, with `openAll`, the invitation's links.
 */
export function joinMeeting(windowId: string, event: CalendarEvent, joinUrl: string, openAll = false) {
  const s = store();
  if (!s.windows[windowId]) return;
  const callTab = s.newTab(windowId, { url: joinUrl });
  const grouped = s.settings.autoGroupMeetingTabs ? groupCall(callTab, event) : "";
  if (openAll) {
    for (const url of relatedLinks(event)) {
      const id = store().newTab(windowId, { url, background: true, openerId: callTab });
      if (grouped && !groupOf(store(), id)) store().addTabsToGroup(grouped, [id]);
    }
  }
  store().activate(callTab);
}

let started = false;

export function startMeetingGroups() {
  if (started) return;
  started = true;

  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    for (const id in s.tabs) {
      const tab = s.tabs[id]!;
      const before = prev.tabs[id];
      if (before && before.url === tab.url && before.pinned === tab.pinned) continue;
      // Joined a call.
      if (s.settings.autoGroupMeetingTabs && !tab.pinned && meetingOf(tab.url) && (!before || !meetingOf(before.url))) groupCall(id);
      // A link opened from a meeting's tab joins its group.
      if (!before && tab.openerId && !groupOf(s, id)) {
        const opener = groupOf(s, tab.openerId);
        if (opener && live().meetingGroups[opener.id] && !live().meetingGroups[opener.id]!.endedAt) store().addTabsToGroup(opener.id, [id]);
      }
      // A calendar pinned for the first time: offer meeting alerts (Dia's "Pin calendar for meeting reminders").
      if (tab.pinned && isCalendarUrl(tab.url) && (!before || !before.pinned) && !live().calendar.prompted) void offerAlerts(tab.windowId);
    }
  });

  setInterval(() => tick(store(), Date.now()), 20_000);
}

async function offerAlerts(windowId: string) {
  updateCalendarSettings({ prompted: true });
  const { confirmed } = await confirm({
    title: "Would you like to see meeting alerts for this calendar?",
    message: "Netnyahoo can alert you when a new meeting is about to begin. You can hide these alerts or manage how close to a meeting start they show up.",
    confirmTitle: "Show Alerts",
    cancelTitle: "Don't Show These Alerts",
    windowId,
  });
  if (confirmed) await connectCalendar();
  else updateCalendarSettings({ alertLead: "never" });
}

/** Meeting ends → normal group; idle ended groups close; groups that went away are forgotten. */
export function tick(s: BrowserState, now: number) {
  for (const m of Object.values(live().meetingGroups)) {
    const g = s.groups[m.groupId];
    if (!g) {
      setMeetingGroup(null, m.groupId);
      continue;
    }
    if (!m.endedAt) {
      const callTab = s.tabs[m.callTabId];
      const leftCall = !callTab || !meetingOf(callTab.url);
      // Unscheduled calls end when you leave them.
      if ((m.end !== null && now >= m.end) || (m.end === null && leftCall)) setMeetingGroup({ ...m, endedAt: now });
      continue;
    }
    const w = s.windows[g.windowId];
    const active = w ? activeTabId(s, w.id) : undefined;
    const busy = g.tabIds.some((id) => id === active || s.live[id]?.playingAudio);
    const lastUse = Math.max(m.endedAt, ...g.tabIds.map((id) => s.tabs[id]?.lastActiveAt ?? 0));
    if (!busy && now - lastUse >= CLEANUP_IDLE_MS) {
      setMeetingGroup(null, m.groupId);
      store().closeGroup(m.groupId);
    }
  }
}
