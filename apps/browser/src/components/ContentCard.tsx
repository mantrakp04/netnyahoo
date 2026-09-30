import { WebView, type OpenWindowRequest } from "@netnyahoo/cef";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { focus, switchToTab } from "../lib/actions";
import { noteFavicon } from "../lib/favicons";
import { isQuitting } from "../lib/native";
import { layout, useTheme } from "../lib/theme";
import { onChromeTabStrip, startChromeTabs } from "../lib/chromeTabs";
import { noteDiscarded, noteGone, noteReady } from "../lib/tabLifecycle";
import { webviewRef, webviews } from "../lib/webviews";
import { useBrowser } from "../store/browser";
import { useActiveTabId, useSidebarOpen, useWindowId } from "../store/hooks";
import { engineProfile, wake } from "../store/model";
import { splitOf } from "../store/splits";
import type { SplitView } from "../store/types";
import { BookmarksBar } from "./bookmarks/BookmarksBar";
import { FindBar } from "./FindBar";
import { NO_TOOLBAR, splitGeometry, toolbarGeometry, type Rect, type ToolbarGeometry } from "./layout/geometry";
import { dismissPermissions, startPermissionPrompts } from "./site/permissions";
import { patchPage, pageOf, setBrowserId, setPopover, useFullscreenTab, usePage, usePopover } from "./layout/pageState";
import { SadTab, StatusBubble } from "./layout/PaneOverlays";
import { DropTargets, SplitDividers, SplitToast } from "./layout/SplitChrome";
import { SplitEmptyState } from "./layout/SplitEmptyState";
import { pagerFor } from "./layout/profilePager";
import { openFromPage } from "./layout/openFromPage";
import { setUrlAnchor, useAddressBarInSidebar, useTabLayout } from "./layout/windowLayout";
import { NewTabPage } from "./NewTabPage";
import { InternalPage, isInternalTab } from "./pages";
import { BlockedPopupsPrompt, ExternalAppPrompt, PasswordPrompt, PermissionPrompt, answerExternalApp, shouldPromptForPopups, showPasswordPrompt } from "./site/Prompts";
import { SiteControls } from "./site/SiteControls";
import { ZoomPopover } from "./site/ZoomControls";
import { SelectionPopover } from "./site/SelectionPopover";
import { copyLinkToSelection, searchSelection, setPageSelection, startSelectionTools, type PageSelection } from "./site/selection";
import { startMedia, useAutoPictureInPicture } from "./media/pip";
import { SharePicker, requestDisplayMedia } from "./media/SharePicker";
import { ShareBar } from "./media/ShareBar";
import { CastPicker } from "./media/CastPicker";
import { DeviceChooser } from "./site/DeviceChooser";
import { setNowPlaying, setPictureInPictureState } from "./media/state";
import { Toolbar } from "./Toolbar";
import { NavigationOverlays } from "./layout/SwipeOverlay";
import "./layout/devExpose";
import { closeWebNotification, showWebNotification } from "../lib/webNotifications";
import { isSmallWindow } from "../store/small";
import { closeSmallYahuOnEscape } from "./smallYahu/actions";

