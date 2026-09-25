import { WebView, type OpenWindowRequest } from "@netnyahoo/cef";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { focus, openWindow, switchToTab } from "../lib/actions";
import { noteFavicon } from "../lib/favicons";
import { isQuitting } from "../lib/native";
import { layout, useTheme } from "../lib/theme";
import { onChromeTabStrip, startChromeTabs } from "../lib/chromeTabs";
import { noteDiscarded, noteGone, noteReady } from "../lib/tabLifecycle";
import { webviewRef, webviews } from "../lib/webviews";
import { useBrowser } from "../store/browser";
import { useActiveTabId, useSidebarOpen, useWindowId } from "../store/hooks";
import { engineProfile, navigationTo } from "../store/model";
import { splitOf } from "../store/splits";
import type { SplitView } from "../store/types";
import { BookmarksBar } from "./bookmarks/BookmarksBar";
import { FindBar } from "./FindBar";
import { splitGeometry, toolbarGeometry, type Rect, type ToolbarGeometry } from "./layout/geometry";
import { dismissPermissions, startPermissionPrompts } from "./site/permissions";
import { patchPage, pageOf, setBrowserId, setPopover, useFullscreenTab, usePage, usePopover } from "./layout/pageState";
import { SadTab, StatusBubble } from "./layout/PaneOverlays";
import { DropTargets, SplitDividers, SplitToast } from "./layout/SplitChrome";
import { SplitEmptyState } from "./layout/SplitEmptyState";
import { openLinkInSplit } from "./layout/splitActions";
import { setUrlAnchor, useTabLayout } from "./layout/windowLayout";
import { NewTabPage } from "./NewTabPage";
import { InternalPage, isInternalTab } from "./pages";
import { BlockedPopupsPrompt, PasswordPrompt, PermissionPrompt, shouldPromptForPopups, showPasswordPrompt } from "./site/Prompts";
import { SiteControls } from "./site/SiteControls";
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

/**
 * The page area: one card for the active tab, or one per pane when it's in a
 * split (Dia: up to three, with draggable dividers). Every visited tab keeps its
 * web view alive in its own pane container; only the shown ones paint.
 */
export function ContentCard() {
  const windowId = useWindowId();
  const activeId = useActiveTabId();
  const split = useBrowser((s) => splitOf(s, activeId));
  const fullscreenTab = useFullscreenTab(windowId);
  const sidebarOpen = useSidebarOpen();
  const tabLayout = useTabLayout();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const container = useRef<View>(null);
  useEffect(startPermissionPrompts, []);
  useEffect(startChromeTabs, []);
  useEffect(startMedia, []);
  useEffect(startSelectionTools, []);

  // Keyed by profile too: moving a tab to another profile needs a new browser. Creation order
  // keeps native subviews from being shuffled when tabs are reordered.
  const mounted = useBrowser(
    useShallow((s) =>
      (s.windows[windowId]?.tabIds ?? [])
        .map((id) => s.tabs[id]!)
        .filter((t) => t && (t.navigation || t.adoptId) && !isInternalTab(t))
        .map((t) => t.id),
    ),
  );

  const { panes, dividers } = useMemo(() => {
    const full: Rect = { x: 0, y: 0, width: size.width, height: size.height };
    if (fullscreenTab) return { panes: { [fullscreenTab]: full }, dividers: [] };
    if (split) return splitGeometry(split, size.width, size.height);
    return { panes: activeId ? { [activeId]: full } : {}, dividers: [] };
  }, [split, activeId, fullscreenTab, size.width, size.height]);

  // Tabs restored from the last session load when first shown; in a split that's every pane.
  useEffect(() => {
    const s = useBrowser.getState();
    for (const id of Object.keys(panes)) {
      const t = s.tabs[id];
      if (t?.url && !t.navigation && !t.adoptId) s.updateTab(id, { navigation: navigationTo(t.url) });
    }
  }, [panes]);

  const shown = useBrowser(
    useShallow((s) =>
      [...new Set([...mounted, ...Object.keys(panes)])]
        .map((id) => s.tabs[id])
        .filter((t) => !!t)
        .sort((a, b) => a!.createdAt - b!.createdAt)
        .map((t) => `${t!.id}|${t!.profileId}`),
    ),
  );

  // The pane touching the window's top-left corner holds the sidebar button, and makes room
  // for the traffic lights when nothing else does.
  const geometryFor = (rect: Rect | undefined): ToolbarGeometry => {
    const leading = !!rect && rect.x === 0 && rect.y === 0;
    return toolbarGeometry({ sidebarButton: leading && tabLayout === "sidebar", clearTrafficLights: leading && tabLayout === "sidebar" && !sidebarOpen });
  };

  // The command panel opens over the focused pane's URL field.
  const focusedRect = activeId ? panes[activeId] : undefined;
  useEffect(() => {
    if (!origin || !focusedRect) return;
    const g = geometryFor(focusedRect);
    setUrlAnchor(windowId, { left: origin.x + focusedRect.x + g.urlLeft, top: origin.y + focusedRect.y, width: focusedRect.width - g.urlLeft - 12 });
  }, [origin, focusedRect?.x, focusedRect?.y, focusedRect?.width, tabLayout, sidebarOpen]);

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
              full={{ width: size.width, height: size.height }}
              focused={tabId === activeId}
              split={split}
              fullscreen={tabId === fullscreenTab}
              geometry={geometryFor(rect)}
              mounted={mounted.includes(tabId)}
            />
          );
        })}
      {split && !fullscreenTab && <SplitDividers split={split} dividers={dividers} width={size.width} height={size.height} />}
      {!fullscreenTab && <DropTargets panes={panes} origin={origin} />}
      <SplitToast windowId={windowId} />
    </View>
  );
}

