// Live folders and Live Calendar: mappers, stacks, CI copy, unread / completion, meetings.
// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/live/live.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const github = await import("./github.ts");
const documents = await import("./documents.ts");
const meetings = await import("./meetings.ts");
const liveStore = await import("./store.ts");
const { useBrowser } = await import("../store/browser.ts");
const { useCalendar } = await import("./calendar.ts");
const meetingGroups = await import("./meetingGroups.ts");

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const ALL = { authored: true, reviewRequests: true };

test("GitHub: sections, review requests direct vs team, filters", () => {
  const items = github.mapGithub(fixture("github.json"), ALL);
  assert.deepEqual(items.map((i) => [i.pr.number, i.section]), [[101, "authored"], [102, "authored"], [103, "authored"], [57, "authored"], [88, "review"], [412, "team"]]);
  assert.equal(items[0].subtitle, "acme/browser #101");
  assert.equal(items[0].id, "github:PR_101");
  assert.deepEqual(github.mapGithub(fixture("github.json"), { authored: false, reviewRequests: true }).map((i) => i.pr.number), [88, 412]);
  assert.deepEqual(github.mapGithub(fixture("github.json"), { authored: true, reviewRequests: false }).map((i) => i.pr.number), [101, 102, 103, 57]);
});

test("GitHub: stacked PRs get positions from the bottom", () => {
  const items = github.mapGithub(fixture("github.json"), ALL);
  const stack = (n) => items.find((i) => i.pr.number === n).pr.stack;
  assert.deepEqual([stack(101).position, stack(102).position, stack(103).position], [1, 2, 3]);
  assert.equal(stack(101).size, 3);
  assert.equal(stack(101).id, stack(103).id);
  assert.equal(stack(57), undefined);
  assert.equal(stack(88), undefined, "a different branch in the same repo isn't stacked");
});

test("GitHub: CI summary lines and row badge", () => {
  const items = github.mapGithub(fixture("github.json"), ALL);
  const pr = (n) => items.find((i) => i.pr.number === n).pr;
  assert.equal(github.summarizeChecks(pr(101).checks).text, "All checks have passed");
  assert.equal(github.summarizeChecks(pr(102).checks).text, "2 checks are failing");
  assert.equal(github.summarizeChecks(pr(103).checks).text, "Some checks haven't completed yet");
  assert.equal(github.summarizeChecks(pr(88).checks).text, "Checks are queued");
  assert.equal(github.summarizeChecks([{ name: "a", state: "failure", url: null }]).text, "1 check is failing");
  assert.equal(github.summarizeChecks([]), null);
  assert.equal(github.prBadge(pr(57)), "conflict");
  assert.equal(github.prBadge(pr(102)), "failing");
  assert.equal(github.prBadge(pr(101)), "approved");
  assert.equal(github.prBadge(pr(103)), "pending");
  assert.equal(pr(102).unresolvedThreads, 1);
  assert.equal(pr(57).review, "changesRequested");
  assert.equal(pr(57).mergeable, "conflicting");
});

test("Documents: Notion, Confluence and Drive mapping", () => {
  const notion = documents.mapNotion(fixture("notion-search.json"), fixture("notion-users.json"), "Acme");
  assert.deepEqual(notion.map((i) => i.title), ["Q4 Roadmap", "Live folders spec", "Bug triage"], "archived pages are left out");
  assert.equal(notion[0].icon, "🗺️");
  assert.equal(notion[0].doc.editedBy, "Mira Chen");
  assert.equal(notion[2].doc.kind, "Database");
  const conf = documents.mapConfluence(fixture("confluence-search.json"), "https://acme.atlassian.net");
  assert.equal(conf[0].url, "https://acme.atlassian.net/wiki/spaces/ENG/pages/9001/Onboarding+checklist");
  assert.equal(conf[0].subtitle, "Engineering");
  const drive = documents.mapDrive(fixture("drive-files.json"));
  assert.deepEqual(drive.map((i) => i.doc.kind), ["Document", "Spreadsheet"]);
});