export function ContentCard() {
  const windowId = useWindowId();
  const activeId = useActiveTabId();
  const split = useBrowser((s) => splitOf(s, activeId));
  const fullscreenTab = useFullscreenTab(windowId);
  const sidebarOpen = useSidebarOpen();
  const tabLayout = useTabLayout();
  const addressInSidebar = useAddressBarInSidebar();
  // Small Yahu draws its own bar above the card (components/smallYahu).
  const small = useBrowser((s) => isSmallWindow(s.windows[windowId]));
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const container = useRef<View>(null);
  useEffect(startPermissionPrompts, []);
  useEffect(startChromeTabs, []);
  useEffect(startMedia, []);
  useEffect(startSelectionTools, []);

  // Recomputed only when the window's tabs change, not on every store update (page progress, say).
  const mountedMemo = useRef<{ tabIds?: string[]; tabs?: object; ids: string[] }>({ ids: [] });
  const mounted = useBrowser(
    useShallow((s) => {
      const tabIds = s.windows[windowId]?.tabIds;
      const memo = mountedMemo.current;
      if (memo.tabIds === tabIds && memo.tabs === s.tabs) return memo.ids;
      const ids = (tabIds ?? [])
        .map((id) => s.tabs[id]!)
        .filter((t) => t && (t.navigation || t.adoptId) && !isInternalTab(t))
        .map((t) => t.id);
      mountedMemo.current = { tabIds, tabs: s.tabs, ids };
      return ids;
    }),
  );

  const { panes, dividers } = useMemo(() => {
    const full: Rect = { x: 0, y: 0, width: size.width, height: size.height };
    if (fullscreenTab) return { panes: { [fullscreenTab]: full }, dividers: [] };
    if (split) return splitGeometry(split, size.width, size.height);
    return { panes: activeId ? { [activeId]: full } : {}, dividers: [] };
  }, [split, activeId, fullscreenTab, size.width, size.height]);

  useEffect(() => {
    const s = useBrowser.getState();
    for (const id of Object.keys(panes)) {
      const t = s.tabs[id];
      if (t?.url && !t.navigation && !t.adoptId) s.updateTab(id, wake(t));
    }
  }, [panes]);

  const pagerPages = pagerFor(windowId).state((st) => st.pages);
  // Keep adjacent profile pages painting so a swipe doesn't reveal an unpainted page.
  const warm = useBrowser(
    useShallow((s) => {
      const w = s.windows[windowId];
      if (!w || !pagerPages) return [];
      return pagerPages.map((p) => (p.id === w.profileId ? undefined : w.activeTabIds[p.id])).filter((id): id is string => !!id);
    }),
  );
  const warmSplits = useBrowser(useShallow((s) => warm.map((id) => splitOf(s, id)).filter((v): v is SplitView => !!v)));
  const warmPanes = useMemo(() => {
    const out: Record<string, Rect> = {};
    for (const id of warm) out[id] = { x: 0, y: 0, width: size.width, height: size.height };
    for (const v of warmSplits) Object.assign(out, splitGeometry(v, size.width, size.height).panes);
    return out;
  }, [warm, warmSplits, size.width, size.height]);

  const shown = useBrowser(
    useShallow((s) =>
      [...new Set([...mounted, ...Object.keys(panes)])]
        .map((id) => s.tabs[id])
        .filter((t) => !!t)
        // Keep mount order stable; reordering native subviews while tabs move can shuffle them.
        .sort((a, b) => a!.createdAt - b!.createdAt)
        .map((t) => `${t!.id}|${t!.profileId}`),
    ),
  );

  const geometryFor = (rect: Rect | undefined): ToolbarGeometry => {
    if (addressInSidebar || small) return NO_TOOLBAR;
    const leading = !!rect && rect.x === 0 && rect.y === 0;
    return toolbarGeometry({ sidebarButton: leading && tabLayout === "sidebar", clearTrafficLights: leading && tabLayout === "sidebar" && !sidebarOpen });
  };

  const focusedRect = activeId ? panes[activeId] : undefined;
  useEffect(() => {
    if (!origin || !focusedRect || addressInSidebar || small) return;
    const g = geometryFor(focusedRect);
    setUrlAnchor(windowId, { left: origin.x + focusedRect.x + g.urlLeft, top: origin.y + focusedRect.y, width: focusedRect.width - g.urlLeft - 12 });
  }, [origin, focusedRect?.x, focusedRect?.y, focusedRect?.width, tabLayout, sidebarOpen, addressInSidebar]);

  return (
    <View
      ref={container}
      style={{ flex: 1 }}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize({ width, height });
        container.current?.measureInWindow((x, y) => setOrigin({ x, y }));
      }}
    >
      {size.width > 0 &&
        shown.map((key) => {
          const tabId = key.slice(0, key.indexOf("|"));
          const rect = panes[tabId];
          return (
            <TabPane
              key={key}
              tabId={tabId}
              windowId={windowId}
              rect={rect}
              fullWidth={size.width}
              fullHeight={size.height}
              focused={tabId === activeId}
              split={split}
              fullscreen={tabId === fullscreenTab}
              geometry={geometryFor(rect)}
              toolbar={!addressInSidebar && !small}
              small={small}
              mounted={mounted.includes(tabId)}
              warm={warmPanes[tabId]}
            />
          );
        })}
      {split && !fullscreenTab && <SplitDividers split={split} dividers={dividers} width={size.width} height={size.height} />}
      {!fullscreenTab && <DropTargets panes={panes} origin={origin} />}
      <SplitToast windowId={windowId} />
    </View>
  );
}

