import type { SystemCalendar } from "@netnyahoo/shell";
import { Linking, Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { connectCalendar, setCalendarHidden, useCalendar } from "../../../live/calendar";
import { ALERT_LEADS } from "../../../live/meetings";
import { updateCalendarSettings, useLive } from "../../../live/store";
import { useBrowser } from "../../../store/browser";
import { Button, Checkbox, Group, PopUp, Row, SectionHeader, Toggle } from "../controls";

/**
 * Settings › Calendar: Live Calendar reads macOS Calendar (whatever accounts
 * the Mac syncs), so there's nothing to sign in to — just permission. Alerts,
 * the pinned-calendar preview and badge, meeting groups and which calendars
 * count mirror Dia's calendar menu.
 */
export function CalendarPane() {
  const theme = useTheme();
  const settings = useLive((s) => s.calendar);
  const { access, calendars } = useCalendar();
  const autoGroup = useBrowser((s) => s.settings.autoGroupMeetingTabs);
  const connected = access === "fullAccess" || access === "fixture";
  const denied = access === "denied" || access === "restricted";
  const owned = calendars.filter((c) => c.owned);
  const others = calendars.filter((c) => !c.owned);

  return (
    <View>
      <SectionHeader
        title="Live Calendar"
        description="Pin Google Calendar, Outlook, iCloud or Notion Calendar to see your day when you hover it, a countdown to your next meeting, and alerts with a Join button before meetings start. Events come from the Calendar app's accounts."
      />
      <Group>
        <Row
          title="Calendar access"
          description={
            access === "fixture"
              ? "Development build: using calendar-fixture.json"
              : connected
                ? `Connected · ${calendars.length === 1 ? "1 calendar" : `${calendars.length} calendars`}`
                : denied
                  ? "Netnyahoo isn't allowed to read your calendars. Allow it in System Settings › Privacy & Security › Calendars."
                  : access === "unavailable"
                    ? "This build of Netnyahoo can't read calendars."
                    : "Not connected"
          }
        >
          {denied ? (
            <Button title="Open System Settings" onPress={() => void Linking.openURL("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")} />
          ) : !connected && access !== "unavailable" ? (
            <Button title="Connect Calendar…" kind="primary" onPress={() => void connectCalendar()} />
          ) : null}
        </Row>
      </Group>

      <SectionHeader title="Meeting alerts" />
      <Group>
        <Row title="Show next meeting alert">
          <PopUp value={settings.alertLead} options={ALERT_LEADS.map((l) => ({ value: l.value, title: l.title, separatorBefore: l.value === "start" }))} onChange={(v) => updateCalendarSettings({ alertLead: v })} minWidth={170} />
        </Row>
        <Row title="Show alerts" description="With Always, alerts also appear in Notification Center while you're in another app.">
          <PopUp
            value={settings.alertCondition}
            options={[
              { value: "always", title: "Always" },
              { value: "activeOnly", title: "Only When Active" },
            ]}
            disabled={settings.alertLead === "never"}
            onChange={(v) => updateCalendarSettings({ alertCondition: v })}
            minWidth={170}
          />
        </Row>
      </Group>

      <SectionHeader title="Pinned calendar" />
      <Group>
        <Row title="Show calendar preview" description="Hover a pinned calendar tab to see the rest of your day.">
          <Toggle value={settings.showPreview} onChange={(v) => updateCalendarSettings({ showPreview: v })} />
        </Row>
        <Row title="Show time to next meeting" description="A badge on the pinned calendar tab within the hour before a meeting.">
          <Toggle value={settings.showTimeToNext} onChange={(v) => updateCalendarSettings({ showTimeToNext: v })} />
        </Row>
      </Group>

      <SectionHeader title="Meetings" />
      <Group>
        <Row title="Automatically group tabs for meetings" description="Joining a call makes a tab group for it; links you open from the meeting join the group.">
          <Toggle value={autoGroup} onChange={(v) => useBrowser.getState().updateSettings({ autoGroupMeetingTabs: v })} />
        </Row>
      </Group>

      {calendars.length ? (
        <>
          <SectionHeader title="Active calendars" description="Meetings from unchecked calendars don't show or alert." />
          <Group>
            {owned.length ? <CalendarList title="My Calendars" calendars={owned} hidden={settings.hiddenCalendarIds} /> : null}
            {others.length ? <CalendarList title="Other Calendars" calendars={others} hidden={settings.hiddenCalendarIds} /> : null}
          </Group>
        </>
      ) : connected ? (
        <Text style={{ marginTop: 12, fontSize: 12, color: theme.textSecondary }}>No calendars found. Add accounts in the Calendar app.</Text>
      ) : null}
    </View>
  );
}

function CalendarList({ title, calendars, hidden }: { title: string; calendars: SystemCalendar[]; hidden: string[] }) {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: 6 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textSecondary, marginLeft: 12, marginBottom: 2 }}>{title}</Text>
      {calendars.map((c) => (
        <Row
          key={c.id}
          icon={<View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.color }} />}
          title={<Checkbox value={!hidden.includes(c.id)} onChange={(v) => setCalendarHidden(c.id, !v)} label={c.title} />}
          description={c.account}
        />
      ))}
    </View>
  );
}
