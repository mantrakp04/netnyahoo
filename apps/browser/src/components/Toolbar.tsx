import { breadcrumb, urlForDisplay } from "@netnyahoo/core";
import { ContextMenuArea, FadeLabel, MouseArea, Symbol, WindowDragRegion } from "@netnyahoo/shell";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { layout, useTheme } from "../lib/theme";
import { webviews } from "../lib/webviews";
import { useBrowser } from "../store/browser";
import { useIsBookmarked, useSettings, useTab, useTabLive } from "../store/hooks";
import { bookmarkProfileId } from "../store/model";
import type { Tab } from "../store/types";
import { ToolbarButton, type ClickModifiers } from "./layout/controls";
import { type ToolbarGeometry } from "./layout/geometry";
import { setPopover, usePage, usePages } from "./layout/pageState";
import { closeHistoryMenu, goBack, goForward, historyItems, openHistoryMenu, useHistoryAvailability, useHistoryMenu } from "./layout/history";
import { openModeFor, openUrl } from "./bookmarks/actions";
import { closePane, openSplitPane, showSplitMenu } from "./layout/splitActions";
import { toolbarPalette, useEasedColor, type ToolbarPalette } from "./layout/toolbarColors";
import { SIDEBAR_FIELD } from "./layout/windowLayout";
import { showUrlBarMenu } from "./omnibox/paste";
import { useHover } from "./primitives";
import { ToolbarExtensions, useToolbarExtensionsWidth } from "./extensions/ToolbarExtensions";

/**
 * A pane's navigation bar: sidebar toggle (leading pane only), back / forward /
 * reload, the host / title breadcrumb, and — in a split — the split menu and
 * close buttons. The page's colour tints it when "Extend website color" is on;
 * unfocused split panes dim theirs.
 */
export function Toolbar({ tabId, geometry, windowId, inSplit, focused }: { tabId: string; geometry: ToolbarGeometry; windowId: string; inSplit: boolean; focused: boolean }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const live = useTabLive(tabId);
  const extendColor = useSettings((s) => s.extendWebsiteColor);
  const website = extendColor && tab?.url ? live.themeColor : null;
  const palette = toolbarPalette(theme, website);
  const band = useEasedColor(palette.background);
  const history = useHistoryAvailability(tabId, live);
  const extensionsWidth = useToolbarExtensionsWidth(windowId);
  const dim = useRef(new Animated.Value(focused ? 1 : 0.5)).current;
  useEffect(() => {
    Animated.timing(dim, { toValue: focused ? 1 : 0.5, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [focused]);
  if (!tab) return <View style={{ height: layout.toolbarHeight }} />;

  // Acting on an unfocused pane focuses it first, like clicking into its page.
  const focus = () => {
    if (!focused) useBrowser.getState().activate(tab.id);
  };
  const top = 21.2 - layout.toolbarButton / 2;
  const at = (center: number) => ({ position: "absolute" as const, top, left: center - layout.toolbarButton / 2 });
  const right = (inSplit ? 12 + 2 * 28 : 12) + extensionsWidth;

  return (
    <View style={{ height: layout.toolbarHeight }}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: band }]} />
      <WindowDragRegion style={StyleSheet.absoluteFill} />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: dim }]} pointerEvents="box-none">
        {geometry.sidebarButton !== null && (
          <ToolbarButton
            style={at(geometry.sidebarButton)}
            palette={palette}
            icon="sidebar.left"
            onPress={() => useBrowser.getState().toggleSidebar(windowId)}
            tooltip="Auto-Hide Tabs (⌘S)"
          />
        )}
        <HistoryButton style={at(geometry.back)} tab={tab} direction={-1} disabled={!history.back} palette={palette} onFocus={focus} />
        <HistoryButton style={at(geometry.forward)} tab={tab} direction={1} disabled={!history.forward} palette={palette} onFocus={focus} />
        <ReloadButton style={at(geometry.reload)} tab={tab} loading={live.isLoading} palette={palette} onFocus={focus} />
        <ToolbarExtensions tabId={tab.id} windowId={windowId} palette={palette} top={21.2 - 14} right={inSplit ? 8 + 60 : 8} />
        {tab.url ? (
          <UrlField tab={tab} palette={palette} windowId={windowId} inSplit={inSplit} onFocus={focus} style={{ position: "absolute", left: geometry.urlLeft, right, top: 21.2 - 15 }} />
        ) : null}
        {inSplit && (
          <View style={{ position: "absolute", top, right: 8, flexDirection: "row", gap: -2 }}>
            <ToolbarButton palette={palette} icon="rectangle.split.2x1" size={14} box={30} onPress={() => showSplitMenu(tab.id)} tooltip="Split View" />
            <ToolbarButton palette={palette} icon="xmark" size={12} weight="medium" box={30} onPress={() => closePane(tab.id)} tooltip="Close Pane" />
          </View>
        )}
      </Animated.View>

      {tab.url ? <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: palette.divider }} /> : null}
      {live.isLoading && <ProgressBar progress={live.progress} color={palette.background ? palette.icon : theme.accent} />}
    </View>
  );
}