// Memoized: the card re-renders on every switch, and a pane only needs to when its own props change.
const TabPane = memo(function TabPane({
  tabId,
  windowId,
  rect,
  fullWidth,
  fullHeight,
  focused,
  split,
  fullscreen,
  geometry,
  toolbar,
  small,
  mounted,
  warm,
}: {
  tabId: string;
  windowId: string;
  rect: Rect | undefined;
  fullWidth: number;
  fullHeight: number;
  focused: boolean;
  split: SplitView | undefined;
  fullscreen: boolean;
  geometry: ToolbarGeometry;
  toolbar: boolean;
  small: boolean;
  mounted: boolean;
  warm: Rect | undefined;
}) {
  const theme = useTheme();
  const visible = !!rect;
  const isNewTab = useBrowser((s) => !s.tabs[tabId]?.url);
  const zoom = useBrowser((s) => s.tabs[tabId]?.zoom ?? 1);
  const popover = usePopover(tabId);
  const newTabShown = usePage(tabId, (p) => !!p.newTabShown);
  const inSomeSplit = useBrowser((s) => !!warm && !!splitOf(s, tabId));
  const inSplit = visible ? !!split?.tabIds.includes(tabId) : inSomeSplit;
  const frame = rect ?? warm ?? { x: 0, y: 0, width: fullWidth, height: fullHeight };
  useEffect(() => {
    if (visible && isNewTab && !mounted) patchPage(tabId, { wasNewTab: true });
  }, [visible, isNewTab, mounted]);

  return (
    <View
      pointerEvents={visible ? "auto" : "none"}
      onTouchStart={() => {
        if (visible && !focused) useBrowser.getState().activate(tabId);
      }}
      style={{
        position: "absolute",
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        borderRadius: fullscreen ? 0 : layout.cardRadius,
        overflow: "hidden",
        backgroundColor: visible && !fullscreen ? theme.card : undefined,
      }}
    >
      {!toolbar || fullscreen ? null : visible ? (
        <Toolbar tabId={tabId} geometry={geometry} windowId={windowId} inSplit={inSplit} focused={focused || !inSplit} />
      ) : (
        <View style={{ height: layout.toolbarHeight }} />
      )}
      {!fullscreen && !inSplit && !small && <BookmarksBar tabId={tabId} placeholder={!visible} />}
      {visible && !fullscreen && <ShareBar tabId={tabId} />}
      <View style={{ flex: 1 }}>
        {mounted && <TabWebView tabId={tabId} visible={visible && !newTabShown && !isNewTab} warm={!!warm && !newTabShown && !isNewTab} />}
        {visible && isNewTab && !small && (inSplit ? <SplitEmptyState tabId={tabId} focused={focused} /> : <NewTabPage key={tabId} tabId={tabId} toolbar={toolbar} />)}
        {visible && <InternalPage tabId={tabId} />}
        {visible && (
          <>
            <FindBar tabId={tabId} />
            <StatusBubble tabId={tabId} maxWidth={Math.max(160, frame.width / 2)} />
            <SadTab tabId={tabId} />
            <PermissionPrompt tabId={tabId} left={Math.max(8, Math.min(geometry.urlLeft, frame.width - 308))} top={4} />
            <PasswordPrompt tabId={tabId} right={8} top={4} />
            <ExternalAppPrompt tabId={tabId} left={Math.max(8, Math.min(geometry.urlLeft, frame.width - 348))} top={4} />
            {popover === "siteControls" && <SiteControls tabId={tabId} {...(toolbar ? { right: 8 } : { left: 8 })} top={2} />}
            {popover === "popups" && <BlockedPopupsPrompt tabId={tabId} {...(toolbar ? { right: 8 } : { left: 8 })} top={2} />}
            {popover === "zoom" && <ZoomPopover tabId={tabId} {...(toolbar ? { right: 8 } : { left: 8 })} top={2} />}
            <SharePicker tabId={tabId} paneWidth={frame.width} />
            <DeviceChooser tabId={tabId} left={Math.max(8, Math.min(geometry.urlLeft, frame.width - 348))} top={4} />
            <CastPicker tabId={tabId} paneWidth={frame.width} />
            <NavigationOverlays tabId={tabId} windowId={windowId} geometry={geometry} />
            <SelectionPopover tabId={tabId} zoom={zoom} />
          </>
        )}
      </View>
    </View>
  );
});

