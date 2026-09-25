import { FadeLabel } from "@netnyahoo/shell";
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { joinEvent } from "../../live/alerts";
import { connectCalendar, refreshCalendar, useCalendar, useNow } from "../../live/calendar";
import { isCalendarUrl, isMeeting, joinLink, joinTitle, relativeTime, timeRange, type CalendarEvent } from "../../live/meetings";
import { useLive } from "../../live/store";
import { useBrowser } from "../../store/browser";
import { IconButton, useHover } from "../primitives";
import { dismissHover } from "../sidebar/hover";
import type { Anchor } from "../sidebar/state";
import { Avatar, HoverSurface, SmallButton } from "./LiveItemCard";
import { useLiveColors } from "./colors";

/** Whether hovering this tab shows Live Calendar's preview (a pinned calendar, preview on). */
export function useIsCalendarTab(tabId: string | null): boolean {
  const pinnedCalendar = useBrowser((s) => {
    const t = tabId ? s.tabs[tabId] : undefined;
    return !!t?.pinned && isCalendarUrl(t.pinnedUrl ?? t.url);
  });
  const on = useLive((s) => s.calendar.showPreview);
  return pinnedCalendar && on;
}

/** Joinable from a few minutes before the start until the end (Dia's currentJoinableEvents). */
const JOINABLE_BEFORE_MS = 10 * 60_000;

/**
 * Live Calendar's preview on a pinned calendar tab: the rest of today, with a
 * Join button on meetings that are about to start or running.
 */
export function CalendarPreview({ tabId, windowId, anchor }: { tabId: string; windowId: string; anchor: Anchor }) {
  const theme = useTheme();
  const now = useNow(15_000);
  const { access, events, loading, error, lastFetch } = useCalendar();
  const connected = access === "fullAccess" || access === "fixture";
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const today = events.filter((e) => !e.cancelled && !e.declined && e.start <= endOfDay.getTime() && e.end > new Date(now).setHours(0, 0, 0, 0));
  const upcoming = today.filter((e) => e.end > now);
  const allDay = upcoming.filter((e) => e.allDay);
  const timed = upcoming.filter((e) => !e.allDay);
  const date = new Date(now).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  let body: React.ReactNode;
  if (!connected) body = <SignIn denied={access === "denied" || access === "restricted"} />;
  else if (!lastFetch && loading) body = <Empty text="Loading events" />;
  else if (error && !lastFetch) body = <Empty text="Couldn't load events" />;
  else if (!today.length) body = <Empty text="No events today" />;
  else if (!upcoming.length) body = <Empty text="No more events today" />;
  else
    body = (
      <View style={{ gap: 2 }}>
        {allDay.map((e) => (
          <AllDayRow key={e.occurrence} event={e} />
        ))}
        {timed.map((e) => (
          <EventRow key={e.occurrence} event={e} now={now} windowId={windowId} tabId={tabId} />
        ))}
      </View>
    );

  return (
    <HoverSurface anchor={anchor} width={300}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8, marginTop: -2 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>Today</Text>
        <Text style={{ marginLeft: 6, fontSize: 12, color: theme.textSecondary }}>{date}</Text>
        <View style={{ flex: 1 }} />
        {connected ? <Refresh spinning={loading} /> : null}
      </View>
      {body}
    </HoverSurface>
  );
}

function Refresh({ spinning }: { spinning: boolean }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning) return;
    turn.setValue(0);
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [spinning]);
  return (
    <Animated.View style={{ marginRight: -6, marginVertical: -4, transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>
      <IconButton icon="arrow.clockwise" size={10} weight="semibold" box={22} radius={6} onPress={() => void refreshCalendar()} tooltip="Refresh" />
    </Animated.View>
  );
}

function Empty({ text }: { text: string }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 12.5, color: theme.textSecondary, paddingVertical: 6 }}>{text}</Text>;
}

