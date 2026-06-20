import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Command as CommandPrimitive } from "cmdk";
import { motion } from "motion/react";
import {
  ArrowUp,
  Bookmark,
  Globe,
  History,
  MessageCircle,
  Mic,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  BookmarksInternalPage,
  HistoryInternalPage,
} from "@/components/internal-pages";
import { useNewTabCardMotion, useNewTabPageMotion } from "@/hooks/motion";
import { useBrowser, type BrowserTab } from "@/hooks/use-browser";
import {
  getInternalPage,
  getInternalPageTitle,
  getInternalPageUrlForInput,
  isInternalPageUrl,
} from "@/lib/internal-pages";
import { useTRPC } from "@/lib/trpc";
import { cn, prettyUrl } from "@/lib/utils";
import type { WebviewTag } from "@/types/webview";

// cmdk's Command forwards its ref to a <div>, so Motion can drive it directly.
const MotionCommand = motion.create(CommandPrimitive);

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
        partition="persist:netnyahoo"
        allowpopups={true}
        className="h-full w-full"
      />
    </div>
  );
}

export function BrowserArea() {
  const { tabs, activeTab, newTabAnimationId, finishNewTabAnimation } =
    useBrowser();
  const previousActiveId = useRef<string | undefined>(activeTab?.id);
  const [slideOver, setSlideOver] = useState<{
    incomingId: string;
    outgoingId: string;
  } | null>(null);

  useEffect(() => {
    const nextActiveId = activeTab?.id;
    const outgoingId = previousActiveId.current;

    if (nextActiveId === outgoingId) return;

    const shouldSlideOver =
      !!nextActiveId &&
      !!outgoingId &&
      nextActiveId === newTabAnimationId &&
      activeTab?.url === "about:blank";

    setSlideOver(
      shouldSlideOver ? { incomingId: nextActiveId, outgoingId } : null,
    );
    previousActiveId.current = nextActiveId;
  }, [activeTab?.id, activeTab?.url, newTabAnimationId]);

  const activeSlideOver =
    !!activeTab && slideOver?.incomingId === activeTab.id;
  const activeInternalPage = getInternalPage(activeTab?.url);
  const visibleWebviewId =
    activeInternalPage
      ? undefined
      : activeTab?.url === "about:blank"
      ? activeSlideOver
        ? slideOver.outgoingId
        : undefined
      : activeTab?.id;

  return (
    <div className="browser-frame relative h-full w-full overflow-hidden rounded-lg bg-background">
      <div className="absolute inset-0 overflow-hidden rounded-[inherit] [contain:paint] [isolation:isolate] [-webkit-mask-image:-webkit-radial-gradient(white,black)]">
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
          <NewTabState
            key={activeTab.id}
            slideOver={activeSlideOver}
            onSlideComplete={() => {
              setSlideOver((current) =>
                current?.incomingId === activeTab.id ? null : current,
              );
              finishNewTabAnimation(activeTab.id);
            }}
          />
        )}
        {activeInternalPage === "history" && <HistoryInternalPage />}
        {activeInternalPage === "bookmarks" && <BookmarksInternalPage />}
      </div>
      <div
        aria-hidden
        className="browser-frame-corner-mask browser-frame-corner-mask-top-left"
      />
      <div
        aria-hidden
        className="browser-frame-corner-mask browser-frame-corner-mask-top-right"
      />
      <div
        aria-hidden
        className="browser-frame-corner-mask browser-frame-corner-mask-bottom-right"
      />
      <div
        aria-hidden
        className="browser-frame-corner-mask browser-frame-corner-mask-bottom-left"
      />
      <div aria-hidden className="browser-frame-border" />
    </div>
  );
}

interface Suggestion {
  id: string;
  icon: ReactNode;
  label: string;
  detail?: string;
  shortcut?: string;
  action: () => void;
}

/**
 * The new-tab launcher: a single command card, intentionally kept visually
 * plain while the new-tab surface is still being shaped.
 */
