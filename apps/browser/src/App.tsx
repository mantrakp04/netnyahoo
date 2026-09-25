import { WindowBackdrop } from "@netnyahoo/shaders";
import { Surface } from "@netnyahoo/shell";
import { useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { CommandPanel } from "./components/CommandPanel";
import { ContentCard } from "./components/ContentCard";
import { BookmarkDialog } from "./components/bookmarks/BookmarkDialog";
import { EditBookmarkDialog } from "./components/bookmarks/EditBookmarkDialog";
import { ExtensionOverlays } from "./components/extensions/ExtensionOverlays";
import { ExtensionSidePanel } from "./components/extensions/SidePanel";
import { DownloadMagnet, DownloadsPopover } from "./components/Downloads";
import { UtilityWindow } from "./components/settings/UtilityWindow";
import { isUtilityWindowId } from "./components/settings/windows";
import { OnboardingOverlay } from "./components/onboarding";
import { CreateProfileHost } from "./components/profiles/CreateProfile";
import { useFullscreenTab } from "./components/layout/pageState";
import { ProfileSwipe, ProfileTint } from "./components/layout/ProfileSwipe";
import { TOP_STRIP_HEIGHT, TopStripPeek, TopTabStrip } from "./components/layout/TopTabStrip";
import { useTabLayout } from "./components/layout/windowLayout";
import { Sidebar } from "./components/Sidebar";
import { SidebarOverlays } from "./components/sidebar/Overlays";
import { useSidebarWidth } from "./components/sidebar/tokens";
import { hex, layout, useTheme } from "./lib/theme";
import { useBrowser } from "./store/browser";
import { useSidebarOpen, useWindowId, WindowContext } from "./store/hooks";

/**
 * One browser window's React root. `windowId` comes from the native window's
 * initial properties; app builds from before multi-window support host a single
 * root without one, which shows the focused window.
 */
export function WindowRoot({ windowId }: { windowId?: string }) {
  // The Settings and Import windows share the "main" root component (components/settings).
  if (isUtilityWindowId(windowId)) return <UtilityWindow id={windowId!} />;
  return <BrowserWindowRoot windowId={windowId} />;
}

function BrowserWindowRoot({ windowId }: { windowId?: string }) {
  const id = useBrowser((s) => windowId ?? s.ui.focusedWindowId ?? s.windowOrder[0] ?? null);
  const exists = useBrowser((s) => !!id && !!s.windows[id]);
  // A closed window's root unmounts right after; render nothing meanwhile.
  if (!id || !exists) return null;
  return (
    <WindowContext.Provider value={id}>
      <BrowserWindow />
    </WindowContext.Provider>
  );
}

function BrowserWindow() {
  const theme = useTheme();
  const sidebarOpen = useSidebarOpen();
  // ⇧⌘S: tabs along the top instead of the sidebar. A page in fullscreen hides all chrome.
  const topTabs = useTabLayout() === "top";
  const fullscreen = !!useFullscreenTab(useWindowId());
  const showSidebar = sidebarOpen && !topTabs && !fullscreen;
  const showStrip = sidebarOpen && topTabs && !fullscreen;
  // The command panel is sized against the window (useWindowDimensions is the key window's).
  const [width, setWidth] = useState(0);

  return (
    <View style={{ flex: 1, flexDirection: "row" }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <WindowBackdrop colors={theme.windowTint} inactiveColors={theme.windowTintInactive} grainOpacity={theme.grain} style={StyleSheet.absoluteFill} />
      {/* While the sidebar pages between profiles, the tint cross-fades between their colours. */}
      <ProfileTint />
      {showSidebar && (
        <ProfileSwipe>
          <Sidebar />
        </ProfileSwipe>
      )}
      <View
        style={
          fullscreen
            ? { flex: 1 }
            : {
                flex: 1,
                // An extension's side panel sits beside the page (components/extensions/SidePanel).
                flexDirection: "row",
                paddingTop: showStrip ? TOP_STRIP_HEIGHT : layout.cardTop,
                paddingRight: layout.cardInset,
                paddingBottom: layout.cardInset,
                paddingLeft: showSidebar ? 0 : layout.cardInset,
              }
        }
      >
        <ContentCard />
        {!fullscreen && <ExtensionSidePanel />}
      </View>
      {showStrip && (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
          <TopTabStrip />
        </View>
      )}
      {!sidebarOpen && !fullscreen && (topTabs ? <TopStripPeek /> : <SidebarPeek />)}
      <CommandPanel windowWidth={width} />
      <DownloadsPopover />
      <ExtensionOverlays />
      <DownloadMagnet />
      <BookmarkDialog />
      <EditBookmarkDialog />
      <CreateProfileHost />
      <SidebarOverlays windowWidth={width} />
      <OnboardingOverlay />
    </View>
  );
}

/**
 * With the sidebar hidden, hovering the window's left edge slides it in as a
 * floating panel over the page; it slides away when the pointer leaves.
 */
function SidebarPeek() {
  const theme = useTheme();
  const sidebarWidth = useSidebarWidth(useWindowId());
  const [visible, setVisible] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const animate = (to: number, then?: () => void) =>
    Animated.timing(slide, { toValue: to, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(then);
  const show = () => {
    clearTimeout(hideTimer.current);
    setVisible(true);
    animate(1);
  };
  const hide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => animate(0, () => setVisible(false)), 120);
  };

  return (
    <>
      <View onMouseEnter={show} style={{ position: "absolute", left: 0, top: layout.sidebarHeader, bottom: 0, width: 8 }} />
      {visible && (
        <Animated.View
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{
            position: "absolute",
            left: 6,
            top: layout.cardTop,
            bottom: layout.cardInset,
            width: sidebarWidth,
            opacity: slide,
            transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-sidebarWidth - 12, 0] }) }],
          }}
        >
          <Surface
            fill={hex(theme.windowTint[0])}
            cornerRadius={12}
            borderColor={hex(theme.panelBorder)}
            borderWidth={0.5}
            shadowColor="#000000"
            shadowOpacity={theme.panelShadowOpacity}
            shadowRadius={20}
            shadowOffset={[0, 6]}
            style={{ flex: 1, overflow: "hidden" }}
          >
            <Sidebar />
          </Surface>
        </Animated.View>
      )}
    </>
  );
}
