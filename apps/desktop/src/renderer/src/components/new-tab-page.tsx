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
import logoAi from "@/assets/logo-ai.png";
import { Button } from "@/components/ui/button";
import {
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { WebglGlow } from "@/components/webgl-glow";
import { useNewTabInputMotion } from "@/hooks/motion";
import { useBrowser } from "@/hooks/use-browser";
import {
  getInternalPage,
  getInternalPageTitle,
  getInternalPageUrlForInput,
  isInternalPageUrl,
} from "@/lib/internal-pages";
import { useTRPC } from "@/lib/trpc";
import { cn, prettyUrl } from "@/lib/utils";

// cmdk's Command forwards its ref to a <div>, so Motion can drive it directly.
const MotionCommand = motion.create(CommandPrimitive);
const revealTransition = { duration: 0.24, ease: [0.22, 1, 0.36, 1] } as const;
const cardRevealMotion = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  transition: revealTransition,
};

interface NewTabPageProps {
  tabId: string;
  slideOver: boolean;
  reveal: boolean;
  onSlideComplete: () => void;
}

interface Suggestion {
  id: string;
  icon: ReactNode;
  label: string;
  detail?: string;
  shortcut?: string;
  action: () => void;
}

export function NewTabPage({
  tabId,
  slideOver,
  reveal,
  onSlideComplete,
}: NewTabPageProps) {
  const trpc = useTRPC();
  const { navigate, openTab, newTabDrafts, setNewTabDraft } = useBrowser();
  // Draft lives in the browser store so it survives this page unmounting on tab switch.
  const query = newTabDrafts[tabId] ?? "";
  const setQuery = (value: string) => setNewTabDraft(tabId, value);
  const [listening, setListening] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputMotion = useNewTabInputMotion(slideOver);
  const commandMotion = slideOver ? inputMotion : reveal ? cardRevealMotion : null;
  const CommandCard = commandMotion ? MotionCommand : CommandPrimitive;
  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;
  const showSuggestions = hasQuery && !listening;
  const finishIntro = () => {
    if (slideOver || reveal) onSlideComplete();
  };

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
    <div className="new-tab-page absolute inset-0 z-20 overflow-hidden bg-[var(--new-tab-scrim)] px-6 backdrop-blur-[22px] backdrop-saturate-[1.08] dark:backdrop-blur-[30px]">
      <WebglGlow variant="new-tab" tabId={tabId} playIntro={reveal} />
      {/* Anchor by half the *compact* card height (~57px) so suggestions grow downward without shoving the input box up. */}
      <div className="new-tab-launcher absolute top-1/2 left-1/2 z-[1] flex w-[clamp(32rem,44vw,43.25rem)] -translate-x-1/2 -translate-y-[57px] flex-col items-center">
        <div
          aria-hidden
          className="new-tab-emblem-shell pointer-events-none absolute bottom-full left-1/2 mb-7 size-[4.25rem] -translate-x-1/2"
        >
          <img
            src={logoAi}
            alt=""
            draggable={false}
            className="new-tab-emblem h-full w-full select-none object-contain opacity-[0.42] mix-blend-screen drop-shadow-[0_18px_26px_var(--shadow-deep)] saturate-[0.62] brightness-[0.72]"
          />
        </div>
        <div className="new-tab-command-stack relative isolate w-full">
          <CommandCard
            {...(commandMotion ?? {})}
            onAnimationComplete={commandMotion ? finishIntro : undefined}
            shouldFilter={false}
            className="new-tab-command-card text-popover-foreground relative z-10 flex w-full flex-col overflow-hidden rounded-[1.35rem] border border-[color-mix(in_oklch,var(--foreground)_8%,transparent)] bg-[var(--new-tab-card-surface)] shadow-[inset_0_1px_0_color-mix(in_oklch,white_20%,transparent)] backdrop-blur-[24px] backdrop-saturate-[1.08] will-change-transform dark:border-[color-mix(in_oklch,white_7%,transparent)] dark:shadow-[inset_0_1px_0_color-mix(in_oklch,white_4%,transparent)] dark:backdrop-blur-[26px] dark:backdrop-saturate-[1.06]"
          >
            <div className="new-tab-command-input-row flex min-h-[3.3rem] items-center gap-3.5 px-5 pt-4 pb-2 text-foreground">
              <Search className="text-muted-foreground size-5 shrink-0" />
              {listening ? (
                <span className="text-muted-foreground flex-1 text-base">
                  Listening...
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
                  placeholder="Ask anything..."
                  aria-label="Search or enter a URL"
                  className="placeholder:text-muted-foreground flex-1 bg-transparent text-[1.05rem] font-medium outline-none"
                />
              )}
            </div>

            {showSuggestions && suggestions.length > 0 && (
              <CommandList className="max-h-72 px-2 pb-1">
                <CommandGroup className="p-0">
                  {suggestions.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={s.id}
                      onSelect={s.action}
                      className="new-tab-suggestion-row group min-h-10 min-w-0 gap-3 overflow-hidden rounded-md px-3 py-2 text-sm text-[color-mix(in_oklch,var(--foreground)_92%,transparent)] data-[selected=true]:bg-[color-mix(in_oklch,var(--primary)_22%,var(--muted)_78%)] data-[selected=true]:text-foreground dark:data-[selected=true]:bg-[color-mix(in_oklch,var(--primary)_24%,var(--muted)_58%)]"
                    >
                      <span className="text-muted-foreground shrink-0">{s.icon}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{s.label}</span>
                        {s.detail && (
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            - {s.detail}
                          </span>
                        )}
                      </span>
                      {s.shortcut && (
                        <CommandShortcut className="text-sm text-[color-mix(in_oklch,var(--muted-foreground)_82%,transparent)] normal-case tracking-normal group-data-[selected=true]:text-[color-mix(in_oklch,var(--foreground)_42%,transparent)]">
                          {s.shortcut}
                        </CommandShortcut>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            )}

            <div className="new-tab-command-footer flex min-h-12 items-center gap-2 px-5 pt-1 pb-4">
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
                    className="new-tab-add-button h-8 rounded-full border border-[color-mix(in_oklch,var(--foreground)_10%,transparent)] bg-[color-mix(in_oklch,var(--secondary)_52%,transparent)] px-3.5 text-sm text-[color-mix(in_oklch,var(--secondary-foreground)_84%,transparent)] hover:bg-[color-mix(in_oklch,var(--secondary)_68%,var(--foreground)_3%)]"
                    onClick={() => inputRef.current?.focus()}
                  >
                    <Plus />
                    Add tabs or files
                  </Button>
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 rounded-full text-muted-foreground"
                      aria-label="Start voice input"
                      onClick={() => setListening(true)}
                    >
                      <Mic />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      // Pill when the label shows, plain circle when it's just the arrow — so the bg never gets clipped.
                      className={cn(
                        "new-tab-send-button h-10 rounded-full bg-[color-mix(in_oklch,var(--secondary)_68%,transparent)] text-sm font-semibold text-secondary-foreground shadow-none enabled:bg-[color-mix(in_oklch,var(--primary)_92%,var(--foreground)_18%)] enabled:text-primary-foreground enabled:shadow-none dark:enabled:bg-primary",
                        hasQuery ? "gap-1.5 px-4" : "w-10 p-0",
                      )}
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
          </CommandCard>
        </div>
      </div>
    </div>
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
