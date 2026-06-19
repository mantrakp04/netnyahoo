import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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
import { useBrowser } from "@/hooks/use-browser";
import { useTRPC } from "@/lib/trpc";
import { cn, prettyUrl } from "@/lib/utils";
import type { PaletteMode } from "@/components/command-palette";
import type { Tab } from "@netnyahoo/db";
import type { WebviewTag } from "@/types/webview";

function WebviewTab({ tab, active }: { tab: Tab; active: boolean }) {
  const { registerWebview, setNav, patchTab, recordVisit } = useBrowser();
  const ref = useRef<WebviewTag | null>(null);
  // Capture the initial URL once; further navigation goes through loadURL so
  // React never re-navigates the webview out from under the user.
  const initialUrl = useRef(tab.url === "about:blank" ? "" : tab.url).current;

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
      if (favicons?.[0]) patchTab(tab.id, { favicon: favicons[0] });
    };
    const onNavigate = (e: Event) => {
      const url = (e as unknown as { url: string }).url;
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
    // @ts-expect-error -- webview is an Electron custom element
    <webview
      ref={ref as never}
      src={initialUrl || undefined}
      partition="persist:netnyahoo"
      allowpopups="true"
      className={cn("h-full w-full", active ? "flex" : "hidden")}
    />
  );
}

