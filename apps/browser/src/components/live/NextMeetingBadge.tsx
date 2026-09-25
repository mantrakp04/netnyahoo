import { useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useCalendar, useNow } from "../../live/calendar";
import { badgeText, isCalendarUrl } from "../../live/meetings";
import { useLive } from "../../live/store";
import { useBrowser } from "../../store/browser";
import { useSidebarTokens } from "../sidebar/tokens";
import { useLiveColors } from "./colors";

/**
 * Live Calendar's badge on a pinned calendar tile: minutes to the next meeting
 * within the hour, "Now" during one ("Show Time to Next Meeting"). It springs
 * in and out (Dia's calendar badge animations). Hovering the tile shows the day.
 */
export function NextMeetingBadge({ tabId }: { tabId: string }) {
  const calendar = useBrowser((s) => {
    const t = s.tabs[tabId];
    return !!t?.pinned && isCalendarUrl(t.pinnedUrl ?? t.url);
  });
  const on = useLive((s) => s.calendar.showTimeToNext);
  const events = useCalendar((s) => s.events);
  const now = useNow(15_000, calendar && on);
  const text = calendar && on ? badgeText(events, now) : null;
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const colors = useLiveColors();
  const shown = useRef(new Animated.Value(text ? 1 : 0)).current;
  const [label, setLabel] = useState(text);
  useEffect(() => {
    if (text) setLabel(text);
    Animated.spring(shown, { toValue: text ? 1 : 0, speed: 16, bounciness: text ? 10 : 0, useNativeDriver: false }).start(() => {
      if (!text) setLabel(null);
    });
  }, [text]);
  if (!label) return null;
  const live = label === "Now";
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: -5,
        left: 0,
        right: 0,
        alignItems: "center",
        opacity: shown,
        transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
      }}
    >
      <View
        style={{
          height: 14,
          minWidth: 22,
          paddingHorizontal: 4,
          borderRadius: 7,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: live ? colors.now : tokens.badge,
          borderWidth: 1,
          borderColor: theme.dark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.8)",
        }}
      >
        <Text style={{ fontSize: 9, fontWeight: "700", fontVariant: ["tabular-nums"], color: live ? "#FFFFFF" : tokens.badgeGlyph }}>{label}</Text>
      </View>
    </Animated.View>
  );
}