/**
 * One tab's pane: card, navigation bar and page, plus what floats over the page
 * (find bar, status bubble, prompts, sad tab). Hidden tabs keep their container
 * at the full size with a toolbar-high spacer, so showing them doesn't resize the page.
 */
function TabPane({
  tabId,
  windowId,
  rect,
  full,
  focused,
  split,
  fullscreen,
  geometry,
  mounted,
}: {
  tabId: string;
  windowId: string;
  rect: Rect | undefined;
  full: { width: number; height: number };
  focused: boolean;
  split: SplitView | undefined;
  fullscreen: boolean;
  geometry: ToolbarGeometry;
  mounted: boolean;
}) {
  const theme = useTheme();
  const visible = !!rect;
  const isNewTab = useBrowser((s) => !s.tabs[tabId]?.url);
  const zoom = useBrowser((s) => s.tabs[tabId]?.zoom ?? 1);
  const popover = usePopover(tabId);
  const newTabShown = usePage(tabId, (p) => !!p.newTabShown);
  const inSplit = visible && !!split?.tabIds.includes(tabId);
  const frame = rect ?? { x: 0, y: 0, ...full };
  // A web view created from here keeps the New Tab page as its first history entry.
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
      {visible && !fullscreen ? (
        <Toolbar tabId={tabId} geometry={geometry} windowId={windowId} inSplit={inSplit} focused={focused || !inSplit} />
      ) : fullscreen ? null : (
        <View style={{ height: layout.toolbarHeight }} />
      )}
      {!fullscreen && !inSplit && <BookmarksBar tabId={tabId} placeholder={!visible} />}
      {visible && !fullscreen && <ShareBar tabId={tabId} />}
      <View style={{ flex: 1 }}>
        {mounted && <TabWebView tabId={tabId} visible={visible && !newTabShown && !isNewTab} />}
        {visible && isNewTab && (inSplit ? <SplitEmptyState tabId={tabId} focused={focused} /> : <NewTabPage key={tabId} tabId={tabId} />)}
        {/* netnyahoo://history, bookmarks, downloads (components/pages): no web view. */}
        {visible && <InternalPage tabId={tabId} />}
        {visible && (
          <>
            <FindBar tabId={tabId} />
            <StatusBubble tabId={tabId} maxWidth={Math.max(160, frame.width / 2)} />
            <SadTab tabId={tabId} />
            <PermissionPrompt tabId={tabId} left={Math.max(8, Math.min(geometry.urlLeft, frame.width - 308))} top={4} />
            <PasswordPrompt tabId={tabId} right={8} top={4} />
            {popover === "siteControls" && <SiteControls tabId={tabId} right={8} top={2} />}
            {popover === "popups" && <BlockedPopupsPrompt tabId={tabId} right={8} top={2} />}
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
}

const isBlank = (url: string) => !url || url === "about:blank";
/** Scheme + host + path: a hash change or title update isn't a new page. */
const pageKey = (url: string) => url.replace(/#.*$/, "");

function TabWebView({ tabId, visible }: { tabId: string; visible: boolean }) {
  const theme = useTheme();
  const navigation = useBrowser((s) => s.tabs[tabId]?.navigation);
  const adoptId = useBrowser((s) => s.tabs[tabId]?.adoptId);
  // The tab can be gone for a moment before this unmounts.
  const profileId = useBrowser((s) => s.tabs[tabId]?.profileId ?? "");
  const tab = () => useBrowser.getState().tabs[tabId];
  const store = () => useBrowser.getState();
  const ref = useMemo(() => webviewRef(tabId), [tabId]);
  const autoPictureInPicture = useAutoPictureInPicture(tabId, visible);

  // The last URL counted as a visit, so title/favicon updates don't count again.
  const lastVisited = useRef<string | null>(null);
  // The page the tab last showed: leaving it closes the page's prompts and popovers.
  const lastPage = useRef<string | null>(null);
  // A navigation we asked for hasn't committed yet: a fresh browser first reports "" / about:blank,
  // which mustn't overwrite the tab's URL (that flashed the New Tab page over a loading page).
  const pending = useRef<string | null>(navigation?.url ?? (adoptId ? (tab()?.url ?? null) : null));

  // Replay explicit navigations (command bar) imperatively so the same URL can load twice.
  const seq = navigation?.seq;
  useEffect(() => {
    if (!navigation) return;
    pending.current = navigation.url;
    // Leaving the New Tab page for a new address drops the page kept for Forward.
    if (pageOf(tabId).newTabShown) patchPage(tabId, { newTabShown: null });
    void webviews.get(tabId)?.loadUrl(navigation.url, { userInitiated: !!navigation.userInitiated });
  }, [seq]);
  // Started from the New Tab page: Back from the first page goes there (see layout/history).
  const fromNewTab = useRef(pageOf(tabId).wasNewTab && !adoptId);
  useEffect(() => () => noteGone(tabId), []);

  const onOpenWindow = ({ url, adoptId, disposition }: OpenWindowRequest) => {
    const t = tab();
    if (!t) return;
    const incognito = store().windows[t.windowId]?.incognito;
    if (disposition === "current") return store().navigate(tabId, url, { userInitiated: false });
    // ⇧⌥-click: the link opens in the pane to the right (engine reports it as "split").
    if (disposition === "split") return openLinkInSplit(tabId, url);
    if (disposition === "incognito") return void openWindow({ incognito: true, url });
    // An incognito window's profile can't span windows, so its new windows open as tabs.
    if (disposition === "window" && !incognito) return void openWindow({ profileId: t.profileId, url, adoptId });
    // popup: a tab for now (keeps window.opener through adoptId).
    store().newTab(t.windowId, { url, adoptId, openerId: tabId, profileId: t.profileId, background: disposition === "background" });
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
      autoPictureInPicture={autoPictureInPicture}
      pageBackgroundColor={theme.card}
      onReady={(browserId) => {
        setBrowserId(tabId, browserId);
        noteReady(tabId);
        // Restored mute state the new browser doesn't know about yet.
        if (tab()?.muted) void webviews.get(tabId)?.setMuted(true);
      }}
      onNavigationChange={({ url, title, canGoBack, canGoForward, isLoading, themeColor, themeColorSource }) => {
        const target = pending.current;
        if (target !== null && isBlank(url) && !target.startsWith("about:")) {
          store().updateLive(tabId, { isLoading: true });
          return;
        }
        pending.current = null;
        // Back on the New Tab page: the hidden page's updates wait for Forward.
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
      // The navigation became a download: the tab keeps (or goes back to) what it showed.
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
        // Nothing committed. A tab opened just for the file closes, like Chrome; one that
        // started on the New Tab page (or a skipped restore) shows it again.
        const others = s.windows[t.windowId]?.tabIds.some((id) => id !== tabId && s.tabs[id]?.profileId === t.profileId);
        const opened = !!(t.openerId || t.adoptId) && !pageOf(tabId).wasNewTab;
        if (!skipped && opened && !s.live[tabId]?.canGoBack && others) return store().closeTab(tabId);
        patchPage(tabId, { backToNewTab: false, newTabShown: null });
        store().updateTab(tabId, { url: "", title: "", favicon: null });
      }}
      onProgress={(progress) => store().updateLive(tabId, { progress })}
      // Zoom is per host and remembered per profile by the engine (restored on relaunch too);
      // the tab mirrors it for the menus.
      onZoom={({ zoom }) => store().updateTab(tabId, { zoom })}
      onFindResult={({ count, active }) => store().setFind(tabId, { count, active })}
      onFavicon={(favicon) => {
        const t = tab();
        if (!favicon || !t) return;
        store().updateTab(tabId, { favicon });
        noteFavicon(tabId, favicon);
        if (t.url) store().recordVisit(t.profileId, t.url, t.title, favicon);
      }}
      // Mute is ours (tab.muted): the engine's report never overwrites it. A new browser can
      // drop a mute applied before its first page loads, so re-apply it when that happens.
      onMedia={({ playing, muted }) => {
        store().updateLive(tabId, { playingAudio: playing });
        if (tab()?.muted && !muted) void webviews.get(tabId)?.setMuted(true);
      }}
      onNowPlaying={(state) => setNowPlaying(tabId, state)}
      onPictureInPicture={(state) => setPictureInPictureState(tabId, state)}
      onDisplayMediaRequest={(request) => requestDisplayMedia(tabId, request)}
      onOpenWindow={onOpenWindow}
      onStatus={(status) => patchPage(tabId, { status })}
      onCrashed={(crashed) => {
        // Killed on purpose (Exit Page, app shutdown) still shows the reload view, like Chrome.
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
        // The first one on a page asks (Dia's pop-up dialog), unless the site is set to always deny.
        if (first) void shouldPromptForPopups(engineProfile(profileId), popup.origin).then((ask) => ask && setPopover(tabId, "popups"));
      }}
      onPasswordPrompt={(prompt) => showPasswordPrompt(tabId, prompt)}
      onTabStrip={(place) => onChromeTabStrip(tabId, place)}
      // Clicking into a split pane's page focuses that pane.
      onPageFocus={() => {
        const t = tab();
        if (t && splitOf(store(), tabId) && store().windows[t.windowId]?.activeTabIds[t.profileId] !== tabId) store().activate(tabId);
      }}
      // window.close() from the page. The engine also reports this for every browser it
      // closes while quitting; those must not close tabs in the saved session.
      onWindowClose={() => !isQuitting() && store().closeTab(tabId)}
      onNotification={(notification) => showWebNotification(tabId, notification)}
      // The page menu's selection items ("Ask About Selection" stays hidden until Chat exists).
      onCommand={({ command, text }) => {
        if (command === "search") searchSelection(tabId, text);
        else if (command === "copyLinkToHighlight") void copyLinkToSelection(tabId);
      }}
      onPageMessage={(kind, data) => {
        if (kind === "selection") setPageSelection(tabId, data as PageSelection | null);
      }}
      onNotificationClose={closeWebNotification}
      // A PiP window's "back to tab" button.
      // Asleep (lib/tabLifecycle, or Chrome discarded it): it reloads its page when shown (onReady).
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
