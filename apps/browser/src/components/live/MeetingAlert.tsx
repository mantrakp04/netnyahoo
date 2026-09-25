import { Surface } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { dismiss, joinEvent, useMeetingAlert } from "../../live/alerts";
import { useCalendar, useNow } from "../../live/calendar";
import { attendeesLabel, guestsLabel, isCalendarUrl, joinLink, joinTitle, relatedLinks, relativeTime, timeRange, type CalendarEvent } from "../../live/meetings";
import { useBrowser } from "../../store/browser";
import { viewTabIds } from "../../store/model";
import { IconButton } from "../primitives";
import { measureRow, type Anchor } from "../sidebar/state";
import { OverlappingAvatars } from "./CalendarPreview";
import { useLiveColors } from "./colors";
import { SmallButton } from "./LiveItemCard";

const WIDTH = 300;

/**
 * Just-in-time meeting alert (Dia's CalendarEventReminder): the meeting, who's
 * in it and a one-click Join — plus "Open All and Join" when the invitation has
 * links. It attaches to the pinned calendar tab when the sidebar shows one,
 * else sits at the window's top right. Shown in the front window only.
 */
export function MeetingAlert({ windowId, windowWidth }: { windowId: string; windowWidth: number }) {
  const event = useMeetingAlert((s) => s.event);
  const front = useBrowser((s) => s.ui.focusedWindowId === windowId);
  if (!event || !front) return null;
  return <AlertCard key={event.occurrence} event={event} windowId={windowId} windowWidth={windowWidth} />;
}

function AlertCard({ event, windowId, windowWidth }: { event: CalendarEvent; windowId: string; windowWidth: number }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const now = useNow(15_000);
  const calendarTab = useBrowser((s) => viewTabIds(s, windowId).find((id) => s.tabs[id]?.pinned && isCalendarUrl(s.tabs[id]!.pinnedUrl ?? s.tabs[id]!.url)));
  const sidebarShown = useBrowser((s) => !!s.windows[windowId]?.sidebarOpen);
  const calendarName = useCalendar((s) => s.calendars.find((c) => c.id === event.calendarId)?.title);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    if (calendarTab && sidebarShown) void measureRow(windowId, calendarTab).then((a) => !cancelled && setAnchor(a));
    else setAnchor(null);
    return () => {
      cancelled = true;
    };
  }, [calendarTab, sidebarShown, windowWidth]);
  useEffect(() => {
    Animated.spring(appear, { toValue: 1, speed: 14, bounciness: 6, useNativeDriver: false }).start();
  }, []);

  const link = joinLink(event);
  const related = relatedLinks(event);
  const running = event.start <= now;
  const people = event.attendees.filter((a) => !a.me);
  const who = attendeesLabel(event);
  const position = anchor ? { left: anchor.x + anchor.width + 8, top: Math.max(8, anchor.y - 4) } : { left: Math.max(8, windowWidth - WIDTH - 14), top: 52 };

  return (
    <Animated.View
      style={{
        position: "absolute",
        ...position,
        width: WIDTH,
        opacity: appear,
        transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
      }}
    >
      <Surface
        fill={hex(theme.panel)}
        cornerRadius={14}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={20}
        shadowOffset={[0, 8]}
        style={{ padding: 12, gap: 8 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2.5, backgroundColor: event.color }} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, fontWeight: "500", color: running ? colors.now : theme.textSecondary }}>
            {running ? "Now" : relativeTime(event.start, now)}
            {calendarName ? <Text style={{ fontWeight: "400", color: theme.textSecondary }}> · {calendarName}</Text> : null}
          </Text>
          <IconButton icon="xmark" size={9} weight="semibold" box={20} radius={6} onPress={() => dismiss(event)} tooltip="Ignore" style={{ marginRight: -4, marginTop: -2 }} />
        </View>
        <View style={{ gap: 2 }}>
          <Text numberOfLines={2} style={{ fontSize: 14, lineHeight: 18, fontWeight: "600", color: theme.textPrimary }}>
            {event.title || "Untitled event"}
          </Text>
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>{timeRange(event)}</Text>
        </View>
        {people.length ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <OverlappingAvatars people={people} size={20} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.textSecondary }}>
              {who || guestsLabel(event)}
            </Text>
          </View>
        ) : null}
        <View style={{ gap: 6, marginTop: 2 }}>
          {link ? (
            <SmallButton title={joinTitle(link.provider)} icon="video.fill" primary height={30} onPress={() => joinEvent(event, false, windowId)} />
          ) : calendarTab ? (
            <SmallButton
              title="View Event"
              icon="calendar"
              height={30}
              onPress={() => {
                useBrowser.getState().activate(calendarTab);
                dismiss(event);
              }}
            />
          ) : null}
          {link && related.length ? (
            <View tooltip={`Opens ${related.length === 1 ? "1 link" : `${related.length} links`} from the invitation, then joins`}>
              <SmallButton title="Open All and Join" icon="square.stack" height={30} onPress={() => joinEvent(event, true, windowId)} />
            </View>
          ) : null}
        </View>
      </Surface>
    </Animated.View>
  );
}

