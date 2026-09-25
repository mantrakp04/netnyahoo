import { WebView } from "@netnyahoo/cef";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, PanResponder, StyleSheet, Text, View } from "react-native";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { IconButton } from "../primitives";
import { closeSidePanel, findExtension, showExtensionMenu, useExtensions } from "./state";

// Chrome's side panel limits.
const MIN_WIDTH = 320;
const MAX_WIDTH = 600;
const HEADER = 40;

/** Past a limit the edge follows the pointer less and less, like the sidebar's. */
function rubberBand(width: number): number {
  const band = (over: number) => 36 * (1 - Math.exp(-over / 90));
  if (width > MAX_WIDTH) return MAX_WIDTH + band(width - MAX_WIDTH);
  if (width < MIN_WIDTH) return MIN_WIDTH - band(MIN_WIDTH - width);
  return width;
}
const clamp = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));

/**
 * An extension's side panel (Dia's ExtensionSidePanel): a card to the right of the page with
 * the extension's name and a close button over its page. The page is an extension page
 * outside the tab strip (like action popups), so chrome.tabs sees the window's real tabs.
 * Drag the leading edge to resize (saved); double-click it for the default width.
 */
export function ExtensionSidePanel() {
  const windowId = useWindowId();
  const panel = useExtensions((e) => e.sidePanels[windowId]);
  const savedWidth = useBrowser((s) => s.settings.extensionSidePanelWidth ?? 360);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const appear = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(panel);

  // Slides in when it opens and out when it closes (the page takes the room back).
  useEffect(() => {
    if (panel) setShown(panel);
    Animated.timing(appear, { toValue: panel ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
      if (finished && !panel) setShown(undefined);
    });
  }, [!!panel]);
  useEffect(() => {
    if (panel) setShown(panel);
  }, [panel?.url, panel?.extensionId]);

  const width = dragWidth ?? savedWidth;
  const start = useRef(width);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = useBrowser.getState().settings.extensionSidePanelWidth ?? 360;
          setDragWidth(start.current);
        },
        // The edge is on the left: dragging left widens.
        onPanResponderMove: (_, g) => setDragWidth(rubberBand(start.current - g.dx)),
        onPanResponderRelease: (_, g) => {
          const raw = rubberBand(start.current - g.dx);
          const target = clamp(raw);
          const finish = () => {
            useBrowser.getState().updateSettings({ extensionSidePanelWidth: target });
            setDragWidth(null);
          };
          if (raw === target) return finish();
          const value = new Animated.Value(raw);
          value.addListener(({ value: v }) => setDragWidth(v));
          Animated.timing(value, { toValue: target, duration: 260, easing: Easing.out(Easing.back(1.2)), useNativeDriver: false }).start(() => {
            value.removeAllListeners();
            finish();
          });
        },
        onPanResponderTerminate: () => setDragWidth(null),
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  if (!shown) return null;
  const room = width + layout.cardInset - 1;
  return (
    <Animated.View style={{ width: appear.interpolate({ inputRange: [0, 1], outputRange: [0, room] }), overflow: "hidden" }}>
      <Animated.View style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: width, opacity: appear }}>
        {/* A new page for the tab (its own panel path) is a new panel. */}
        <PanelCard key={`${shown.extensionId}|${shown.url}`} windowId={windowId} extensionId={shown.extensionId} profile={shown.profile} url={shown.url} />
        <View
          {...responder.panHandlers}
          onDoubleClick={() => useBrowser.getState().updateSettings({ extensionSidePanelWidth: 360 })}
          style={{ position: "absolute", top: 0, bottom: 0, left: -3, width: 7, cursor: "col-resize" }}
        />
      </Animated.View>
    </Animated.View>
  );
}

function PanelCard({ windowId, extensionId, profile, url }: { windowId: string; extensionId: string; profile: string; url: string }) {
  const theme = useTheme();
  const ext = useExtensions((e) => e.lists[profile]?.find((x) => x.id === extensionId));
  const title = ext?.actionTitle || ext?.name || "Extension";
  const icon = ext?.actionIcon || ext?.icon;
  return (
    <View style={{ flex: 1, borderRadius: layout.cardRadius, overflow: "hidden", backgroundColor: theme.card }}>
      <View style={{ height: HEADER, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 5, gap: 8 }}>
        {icon ? <Image source={{ uri: icon }} style={{ width: 16, height: 16 }} /> : null}
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: "500", color: theme.textPrimary }}>
          {title}
        </Text>
        <IconButton
          icon="ellipsis"
          size={13}
          tooltip="More"
          onPress={() => {
            const found = findExtension(profile, extensionId);
            if (found) void showExtensionMenu(windowId, found);
          }}
        />
        <IconButton icon="xmark" size={12} weight="medium" tooltip="Close Side Panel" onPress={() => closeSidePanel(windowId)} />
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }} />
      <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
        <WebView
          style={StyleSheet.absoluteFill}
          url={url}
          profile={profile}
          // A panel, not a tab: outside the window's Chrome tab strip.
          standalone
          pageBackgroundColor="#FFFFFF"
          onWindowClose={() => closeSidePanel(windowId, extensionId)}
          onOpenWindow={({ url: target, disposition }) => useBrowser.getState().newTab(windowId, { url: target, background: disposition === "background" })}
        />
      </View>
    </View>
  );
}