test("Store: first fetch fills quietly, new items are unread, merges animate out", () => {
  const id = liveStore.createFolder("default", "pullRequests");
  const items = github.mapGithub(fixture("github.json"), ALL);
  liveStore.applyFetch(id, items, {}, 1000);
  assert.deepEqual(liveStore.live().unread[id], []);
  const added = { ...items[4], id: "github:PR_900", title: "New" };
  liveStore.applyFetch(id, [added, ...items], {}, 2000);
  assert.deepEqual(liveStore.live().unread[id], ["github:PR_900"]);
  // Items of a source just added to the folder aren't unread.
  const bb = { ...items[0], id: "bitbucket:acme/x#1", source: "bitbucket" };
  liveStore.applyFetch(id, [added, bb, ...items], {}, 2500, new Set([bb.id]));
  assert.deepEqual(liveStore.live().unread[id], ["github:PR_900"]);
  liveStore.markRead(id, ["github:PR_900"]);
  assert.deepEqual(liveStore.live().unread[id], []);
  // PR 101 merged: it stays (animating) in place, and is recorded as completed.
  const rest = [added, ...items.filter((i) => i.pr.number !== 101)];
  liveStore.applyFetch(id, rest, { "github:PR_101": "merged" }, 3000);
  assert.ok(liveStore.live().items[id].some((i) => i.id === "github:PR_101"));
  assert.deepEqual(liveStore.live().completing[id], ["github:PR_101"]);
  assert.equal(liveStore.live().completed[id][0].state, "merged");
  // A refresh during the animation keeps it; then it leaves.
  liveStore.applyFetch(id, rest, {}, 3500);
  assert.ok(liveStore.live().items[id].some((i) => i.id === "github:PR_101"));
  liveStore.finishCompleting(id, ["github:PR_101"]);
  assert.ok(!liveStore.live().items[id].some((i) => i.id === "github:PR_101"));
  assert.equal(liveStore.live().completed[id].length, 1);
  liveStore.removeFolder(id);
  assert.equal(liveStore.live().folders[id], undefined);
});

// Meetings

const at = (min) => Date.UTC(2026, 8, 25, 15, 0) + min * 60_000;
const event = (over) => ({
  id: "e", occurrence: `e@${over.start ?? 0}`, calendarId: "work", color: "#000", title: "Sync", start: at(0), end: at(30), allDay: false,
  location: "", notes: "", url: "", cancelled: false, declined: false, organizer: null, attendees: [], ...over,
});

test("Meetings: call and calendar URLs", () => {
  assert.deepEqual(meetings.meetingOf("https://meet.google.com/abc-defg-hij?authuser=0"), { provider: "meet", key: "meet:abc-defg-hij" });
  assert.equal(meetings.meetingOf("https://meet.google.com/landing"), null);
  assert.equal(meetings.meetingOf("https://acme.zoom.us/j/81234567890?pwd=x").key, "zoom:81234567890");
  assert.equal(meetings.meetingOf("https://zoom.us/wc/join/81234567890").key, "zoom:81234567890");
  assert.equal(meetings.meetingOf("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0").provider, "teams");
  assert.equal(meetings.meetingOf("https://teams.microsoft.com/v2/"), null);
  assert.ok(meetings.isCalendarUrl("https://calendar.google.com/calendar/u/0/r"));
  assert.ok(meetings.isCalendarUrl("https://outlook.office.com/calendar/view/week"));
  assert.ok(!meetings.isCalendarUrl("https://outlook.office.com/mail/"));
  assert.ok(meetings.isCalendarUrl("https://www.icloud.com/calendar/"));
  assert.ok(!meetings.isCalendarUrl("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0"));
});

test("Meetings: join link and related links from the invitation", () => {
  const cal = fixture("calendar-fixture.json");
  const design = cal.events.find((e) => e.id === "design");
  assert.equal(meetings.joinLink(design).url, "https://meet.google.com/abc-defg-hij");
  assert.deepEqual(meetings.relatedLinks(design), ["https://docs.google.com/document/d/spec123/edit", "https://www.figma.com/file/xyz/Live-Folders"]);
  const allhands = cal.events.find((e) => e.id === "allhands");
  assert.equal(meetings.joinLink(allhands).provider, "teams");
  assert.equal(meetings.joinTitle("meet"), "Join with Google Meet");
  assert.equal(meetings.joinTitle("teams"), "Join Microsoft Teams Meeting");
});