export function BrowserArea({
  onOpenPalette,
}: {
  onOpenPalette: (mode: PaletteMode) => void;
}) {
  const { tabs, activeTab } = useBrowser();

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border shadow-sm">
      {tabs.map((tab) => (
        <WebviewTab key={tab.id} tab={tab} active={tab.id === activeTab?.id} />
      ))}
      {tabs.length === 0 && <EmptyState />}
      <AnimatePresence mode="popLayout">
        {activeTab && activeTab.url === "about:blank" && (
          <NewTabState key={activeTab.id} onOpenPalette={onOpenPalette} />
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
      <Globe className="size-10 opacity-40" />
      <p className="text-sm">No tabs open</p>
      <p className="text-xs opacity-60">Press ⌘T to open a new tab</p>
    </div>
  );
}

/**
 * Dia-style new-tab surface: one persistent command object that breathes at
 * rest, expands in place for suggestions, and morphs into the voice state.
 */
function NewTabState({
  onOpenPalette,
}: {
  onOpenPalette: (mode: PaletteMode) => void;
}) {
  const trpc = useTRPC();
  const { navigate, openTab } = useBrowser();
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [listening, setListening] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [panelState, setPanelState] = useState<"closed" | "open" | "closing">(
    "closed",
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const suggestionsOpen = hasQuery && !listening;

  const historyQuery = useQuery(
    trpc.history.list.queryOptions(
      { search: trimmedQuery, limit: 5 },
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

    const interval = window.setInterval(() => {
      setElapsed((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [listening]);

  useEffect(() => {
    if (suggestionsOpen) {
      setPanelState("open");
      return;
    }

    setPanelState((state) => (state === "open" ? "closing" : state));
  }, [suggestionsOpen]);

  useEffect(() => {
    if (panelState !== "closing") return;

    const rootStyles = window.getComputedStyle(document.documentElement);
    const closeMs =
      Number.parseFloat(rootStyles.getPropertyValue("--dropdown-close-dur")) ||
      150;
    const timeout = window.setTimeout(() => setPanelState("closed"), closeMs);

    return () => window.clearTimeout(timeout);
  }, [panelState]);

  const submit = (value = trimmedQuery) => {
    const next = value.trim();
    if (!next) return;
    setListening(false);
    navigate(next);
  };

  const suggestions = useMemo<NewTabSuggestion[]>(() => {
    if (!hasQuery) return [];

    const isUrlLike = trimmedQuery.includes(".") && !trimmedQuery.includes(" ");
    const primary: NewTabSuggestion[] = [
      {
        id: "current-tab",
        icon: isUrlLike ? (
          <Globe className="size-4" />
        ) : (
          <Search className="size-4" />
        ),
        label: trimmedQuery,
        detail: isUrlLike ? "Open address" : "Google",
        shortcut: "↩",
        action: () => submit(trimmedQuery),
      },
      {
        id: "new-tab",
        icon: <MessageCircle className="size-4" />,
        label: trimmedQuery,
        detail: "New tab",
        shortcut: "⇧↩",
        action: () => openTab(trimmedQuery),
      },
    ];

    const history = (historyQuery.data ?? [])
      .filter((entry) => entry.url !== "about:blank")
      .slice(0, 3)
      .map<NewTabSuggestion>((entry) => ({
        id: `history-${entry.id}`,
        icon: <History className="size-4" />,
        label: entry.title || entry.url,
        detail: prettyUrl(entry.url),
        action: () => submit(entry.url),
      }));

    const bookmarks = (bookmarksQuery.data ?? [])
      .filter((bookmark) =>
        `${bookmark.title} ${bookmark.url}`
          .toLowerCase()
          .includes(trimmedQuery.toLowerCase()),
      )
      .slice(0, Math.max(0, 5 - history.length))
      .map<NewTabSuggestion>((bookmark) => ({
        id: `bookmark-${bookmark.id}`,
        icon: <Bookmark className="size-4" />,
        label: bookmark.title || bookmark.url,
        detail: prettyUrl(bookmark.url),
        action: () => submit(bookmark.url),
      }));

    const fallbackSearches = isUrlLike
      ? []
      : ["near me", "today", "this week", "reddit"].map<NewTabSuggestion>(
          (suffix, index) => ({
            id: `search-${index}`,
            icon: <Search className="size-4" />,
            label: `${trimmedQuery} ${suffix}`,
            action: () => submit(`${trimmedQuery} ${suffix}`),
          }),
        );

    return [...primary, ...history, ...bookmarks, ...fallbackSearches].slice(
      0,
      6,
    );
  }, [
    bookmarksQuery.data,
    hasQuery,
    historyQuery.data,
    openTab,
    trimmedQuery,
  ]);

  const panelClassName =
    panelState === "open"
      ? "is-open"
      : panelState === "closing"
        ? "is-closing"
        : "";
  const diaEase = [0.22, 1, 0.36, 1] as const;

  const surfaceMotion = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.16 },
      }
    : {
        initial: { opacity: 0, scale: 0.998, y: 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.998, y: -3 },
        transition: {
          duration: 0.2,
          ease: diaEase,
        },
      };

  const markMotion = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.18 },
      }
    : {
        initial: { opacity: 0, scale: 0.992, y: 5 },
        animate: { opacity: 1, scale: 1, y: 0 },
        transition: {
          duration: 0.24,
          ease: diaEase,
          delay: 0.015,
        },
      };

  return (
    <motion.div
      className="new-tab-canvas absolute inset-0 flex flex-col items-center justify-center px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0.12 : 0.16, ease: diaEase }}
    >
      <div className="new-tab-ambient" aria-hidden />
      <motion.div className="new-tab-stack" {...surfaceMotion}>
        <motion.div
          className="new-tab-mark-shell"
          aria-hidden
          {...markMotion}
        >
          <div className="new-tab-mark" />
        </motion.div>
        <form
          className={cn(
            "new-tab-command t-resize",
            suggestionsOpen && "is-expanded",
            listening && "is-listening",
          )}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="new-tab-query-row">
            <Search className="new-tab-search-icon size-5" />
            {listening ? (
              <span className="new-tab-listening-label">Listening...</span>
            ) : (
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    if (query) {
                      event.preventDefault();
                      setQuery("");
                    }
                    return;
                  }

                  if (event.key === "Enter" && event.shiftKey && hasQuery) {
                    event.preventDefault();
                    openTab(trimmedQuery);
                  }
                }}
                placeholder="Ask anything..."
                aria-label="Search or enter a URL"
                className="new-tab-input"
              />
            )}
          </div>

          <div
            className={cn("new-tab-suggestions t-dropdown", panelClassName)}
            data-origin="top-center"
            role="listbox"
            aria-hidden={!suggestionsOpen}
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                className={cn(
                  "new-tab-suggestion",
                  index === 0 && "is-selected",
                )}
                onClick={suggestion.action}
              >
                <span className="new-tab-suggestion-icon">
                  {suggestion.icon}
                </span>
                <span className="new-tab-suggestion-label">
                  {suggestion.label}
                </span>
                <span className="new-tab-suggestion-detail">
                  {suggestion.detail}
                </span>
                {suggestion.shortcut && (
                  <kbd className="new-tab-suggestion-shortcut">
                    {suggestion.shortcut}
                  </kbd>
                )}
              </button>
            ))}
          </div>

          <div className="new-tab-footer">
            {listening ? (
              <VoiceMeter
                elapsed={elapsed}
                onCancel={() => setListening(false)}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="new-tab-context-button"
                  onClick={() => onOpenPalette("new-tab")}
                >
                  <Plus className="size-3.5" />
                  Add tabs or files
                </button>
                <div className="new-tab-action-group">
                  <button
                    type="button"
                    className="new-tab-icon-button"
                    onClick={() => setListening(true)}
                    aria-label="Start voice input"
                  >
                    <span className="t-icon-swap" data-state="a">
                      <span className="t-icon" data-icon="a">
                        <Mic className="size-4" />
                      </span>
                      <span className="t-icon" data-icon="b">
                        <X className="size-4" />
                      </span>
                    </span>
                  </button>
                  <button
                    type="submit"
                    className={cn(
                      "new-tab-submit",
                      hasQuery && "has-query",
                    )}
                    disabled={!hasQuery}
                  >
                    {hasQuery && <span>Google</span>}
                    <ArrowUp className="size-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

interface NewTabSuggestion {
  id: string;
  icon: ReactNode;
  label: string;
  detail?: string;
  shortcut?: string;
  action: () => void;
}

function VoiceMeter({
  elapsed,
  onCancel,
}: {
  elapsed: number;
  onCancel: () => void;
}) {
  const seconds = String(elapsed % 60).padStart(2, "0");
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");

  return (
    <>
      <button
        type="button"
        className="new-tab-icon-button is-cancel"
        onClick={onCancel}
        aria-label="Cancel voice input"
      >
        <X className="size-4" />
      </button>
      <div className="new-tab-waveform" aria-hidden>
        {Array.from({ length: 28 }).map((_, index) => (
          <span key={index} style={{ "--bar-index": index } as CSSProperties} />
        ))}
      </div>
      <span className="new-tab-timer">
        {minutes}:{seconds}
      </span>
      <span className="new-tab-record-dot" aria-hidden />
      <button
        type="button"
        className="new-tab-submit has-query"
        onClick={onCancel}
        aria-label="Stop voice input"
      >
        <ArrowUp className="size-4" />
      </button>
    </>
  );
}