/** Reload (⇧: ignoring the cache, ⌘: in a background tab); Stop while the page loads. */
export function ReloadButton({ tab, loading, palette, style, onFocus }: { tab: Tab; loading: boolean; palette: ToolbarPalette; style?: ViewStyle; onFocus: () => void }) {
  const web = () => webviews.get(tab.id);
  return (
    <ToolbarButton
      style={style}
      palette={palette}
      icon={loading ? "xmark" : "arrow.clockwise"}
      size={14}
      disabled={!tab.url}
      onPress={(m) => {
        onFocus();
        if (loading) return void web()?.stopLoading();
        if (m.metaKey) return void useBrowser.getState().newTab(tab.windowId, { url: tab.url, background: true, openerId: tab.id });
        void (m.shiftKey ? web()?.forceReload() : web()?.reload());
      }}
      tooltip={loading ? "Stop Loading This Page" : "Refresh (⌘R)"}
    />
  );
}

/** Thin load-progress line along the toolbar's (or the sidebar field's) bottom edge; it glides between reports. */
function ProgressBar({ progress, color }: { progress: number; color: string }) {
  const width = useRef(new Animated.Value(Math.max(progress, 0.08))).current;
  useEffect(() => {
    Animated.timing(width, { toValue: Math.max(progress, 0.08), duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [progress]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        height: 1.5,
        width: width.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
        backgroundColor: color,
        opacity: 0.85,
      }}
    />
  );
}

/**
 * Back / forward. Click navigates; ⌘-click or middle-click opens that page in a
 * background tab (⇧ a new window); press-and-hold or right-click lists the history in
 * that direction (layout/HistoryPopover).
 */
export function HistoryButton({
  tab,
  direction,
  disabled,
  palette,
  style,
  onFocus,
}: {
  tab: Tab;
  direction: -1 | 1;
  disabled: boolean;
  palette: ToolbarPalette;
  style?: object;
  onFocus: () => void;
}) {
  const openMenu = () => {
    onFocus();
    const open = useHistoryMenu.getState().menu;
    if (open?.tabId === tab.id && open.direction === direction) return closeHistoryMenu();
    void openHistoryMenu(tab.id, direction);
  };
  const onPress = async (m: ClickModifiers & { middle?: boolean }) => {
    onFocus();
    closeHistoryMenu();
    const mode = openModeFor(m);
    if (mode === "current" || mode === "split") return direction < 0 ? goBack(tab.id) : goForward(tab.id);
    // The previous / next page in a background tab (⇧⌘: foreground, ⇧: new window).
    const [target] = await historyItems(tab.id, direction, 1);
    if (target?.url) openUrl(target.url, tab.windowId, mode);
  };
  return (
    <MouseArea style={style} onMiddleClick={(e) => !disabled && void onPress({ ...e, middle: true })}>
      <ToolbarButton
        palette={palette}
        icon={direction < 0 ? "chevron.left" : "chevron.right"}
        size={14}
        disabled={disabled}
        onPress={onPress}
        onLongPress={openMenu}
        onContextMenu={openMenu}
        tooltip={direction < 0 ? "Go Back (⌘[)" : "Go Forward (⌘])"}
      />
    </MouseArea>
  );
}

/**
 * The breadcrumb: a web page's host alone, like Dia 1.50 (its URL bar has no page title for web
 * pages; View › Show Full URL adds the path, without a trailing "/"). The app's own pages and
 * local files keep `host / title`. Hovering shows the full URL and the page actions, clicking opens
 * the command bar. `sidebar`: the sidebar's field (Settings › Appearance › Address Bar), filled
 * like a resting pinned tile, with the load progress along its bottom edge.
 */
export function UrlField({
  tab,
  palette,
  windowId,
  inSplit,
  onFocus,
  style,
  sidebar,
}: {
  tab: Tab;
  palette: ToolbarPalette;
  windowId: string;
  inSplit: boolean;
  onFocus: () => void;
  style?: ViewStyle;
  /** `accessory`: the pinned extension buttons, at the field's trailing edge (Arc keeps them in its URL bar). */
  sidebar?: { height: number; progress: number | null; accessory?: ReactNode };
}) {
  const theme = useTheme();
  const showFullUrl = useSettings((s) => s.showFullUrl);
  const bookmarked = useIsBookmarked(tab.url);
  const insecure = usePage(tab.id, (p) => (p.security && (p.security.level === "insecure" || p.security.level === "certificateError") ? p.security.level : null));
  const popups = usePage(tab.id, (p) => p.popups.length);
  const capture = usePage(tab.id, (p) => p.mediaAccess);
  const openPanel = (text: string) => {
    onFocus();
    useBrowser.getState().openPanel(windowId, text);
  };
  const toggleBookmark = () => {
    const s = useBrowser.getState();
    s.toggleBookmark(bookmarkProfileId(s, s.windows[windowId]), tab);
  };
  const toggleSiteControls = () => {
    onFocus();
    setPopover(tab.id, currentPopover(tab.id) === "siteControls" ? null : "siteControls");
  };
  const { hovered, hoverProps } = useHover();
  // Local files have no host: show "File" and the decoded path.
  const isFile = tab.url.startsWith("file:");
  const host = isFile ? "File" : breadcrumb(tab.url).host;
  // The host as `breadcrumb` shows it: an IDN in Unicode only when it passes the spoof checks.
  const full = isFile ? ` ${safeDecode(tab.url.slice("file://".length))}` : urlForDisplay(tab.url);
  const path = !isFile && full.startsWith(host) ? full.slice(host.length) : full;
  const web = /^https?:/i.test(tab.url);
  const trail = hovered ? path : showFullUrl ? path.replace(/\/$/, "") : !web && tab.title ? ` / ${tab.title}` : "";

  return (
    <View
      {...hoverProps}
      style={[
        style,
        { flexDirection: "row", alignItems: "center" },
        sidebar
          ? {
              height: sidebar.height,
              borderRadius: SIDEBAR_FIELD.radius,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: theme.pinnedRestingStroke,
              backgroundColor: hovered ? theme.tabHover : theme.pinnedResting,
              overflow: "hidden",
            }
          : { height: 30, borderRadius: 8, backgroundColor: hovered ? palette.pill : undefined },
      ]}
    >
      {insecure && (
        <Pressable onPress={toggleSiteControls} style={{ paddingLeft: 7 }} tooltip="Connection is not secure">
          <Symbol
            name="lock.open.trianglebadge.exclamationmark.fill"
            size={12}
            color={insecure === "certificateError" ? "#FF5F57" : palette.secondary}
            style={{ width: 18, height: 30 }}
          />
        </Pressable>
      )}
      {/* Right-click: Paste and Go / Paste and Search, Copy URL (Dia). */}
      <ContextMenuArea style={{ flex: 1 }} onContextMenu={() => void showUrlBarMenu(tab)}>
      <Pressable onPress={() => openPanel(tab.url)} style={{ flex: 1, height: sidebar?.height ?? 30, justifyContent: "center", paddingLeft: insecure ? 3 : sidebar ? 10 : 8 }}>
        {sidebar ? (
          // The sidebar's narrow field fades the title / path out, like the tab titles under it.
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontWeight: "500", color: palette.text }}>
              {host}
            </Text>
            {/* FadeLabel pads its text 2pt on each side. */}
            <FadeLabel
              text={trail}
              fontSize={13}
              color={palette.secondary}
              fadeWidth={14}
              style={{ flex: 1, height: 18, marginLeft: -2 }}
            />
          </View>
        ) : (
          <Text numberOfLines={1} style={{ fontSize: 13, color: palette.text }}>
            <Text style={{ fontWeight: "500" }}>{host}</Text>
            {trail ? <Text style={{ color: palette.secondary }}>{trail}</Text> : null}
          </Text>
        )}
      </Pressable>
      </ContextMenuArea>
      <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 3 }}>
        {capture && <CaptureIndicator camera={capture.camera} microphone={capture.microphone} screen={capture.screen} onPress={toggleSiteControls} />}
        {popups > 0 && (
          <ToolbarButton
            palette={palette}
            icon="macwindow.badge.plus"
            size={13}
            box={24}
            radius={6}
            onPress={() => {
              onFocus();
              setPopover(tab.id, currentPopover(tab.id) === "popups" ? null : "popups");
            }}
            tooltip="Pop-ups blocked on this page"
          />
        )}
        {hovered && (
          <>
            <ToolbarButton palette={palette} icon={bookmarked ? "bookmark.fill" : "bookmark"} size={13} box={24} radius={6} onPress={toggleBookmark} tooltip={bookmarked ? "Remove Bookmark" : "Bookmark This Page (⌘D)"} />
            {!inSplit && !sidebar && (
              <ToolbarButton
                palette={palette}
                icon="rectangle.split.2x1"
                size={13}
                box={24}
                radius={6}
                onPress={() => openSplitPane(windowId, { anchorTabId: tab.id })}
                tooltip="Open Split View (⌃⇧=)"
              />
            )}
            <ToolbarButton palette={palette} icon="slider.horizontal.3" size={13} box={24} radius={6} onPress={toggleSiteControls} tooltip="Site Controls" />
          </>
        )}
        {sidebar?.accessory}
      </View>
      {sidebar && sidebar.progress !== null ? <ProgressBar progress={sidebar.progress} color={theme.accent} /> : null}
    </View>
  );
}

/** The page is using the camera / microphone / screen: a red glyph that opens Site Controls. */
function CaptureIndicator({ camera, microphone, screen, onPress }: { camera: boolean; microphone: boolean; screen: boolean; onPress: () => void }) {
  const icon = screen ? "rectangle.inset.filled.on.rectangle" : camera ? "video.fill" : "mic.fill";
  const what = [camera && "camera", microphone && "microphone", screen && "screen"].filter(Boolean).join(" and ");
  return (
    <Pressable onPress={onPress} tooltip={`This page is using your ${what}`} style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
      <Symbol name={icon} size={12} color="#FF453A" style={{ width: 18, height: 18 }} />
    </Pressable>
  );
}

/** Read at click time, so the toolbar doesn't re-render with the popover. */
const currentPopover = (tabId: string) => usePages.getState().popover[tabId] ?? null;

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