test("Meetings: next meeting, badge, countdown and alerts", () => {
  const events = [
    event({ occurrence: "a", start: at(-60), end: at(-30) }),
    event({ occurrence: "b", start: at(10), end: at(40) }),
    event({ occurrence: "c", start: at(5), end: at(20), declined: true }),
    event({ occurrence: "d", start: at(-600), end: at(800), allDay: true }),
  ];
  assert.equal(meetings.badgeText(events, at(0)), "10m");
  assert.equal(meetings.badgeText(events, at(12)), "Now");
  assert.equal(meetings.badgeText(events, at(-200)), null, "nothing within the hour");
  assert.equal(meetings.relativeTime(at(10), at(0)), "in 10 min");
  assert.equal(meetings.relativeTime(at(70), at(0)), "in 1 hr 10 min");
  assert.equal(meetings.timeRemaining(at(40), at(35)), "5 min left");
  assert.equal(meetings.timeRemaining(at(40), at(40)), "Ending now");
  assert.deepEqual(meetings.dueAlerts(events, at(9), 1, new Set()).map((e) => e.occurrence), ["b"]);
  assert.deepEqual(meetings.dueAlerts(events, at(8), 1, new Set()), []);
  assert.deepEqual(meetings.dueAlerts(events, at(9), 1, new Set(["b"])), [], "dismissed");
  assert.deepEqual(meetings.dueAlerts(events, at(16), 1, new Set()), [], "5 minutes in, it's gone");
});

test("Meetings: attendee copy", () => {
  const p = (name, me = false) => ({ name, email: `${name.toLowerCase() || "ana"}@acme.com`, status: "accepted", me });
  assert.equal(meetings.attendeesLabel({ attendees: [p("Alice"), p("Bob"), p("Me", true)] }), "Alice and Bob");
  assert.equal(meetings.attendeesLabel({ attendees: [p("Alice"), p("Bob"), p("Cy"), p(""), p("Di")] }), "Alice, Bob and 3 more");
  assert.equal(meetings.attendeesLabel({ attendees: [p("")] }), "ana");
  assert.equal(meetings.guestsLabel({ attendees: [p("A")] }), "1 guest");
  assert.equal(meetings.guestsLabel({ attendees: [p("A"), p("B")] }), "2 guests");
});

test("Meeting groups: joining a call groups it with its links; it ends, then cleans up", () => {
  const S = () => useBrowser.getState();
  S().hydrate({});
  const w = S().createWindow({ url: "https://example.com" });
  // Its 20 s ticker would keep node alive; the test calls tick() itself.
  const setIntervalBefore = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  meetingGroups.startMeetingGroups();
  globalThis.setInterval = setIntervalBefore;
  const ev = event({ occurrence: "design@1", title: "Design review", start: Date.now() - 60_000, end: Date.now() + 29 * 60_000, location: "https://meet.google.com/abc-defg-hij" });
  useCalendar.setState({ events: [ev] });
  const call = S().newTab(w, { url: "https://meet.google.com/abc-defg-hij" });
  const group = Object.values(S().groups).find((g) => g.tabIds.includes(call));
  assert.ok(group, "the call is grouped");
  assert.equal(group.name, "Design review");
  const m = liveStore.live().meetingGroups[group.id];
  assert.equal(m.occurrence, "design@1");
  // A link opened from the call joins the group.
  const doc = S().newTab(w, { url: "https://docs.google.com/document/d/1", openerId: call });
  assert.ok(S().groups[group.id].tabIds.includes(doc));
  // The meeting ends: a normal group.
  meetingGroups.tick(S(), ev.end + 1000);
  assert.ok(liveStore.live().meetingGroups[group.id].endedAt);
  // Unused for half an hour after: it closes to Recently Closed Groups.
  S().activate(S().newTab(w, { url: "https://example.org" }));
  meetingGroups.tick(S(), ev.end + 31 * 60_000);
  assert.equal(S().groups[group.id], undefined);
  assert.equal(liveStore.live().meetingGroups[group.id], undefined);
  assert.equal(S().closedGroups.at(-1).group.name, "Design review");
  // An unscheduled call is named "Meeting" and ends when you leave it.
  const adhoc = S().newTab(w, { url: "https://acme.zoom.us/j/999" });
  const g2 = Object.values(S().groups).find((g) => g.tabIds.includes(adhoc));
  assert.equal(g2.name, "Meeting");
  S().navigate(adhoc, "https://example.net");
  S().updateTab(adhoc, { url: "https://example.net" });
  meetingGroups.tick(S(), Date.now());
  assert.ok(liveStore.live().meetingGroups[g2.id].endedAt);
});
