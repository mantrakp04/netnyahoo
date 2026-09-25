import { Surface, Symbol, VisualEffect } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { defaultSearchEngine } from "../../store/settings";
import { useHover } from "../primitives";
import { searchSelection, setPageSelection, usePageSelection, type PageSelection } from "./selection";

const HEIGHT = 32;
const GAP = 6;
/** Dia waits a beat before offering it, so a click-drag-click doesn't flash it. */
const SHOW_DELAY = 150;

/**
 * Dia's selected-text popover: a small bar over a mouse selection of page text
 * with Search (the default engine, in a new tab). Ask stays hidden until Chat
 * exists. The page hides it on click, typing and scrolling (page_script.js).
 */
export function SelectionPopover({ tabId, zoom }: { tabId: string; zoom: number }) {
  const selection = usePageSelection((s) => s[tabId] ?? null);
  const [shown, setShown] = useState<PageSelection | null>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!selection) return setShown(null);
    const timer = setTimeout(() => setShown(selection), SHOW_DELAY);
    return () => clearTimeout(timer);
  }, [selection]);
  useEffect(() => () => setPageSelection(tabId, null), [tabId]);
  // Only while there's something to show: the full-size layer sits over the page.
  if (!selection && !shown) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={(e) => setArea(e.nativeEvent.layout)}>
      {shown && area.width > 0 && <Bar key={`${shown.rect.x},${shown.rect.y}`} tabId={tabId} selection={shown} zoom={zoom} area={area} />}
    </View>
  );
}

function Bar({ tabId, selection, zoom, area }: { tabId: string; selection: PageSelection; zoom: number; area: { width: number; height: number } }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, []);
  const r = selection.rect;
  const top = r.y * zoom;
  const bottom = (r.y + r.height) * zoom;
  // Off screen (the page scrolled without telling us, e.g. an inner scroller): nothing to point at.
  if (bottom < 0 || top > area.height) return null;
  // Above the selection, or under it when there's no room above.
  const above = top - GAP - HEIGHT >= 4;
  const y = above ? top - GAP - HEIGHT : Math.min(bottom + GAP, area.height - HEIGHT - 4);
  const center = (r.x + r.width / 2) * zoom;
  const x = Math.max(8, Math.min(center - width / 2, area.width - width - 8));

  return (
    <Animated.View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity: width ? appear : 0,
        transformOrigin: above ? "center bottom" : "center top",
        transform: [
          { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [above ? 3 : -3, 0] }) },
        ],
      }}
    >
      <Surface
        fill={hex(theme.dark ? "rgba(38,36,37,0.94)" : "rgba(252,251,252,0.96)")}
        cornerRadius={10}
        borderColor={hex(theme.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)")}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.dark ? 0.45 : 0.16}
        shadowRadius={14}
        shadowOffset={[0, 6]}
        style={{ height: HEIGHT, padding: 3, flexDirection: "row", alignItems: "center" }}
      >
        <VisualEffect material="menu" cornerRadius={10} style={StyleSheet.absoluteFill} />
        <View style={{ ...StyleSheet.absoluteFillObject, borderRadius: 10, backgroundColor: theme.dark ? "rgba(38,36,37,0.72)" : "rgba(252,251,252,0.7)" }} />
        <SearchButton tabId={tabId} text={selection.text} />
      </Surface>
    </Animated.View>
  );
}

function SearchButton({ tabId, text }: { tabId: string; text: string }) {
  const theme = useTheme();
  const engine = useBrowser((s) => defaultSearchEngine(s.settings).name);
  const { hovered, hoverProps } = useHover();
  const quoted = text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text;
  return (
    <View {...hoverProps} tooltip={`Search ${engine} for “${quoted.replace(/\s+/g, " ")}”`}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Search ${engine}`} onPress={() => searchSelection(tabId, text)}>
        {({ pressed }) => (
          <View
            style={{
              height: HEIGHT - 6,
              paddingLeft: 7,
              paddingRight: 9,
              borderRadius: 7,
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              backgroundColor: pressed || hovered ? (theme.dark ? `rgba(255,255,255,${pressed ? 0.12 : 0.07})` : `rgba(0,0,0,${pressed ? 0.1 : 0.06})`) : undefined,
            }}
          >
            <Symbol name="magnifyingglass" size={12} weight="medium" color={theme.icon} style={{ width: 16, height: 16 }} />
            <Text style={{ fontSize: 13, fontWeight: "500", color: theme.textPrimary }}>Search</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
