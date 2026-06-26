import { useEffect, useRef } from "react";
import {
  BookmarksInternalPage,
  HistoryInternalPage,
  ExtensionsInternalPage,
  KeybindsInternalPage,
  NewTabInternalPage,
} from "@/components/internal-pages";
import { FindBar } from "@/components/find-bar";
import { WEBVIEW_PARTITION } from "../../../shared/extensions";
import { useBrowser, type BrowserTab } from "@/hooks/use-browser";
import { getInternalPage, isInternalPageUrl } from "@/lib/internal-pages";
import { cn } from "@/lib/utils";
import type { WebviewTag } from "@/types/webview";

const chromeCompatibleUserAgent = navigator.userAgent
  .replace(/\sElectron\/\S+/g, "")
  .replace(/\snetnyahoo\/\S+/g, "");

function WebviewTab({ tab, visible }: { tab: BrowserTab; visible: boolean }) {
  const {
    registerWebview,
    setNav,
    patchTab,
    recordVisit,
    updateHistoryFavicon,
  } = useBrowser();
  const ref = useRef<WebviewTag | null>(null);
  // Capture the initial URL once; further navigation goes through loadURL so
  // React never re-navigates the webview out from under the user.
  const initialUrl = useRef(tab.url).current;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerWebview(tab.id, el);

    const syncNav = () =>
      setNav(tab.id, {
        canGoBack: el.canGoBack(),
        canGoForward: el.canGoForward(),
      });

    const onTitle = (e: Event) => {
      const title = (e as unknown as { title: string }).title;
      patchTab(tab.id, { title });
    };
    const onFavicon = (e: Event) => {
      const favicons = (e as unknown as { favicons: string[] }).favicons;
      const favicon = favicons?.[0];
      if (!favicon) return;
      const url = el.getURL();
      patchTab(tab.id, { favicon });
      updateHistoryFavicon({ url, favicon });
    };
    const onNavigate = (e: Event) => {
      const url = (e as unknown as { url: string }).url;
      // The empty guest a fresh tab boots into isn't a real visit.
      if (url === "about:blank") return;
      patchTab(tab.id, { url });
      recordVisit({ url, title: el.getTitle() });
      syncNav();
    };
    const onInPage = (e: Event) => {
      const url = (e as unknown as { url: string }).url;
      patchTab(tab.id, { url });
      syncNav();
    };
    const onStart = () => setNav(tab.id, { loading: true });
    const onStop = () => {
      setNav(tab.id, { loading: false });
      syncNav();
    };

    el.addEventListener("page-title-updated", onTitle);
    el.addEventListener("page-favicon-updated", onFavicon);
    el.addEventListener("did-navigate", onNavigate);
    el.addEventListener("did-navigate-in-page", onInPage);
    el.addEventListener("did-start-loading", onStart);
    el.addEventListener("did-stop-loading", onStop);

    return () => {
      el.removeEventListener("page-title-updated", onTitle);
      el.removeEventListener("page-favicon-updated", onFavicon);
      el.removeEventListener("did-navigate", onNavigate);
      el.removeEventListener("did-navigate-in-page", onInPage);
      el.removeEventListener("did-start-loading", onStart);
      el.removeEventListener("did-stop-loading", onStop);
      registerWebview(tab.id, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  return (
    <div
      className={cn(
        "absolute inset-0 overflow-hidden",
        visible ? "block" : "hidden",
      )}
    >
      <webview
        ref={ref as never}
        src={initialUrl}
        partition={WEBVIEW_PARTITION}
        allowpopups={true}
        useragent={chromeCompatibleUserAgent}
        className="browser-frame-webview h-full w-full"
      />
    </div>
  );
}

export function BrowserArea() {
  const { tabs, activeTab, newTabAnimationId, finishNewTabAnimation } =
    useBrowser();
  const activeInternalPage = getInternalPage(activeTab?.url);
  // A blank tab is the React new-tab page, an internal URL is its own page —
  // neither shows a webview. Keeping the outgoing tab's webview visible here is
  // what made the new-tab launcher frost the *previous* page during its intro,
  // then pop to its real background once the animation hid that webview.
  const visibleWebviewId =
    activeInternalPage || activeTab?.url === "about:blank"
      ? undefined
      : activeTab?.id;

  return (
    <div className="browser-frame relative h-full w-full overflow-hidden">
      <div className="absolute inset-0 overflow-hidden rounded-[inherit] [contain:paint] [isolation:isolate]">
        {tabs
          // Blank tabs are rendered by the React new-tab page. Creating a hidden
          // <webview src="about:blank"> for each one makes Cmd+T feel sticky.
          .filter((tab) => tab.url !== "about:blank" && !isInternalPageUrl(tab.url))
          .map((tab) => (
            <WebviewTab
              key={tab.id}
              tab={tab}
              visible={tab.id === visibleWebviewId}
            />
          ))}
        {activeTab && activeTab.url === "about:blank" && (
          <NewTabInternalPage
            key={activeTab.id}
            tabId={activeTab.id}
            reveal={activeTab.id === newTabAnimationId}
            onRevealComplete={() => finishNewTabAnimation(activeTab.id)}
          />
        )}
        {activeInternalPage === "history" && <HistoryInternalPage />}
        {activeInternalPage === "bookmarks" && <BookmarksInternalPage />}
        {activeInternalPage === "extensions" && <ExtensionsInternalPage />}
        {activeInternalPage === "keybinds" && <KeybindsInternalPage />}
        <FindBar />
      </div>
      <div aria-hidden className="browser-frame-border" />
    </div>
  );
}