const isBlank = (url: string) => !url || url === "about:blank";
const pageKey = (url: string) => url.replace(/#.*$/, "");
const hostOf = (url: string) => url.match(/^[a-z][\w+.-]*:\/\/([^/?#]*)/i)?.[1]?.toLowerCase() ?? "";

function TabWebView({ tabId, visible, warm }: { tabId: string; visible: boolean; warm: boolean }) {
  const theme = useTheme();
  const navigation = useBrowser((s) => s.tabs[tabId]?.navigation);
  const adoptId = useBrowser((s) => s.tabs[tabId]?.adoptId);
  const profileId = useBrowser((s) => s.tabs[tabId]?.profileId ?? "");
  const tab = () => useBrowser.getState().tabs[tabId];
  const store = () => useBrowser.getState();
  const ref = useMemo(() => webviewRef(tabId), [tabId]);
  const autoPictureInPicture = useAutoPictureInPicture(tabId, visible);

  const lastVisited = useRef<string | null>(null);
  const lastPage = useRef<string | null>(null);
  const pending = useRef<string | null>(navigation?.url ?? (adoptId ? (tab()?.url ?? null) : null));

  const seq = navigation?.seq;
  useEffect(() => {
    if (!navigation) return;
    pending.current = navigation.url;
    if (pageOf(tabId).newTabShown) patchPage(tabId, { newTabShown: null });
    void webviews.get(tabId)?.loadUrl(navigation.url, { userInitiated: !!navigation.userInitiated });
  }, [seq]);
  const fromNewTab = useRef(pageOf(tabId).wasNewTab && !adoptId);
  useEffect(() => () => noteGone(tabId), []);

  const onOpenWindow = (request: OpenWindowRequest) => {
    const t = tab();
    if (t) openFromPage(request, { windowId: t.windowId, profileId: t.profileId, tabId });
  };

  return (
    <WebView
      ref={ref}
      style={StyleSheet.absoluteFill}
      url={navigation?.url ?? (adoptId ? tab()?.url : undefined)}
      profile={engineProfile(profileId)}
      adoptId={adoptId}
      transferKey={tabId}
      visible={visible}
      warm={warm}
      autoPictureInPicture={autoPictureInPicture}
      pageBackgroundColor={theme.card}
      onReady={(browserId) => {
        setBrowserId(tabId, browserId);
        noteReady(tabId);
        if (tab()?.muted) void webviews.get(tabId)?.setMuted(true);
      }}
      onNavigationChange={({ url, title, canGoBack, canGoForward, isLoading, themeColor, themeColorSource }) => {
        const target = pending.current;
        // A fresh browser reports about:blank before the requested navigation commits.
        if (target !== null && isBlank(url) && !target.startsWith("about:")) {
          store().updateLive(tabId, { isLoading: true });
          return;
        }
        pending.current = null;
        const kept = pageOf(tabId).newTabShown;
        if (kept) {
          if (url === kept.url) {
            patchPage(tabId, { newTabShown: { ...kept, title } });
            store().updateLive(tabId, { isLoading, canGoBack, canGoForward, themeColor });
            return;
          }
          patchPage(tabId, { newTabShown: null });
        }
        if (fromNewTab.current && url && !isBlank(url)) patchPage(tabId, { backToNewTab: true });
        store().updateTab(tabId, { url, title });
        store().updateLive(tabId, { isLoading, canGoBack, canGoForward, themeColor });
        if (lastPage.current !== null && pageKey(url) !== lastPage.current) {
          // Like Chrome's tab-modal dialogs, the open-app prompt stays within a site.
          if (pageOf(tabId).externalApp && hostOf(url) !== hostOf(lastPage.current)) answerExternalApp(tabId, false);
          dismissPermissions(tabId);
          setPopover(tabId, null);
          setPageSelection(tabId, null);
          patchPage(tabId, { popups: [], passwordPrompt: null, crashed: null, status: "" });
        }
        lastPage.current = pageKey(url);
        patchPage(tabId, { themeColorSource: themeColorSource ?? null });
        if (!isLoading && url) {
          const isNewPage = lastVisited.current !== url;
          lastVisited.current = url;
          const t = tab();
          if (t) store().recordVisit(t.profileId, url, title, t.favicon, isNewPage);
        }
      }}
      onLoadError={() => {
        pending.current = null;
      }}
      onDownloadNavigation={({ committedUrl, skipped }) => {
        pending.current = null;
        const t = tab();
        if (!t) return;
        const s = store();
        store().updateLive(tabId, { isLoading: false });
        if (committedUrl) {
          if (t.url !== committedUrl) store().updateTab(tabId, { url: committedUrl });
          return;
        }
        const others = s.windows[t.windowId]?.tabIds.some((id) => id !== tabId && s.tabs[id]?.profileId === t.profileId);
        const opened = !!(t.openerId || t.adoptId) && !pageOf(tabId).wasNewTab;
        if (!skipped && opened && !s.live[tabId]?.canGoBack && others) return store().closeTab(tabId);
        patchPage(tabId, { backToNewTab: false, newTabShown: null });
        store().updateTab(tabId, { url: "", title: "", favicon: null });
      }}
      onProgress={(progress) => store().updateLive(tabId, { progress })}
      onZoom={({ zoom }) => store().updateTab(tabId, { zoom })}
      onFindResult={({ count, active }) => store().setFind(tabId, { count, active })}
      onFavicon={(favicon) => {
        const t = tab();
        if (!favicon || !t) return;
        store().updateTab(tabId, { favicon });
        noteFavicon(tabId, favicon);
        if (t.url) store().recordVisit(t.profileId, t.url, t.title, favicon);
      }}
      onMedia={({ playing, muted }) => {
        store().updateLive(tabId, { playingAudio: playing });
        // A new browser can drop mute state before its first page load.
        if (tab()?.muted && !muted) void webviews.get(tabId)?.setMuted(true);
      }}
      onNowPlaying={(state) => setNowPlaying(tabId, state)}
      onPictureInPicture={(state) => setPictureInPictureState(tabId, state)}
      onDisplayMediaRequest={(request) => requestDisplayMedia(tabId, request)}
      onOpenWindow={onOpenWindow}
      onStatus={(status) => patchPage(tabId, { status })}
      onCrashed={(crashed) => {
        if (!isQuitting()) patchPage(tabId, { crashed, unresponsive: false, fullscreen: false, status: "" });
      }}
      onUnresponsive={() => patchPage(tabId, { unresponsive: true })}
      onResponsive={() => patchPage(tabId, { unresponsive: false })}
      onFullscreen={(fullscreen) => patchPage(tabId, { fullscreen })}
      onMediaAccess={(mediaAccess) => patchPage(tabId, { mediaAccess: mediaAccess.camera || mediaAccess.microphone || mediaAccess.screen ? mediaAccess : null })}
      onSecurity={(security) => patchPage(tabId, { security })}
      onContentBlocked={({ count }) => patchPage(tabId, { blocked: count })}
      onPopupBlocked={(popup) => {
        const first = !pageOf(tabId).popups.length;
        patchPage(tabId, { popups: [...pageOf(tabId).popups, popup] });
        if (first) void shouldPromptForPopups(engineProfile(profileId), popup.origin).then((ask) => ask && setPopover(tabId, "popups"));
      }}
      onPasswordPrompt={(prompt) => showPasswordPrompt(tabId, prompt)}
      onTabStrip={(place) => onChromeTabStrip(tabId, place)}
      onExternalApp={(externalApp) => patchPage(tabId, { externalApp })}
      onPageFocus={() => {
        const t = tab();
        if (t && splitOf(store(), tabId) && store().windows[t.windowId]?.activeTabIds[t.profileId] !== tabId) store().activate(tabId);
      }}
      // Engine close callbacks also fire during quit; don't remove saved-session tabs then.
      onWindowClose={() => !isQuitting() && store().closeTab(tabId)}
      onNotification={(notification) => showWebNotification(tabId, notification)}
      onCommand={({ command, text, modifiers }) => {
        if (command === "search") searchSelection(tabId, text, modifiers);
        else if (command === "copyLinkToHighlight") void copyLinkToSelection(tabId);
        else if (command === "escape") closeSmallYahuOnEscape(tabId);
      }}
      onPageMessage={(kind, data) => {
        if (kind === "selection") setPageSelection(tabId, data as PageSelection | null);
      }}
      onNotificationClose={closeWebNotification}
      onDiscarded={(url) => {
        pending.current = url;
        fromNewTab.current = false;
        patchPage(tabId, { backToNewTab: false, status: "" });
        store().updateLive(tabId, { isLoading: false, progress: 0, canGoBack: false, canGoForward: false, playingAudio: false });
        noteDiscarded(tabId);
      }}
      onActivateRequest={() => {
        const t = tab();
        if (!t) return;
        switchToTab(tabId);
        focus(t.windowId);
      }}
    />
  );
}
