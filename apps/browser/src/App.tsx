import { WindowBackdrop } from "@netnyahoo/shaders";
import { Surface } from "@netnyahoo/shell";
import { useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
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
import { TOP_CARD_INSET, TOP_STRIP_HEIGHT, TopStripPeek, TopTabStrip } from "./components/layout/TopTabStrip";
import { usePeek } from "./components/layout/usePeek";
import { useTabLayout } from "./components/layout/windowLayout";
import { WindowProfile } from "./components/layout/WindowProfile";
import { Sidebar } from "./components/Sidebar";
import { SmallYahuWindow } from "./components/smallYahu/SmallYahuWindow";
import { SidebarOverlays } from "./components/sidebar/Overlays";
import { useSidebarWidth } from "./components/sidebar/tokens";
import { hex, layout, ThemeScope, useTheme } from "./lib/theme";
import { useBrowser } from "./store/browser";
import { useSidebarOpen, useWindowId, WindowContext } from "./store/hooks";

export function WindowRoot({ windowId }: { windowId?: string }) {
  if (isUtilityWindowId(windowId))
    return (
      <ThemeScope>
        <UtilityWindow id={windowId!} />
      </ThemeScope>
    );
  return <BrowserWindowRoot windowId={windowId} />;
}

function BrowserWindowRoot({ windowId }: { windowId?: string }) {
  const id = useBrowser((s) => windowId ?? s.ui.focusedWindowId ?? s.windowOrder[0] ?? null);
  const exists = useBrowser((s) => !!id && !!s.windows[id]);
  const small = useBrowser((s) => !!id && s.windows[id]?.kind === "small");
  if (!id || !exists) return null;
  return (
    <WindowContext.Provider value={id}>
      <ThemeScope>{small ? <SmallYahuWindow /> : <BrowserWindow />}</ThemeScope>
    </WindowContext.Provider>
  );
}

function BrowserWindow() {
  const theme = useTheme();
  const sidebarOpen = useSidebarOpen();
  const topTabs = useTabLayout() === "top";
  const fullscreen = !!useFullscreenTab(useWindowId());
  // Page full screen hides the sidebar and the strip without unmounting them: they keep their scroll, rows, measured
  // sizes and swipe surface. Moved out of the window rather than made transparent, so nothing in them takes the pointer.
  const showSidebar = sidebarOpen && !topTabs;
  const showStrip = sidebarOpen && topTabs;
  const [width, setWidth] = useState(0);

  return (
    <View style={{ flex: 1, flexDirection: "row" }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <WindowBackdrop vibrancy {...theme.backdrop} colors={theme.windowTint} grainOpacity={theme.grain} style={StyleSheet.absoluteFill} />
      <WindowProfile />
      <ProfileTint />
      {showSidebar && (
        <View pointerEvents={fullscreen ? "none" : "auto"} style={fullscreen ? { position: "absolute", top: 0, bottom: 0, right: "100%" } : { height: "100%" }}>
          <ProfileSwipe>
            <Sidebar />
          </ProfileSwipe>
        </View>
      )}
      <View
        style={
          fullscreen
            ? { flex: 1 }
            : {
                flex: 1,
                flexDirection: "row",
                paddingTop: showStrip ? TOP_STRIP_HEIGHT : layout.cardTop,
                paddingRight: showStrip ? TOP_CARD_INSET : layout.cardInset,
                paddingBottom: showStrip ? TOP_CARD_INSET : layout.cardInset,
                paddingLeft: showSidebar ? 0 : showStrip ? TOP_CARD_INSET : layout.cardInset,
              }
        }
      >
        <ContentCard />
        {!fullscreen && <ExtensionSidePanel />}
      </View>
      {showStrip && (
        <View pointerEvents={fullscreen ? "none" : "auto"} style={[{ position: "absolute", left: 0, right: 0 }, fullscreen ? { bottom: "100%" } : { top: 0 }]}>
          <TopTabStrip width={width} hidden={fullscreen} />
        </View>
      )}
      {!sidebarOpen && (topTabs ? <TopStripPeek windowWidth={width} enabled={!fullscreen} /> : <SidebarPeek enabled={!fullscreen} />)}
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

function SidebarPeek({ enabled }: { enabled: boolean }) {
  const theme = useTheme();
  const sidebarWidth = useSidebarWidth(useWindowId());
  const { slide, live, show, hide } = usePeek(enabled);

  return (
    <>
      {enabled ? <View onMouseEnter={show} style={{ position: "absolute", left: 0, top: layout.sidebarHeader, bottom: 0, width: 8 }} /> : null}
      <Animated.View
        pointerEvents={live ? "auto" : "none"}
        onMouseEnter={live ? show : undefined}
        onMouseLeave={live ? hide : undefined}
        style={{
          position: "absolute",
          // Out of the window while hidden (a transform doesn't move hover tracking): its rows mustn't hover under the page.
          left: live ? 6 : -10_000,
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
    </>
  );
}