/** Dia's logged-out preview: a sign-in link plus a suffix. Ours asks for macOS Calendar access. */
function SignIn({ denied }: { denied: boolean }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  if (denied) {
    return (
      <Text style={{ fontSize: 12.5, lineHeight: 17, color: theme.textSecondary, paddingVertical: 4 }}>
        Allow Netnyahoo in System Settings › Privacy & Security › Calendars to see your meetings here.
      </Text>
    );
  }
  return (
    <View {...hoverProps} style={{ paddingVertical: 4 }}>
      <Text style={{ fontSize: 12.5, lineHeight: 17, color: theme.textSecondary }}>
        <Text onPress={() => void connectCalendar()} style={{ color: theme.accent, textDecorationLine: hovered ? "underline" : "none" }}>
          Connect your calendar
        </Text>{" "}
        to see your meetings here and get alerts before they start.
      </Text>
    </View>
  );
}

function AllDayRow({ event }: { event: CalendarEvent }) {
  const theme = useTheme();
  return (
    <View style={{ height: 22, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 4 }}>
      <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: event.color }} />
      <FadeLabel text={event.title || "Untitled event"} fontSize={12} color={theme.textSecondary} style={{ flex: 1, height: 16 }} />
      <Text style={{ fontSize: 11, color: theme.textTertiary }}>All day</Text>
    </View>
  );
}

function EventRow({ event, now, windowId, tabId }: { event: CalendarEvent; now: number; windowId: string; tabId: string }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const { hovered, hoverProps } = useHover();
  const link = joinLink(event);
  const running = event.start <= now;
  const joinable = !!link && isMeeting(event) && now >= event.start - JOINABLE_BEFORE_MS && now < event.end;
  const others = event.attendees.filter((a) => !a.me);
  const past = event.end <= now;
  return (
    <View {...hoverProps}>
      <Pressable
        onPress={() => {
          // View the day in the pinned calendar.
          dismissHover();
          useBrowser.getState().activate(tabId);
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8, backgroundColor: hovered ? theme.rowHover : undefined, opacity: past ? 0.5 : 1 }}>
          <View style={{ width: 3, alignSelf: "stretch", borderRadius: 1.5, backgroundColor: event.color }} />
          <View style={{ flex: 1, gap: 2 }}>
            <FadeLabel text={event.title || "Untitled event"} fontSize={13} weight="medium" color={theme.textPrimary} style={{ height: 17 }} />
            <Text numberOfLines={1} style={{ fontSize: 11.5, color: theme.textSecondary }}>
              {timeRange(event)}
              <Text style={{ fontWeight: "500", color: running ? colors.now : theme.textSecondary }}> · {running ? "Now" : relativeTime(event.start, now)}</Text>
            </Text>
          </View>
          {/* With a Join button there's no room for faces; the alert shows them. */}
          {others.length && !joinable ? <OverlappingAvatars people={others} /> : null}
          {joinable ? (
            <View tooltip={joinTitle(link!.provider)}>
              <SmallButton title="Join" icon="video.fill" primary onPress={() => (dismissHover(), joinEvent(event, false, windowId))} />
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

/** Dia's OverlappingAvatarView: up to three attendees, overlapped, then "+N". */
export function OverlappingAvatars({ people, size = 18 }: { people: CalendarEvent["attendees"]; size?: number }) {
  const theme = useTheme();
  const shown = people.slice(0, 3);
  const more = people.length - shown.length;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {shown.map((p, i) => (
        <View key={p.email || i} style={{ marginLeft: i ? -size * 0.35 : 0, borderRadius: size / 2 + 1, borderWidth: 1.5, borderColor: theme.panel }}>
          <Avatar uri={null} name={p.name || p.email} size={size} />
        </View>
      ))}
      {more > 0 ? <Text style={{ marginLeft: 3, fontSize: 10.5, color: theme.textSecondary }}>+{more}</Text> : null}
    </View>
  );
}