function NewTabState({
  slideOver,
  onSlideComplete,
}: {
  slideOver: boolean;
  onSlideComplete: () => void;
}) {
  const trpc = useTRPC();
  const { navigate, openTab } = useBrowser();
  const [query, setQuery] = useState("");
  const [listening, setListening] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pageMotion = useNewTabPageMotion(slideOver);
  const cardMotion = useNewTabCardMotion(!slideOver);
  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;
  const showSuggestions = hasQuery && !listening;

  const historyQuery = useQuery(
    trpc.history.list.queryOptions(
      { search: trimmed, limit: 5 },
      { enabled: hasQuery },
    ),
  );
  const bookmarksQuery = useQuery(
    trpc.bookmarks.list.queryOptions(undefined, { enabled: hasQuery }),
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!listening) {
      setElapsed(0);
      return;
    }
    const id = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [listening]);

  const search = (value = trimmed) => {
    const next = value.trim();
    if (!next) return;
    setListening(false);
    navigate(next);
  };

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!hasQuery) return [];

    const isUrlLike = trimmed.includes(".") && !trimmed.includes(" ");
    const internalPageUrl = getInternalPageUrlForInput(trimmed);
    const internalPage = getInternalPage(internalPageUrl);
    const primary: Suggestion[] = [
      {
        id: "go",
        icon: internalPage ? (
          internalPage === "history" ? (
            <History className="size-4" />
          ) : (
            <Bookmark className="size-4" />
          )
        ) : isUrlLike ? (
          <Globe className="size-4" />
        ) : (
          <Search className="size-4" />
        ),
        label: internalPage ? getInternalPageTitle(internalPage) : trimmed,
        detail: internalPage ? "Open page" : isUrlLike ? "Open address" : "Google",
        shortcut: "↩",
        action: () => navigate(trimmed),
      },
      {
        id: "new-tab",
        icon: <MessageCircle className="size-4" />,
        label: trimmed,
        detail: "New tab",
        shortcut: "⇧↩",
        action: () => openTab(trimmed),
      },
    ];

    const history = (historyQuery.data ?? [])
      .filter(
        (entry) => entry.url !== "about:blank" && !isInternalPageUrl(entry.url),
      )
      .slice(0, 3)
      .map<Suggestion>((entry) => ({
        id: `history-${entry.id}`,
        icon: entry.favicon ? (
          <img src={entry.favicon} alt="" className="size-4 rounded-sm" />
        ) : (
          <History className="size-4" />
        ),
        label: entry.title || entry.url,
        detail: prettyUrl(entry.url),
        action: () => navigate(entry.url),
      }));

    const bookmarks = (bookmarksQuery.data ?? [])
      .filter(
        (bookmark) =>
          !isInternalPageUrl(bookmark.url) &&
          `${bookmark.title} ${bookmark.url}`
            .toLowerCase()
            .includes(trimmed.toLowerCase()),
      )
      .slice(0, Math.max(0, 5 - history.length))
      .map<Suggestion>((bookmark) => ({
        id: `bookmark-${bookmark.id}`,
        icon: <Bookmark className="size-4" />,
        label: bookmark.title || bookmark.url,
        detail: prettyUrl(bookmark.url),
        action: () => navigate(bookmark.url),
      }));

    const fallback = isUrlLike
      ? []
      : ["near me", "today", "this week", "reddit"].map<Suggestion>(
          (suffix, index) => ({
            id: `search-${index}`,
            icon: <Search className="size-3.5" />,
            label: `${trimmed} ${suffix}`,
            action: () => navigate(`${trimmed} ${suffix}`),
          }),
        );

    return [...primary, ...history, ...bookmarks, ...fallback].slice(0, 6);
  }, [bookmarksQuery.data, hasQuery, historyQuery.data, navigate, openTab, trimmed]);

  return (
    <motion.div
      {...pageMotion}
      onAnimationComplete={onSlideComplete}
      className="new-tab-page absolute inset-0 z-20 flex items-center justify-center overflow-hidden px-6 pb-12 will-change-transform"
    >
      <div className="relative z-[1] w-full max-w-xl">
        <MotionCommand
          {...cardMotion}
          shouldFilter={false}
          className="new-tab-command-card bg-popover text-popover-foreground relative z-10 flex flex-col overflow-hidden rounded-2xl"
        >
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <Search className="text-muted-foreground size-4 shrink-0" />
            {listening ? (
              <span className="text-muted-foreground flex-1 text-base">
                Listening…
              </span>
            ) : (
              <CommandPrimitive.Input
                ref={inputRef}
                value={query}
                onValueChange={setQuery}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.preventDefault();
                    setQuery("");
                    return;
                  }
                  if (e.key === "Enter" && e.shiftKey && hasQuery) {
                    e.preventDefault();
                    openTab(trimmed);
                  }
                }}
                placeholder="Ask anything…"
                aria-label="Search or enter a URL"
                className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
              />
            )}
          </div>

          {showSuggestions && suggestions.length > 0 && (
            <CommandList className="border-border/60 max-h-72 border-t p-1">
              <CommandGroup className="p-0">
                {suggestions.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={s.id}
                    onSelect={s.action}
                    className="min-w-0 gap-2 overflow-hidden rounded-md px-2 py-1.5 text-xs"
                  >
                    <span className="text-muted-foreground shrink-0">{s.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    {s.detail && (
                      <span className="text-muted-foreground max-w-[42%] min-w-0 shrink truncate text-xs font-medium">
                        {s.detail}
                      </span>
                    )}
                    {s.shortcut && (
                      <CommandShortcut>{s.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          )}

          <div className="border-border/60 flex items-center gap-2 border-t px-2.5 py-2">
            {listening ? (
              <ListeningBar
                elapsed={elapsed}
                onStop={() => setListening(false)}
              />
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() => inputRef.current?.focus()}
                >
                  <Plus />
                  Add tabs or files
                </Button>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                    aria-label="Start voice input"
                    onClick={() => setListening(true)}
                  >
                    <Mic />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="new-tab-send-button rounded-full"
                    disabled={!hasQuery}
                    onClick={() => search()}
                  >
                    {hasQuery && <span>Google</span>}
                    <ArrowUp />
                  </Button>
                </div>
              </>
            )}
          </div>
        </MotionCommand>
      </div>
    </motion.div>
  );
}

function ListeningBar({
  elapsed,
  onStop,
}: {
  elapsed: number;
  onStop: () => void;
}) {
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");

  return (
    <>
      <span
        className="bg-destructive size-2 shrink-0 animate-pulse rounded-full"
        aria-hidden
      />
      <div className="flex flex-1 items-center gap-0.5 overflow-hidden" aria-hidden>
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="bg-muted-foreground/50 w-0.5 shrink-0 animate-pulse rounded-full"
            style={{ height: `${6 + (i % 5) * 3}px`, animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {minutes}:{seconds}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="rounded-full"
        aria-label="Stop voice input"
        onClick={onStop}
      >
        <X />
      </Button>
    </>
  );
}
