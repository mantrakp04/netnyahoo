import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bookmark, Globe, History, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useBrowser } from "@/hooks/use-browser";
import {
  getInternalPage,
  getInternalPageTitle,
  getInternalPageUrlForInput,
  isInternalPageUrl,
} from "@/lib/internal-pages";
import { useTRPC } from "@/lib/trpc";
import { cn, prettyUrl } from "@/lib/utils";

export interface OmniboxHandle {
  focus: () => void;
}

interface OmniItem {
  id: string;
  icon: ReactNode;
  label: string;
  detail?: string;
  action: () => void;
}

/**
 * The sidebar URL bar. Focusing it opens an inline dropdown of suggestions
 * anchored right below the field — no centered dialog.
 */
export const Omnibox = forwardRef<OmniboxHandle>(function Omnibox(_props, ref) {
  const trpc = useTRPC();
  const { navigate, openTab, activeTab } = useBrowser();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blurTimer = useRef<number | null>(null);

  const trimmed = query.trim();
  const currentUrl =
    activeTab && activeTab.url !== "about:blank" ? activeTab.url : "";
  const currentInternalPage = getInternalPage(currentUrl);
  // Show the live page URL when idle; the editable query while focused.
  const value = focused
    ? query
    : currentInternalPage
      ? getInternalPageTitle(currentInternalPage)
      : currentUrl
        ? prettyUrl(currentUrl)
        : "";

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  useEffect(
    () => () => {
      if (blurTimer.current) window.clearTimeout(blurTimer.current);
    },
    [],
  );

  const historyQuery = useQuery(
    trpc.history.list.queryOptions(
      { search: trimmed, limit: 6 },
      { enabled: open },
    ),
  );
  const bookmarksQuery = useQuery(
    trpc.bookmarks.list.queryOptions(undefined, { enabled: open }),
  );

  const go = (input: string) => {
    if (!input.trim()) return;
    navigate(input);
    close();
  };

  const close = () => {
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
  };

  const items = useMemo<OmniItem[]>(() => {
    const list: OmniItem[] = [];

    if (trimmed) {
      const isUrlLike = trimmed.includes(".") && !trimmed.includes(" ");
      const internalPageUrl = getInternalPageUrlForInput(trimmed);
      const internalPage = getInternalPage(internalPageUrl);
      list.push({
        id: "go",
        icon: internalPage ? (
          internalPage === "history" ? (
            <History className="size-3.5" />
          ) : (
            <Bookmark className="size-3.5" />
          )
        ) : isUrlLike ? (
          <Globe className="size-3.5" />
        ) : (
          <Search className="size-3.5" />
        ),
        label: internalPage ? getInternalPageTitle(internalPage) : trimmed,
        detail: internalPage ? "Open page" : isUrlLike ? "Open" : "Search",
        action: () => go(trimmed),
      });
    }

    const history = (historyQuery.data ?? [])
      .filter((h) => h.url !== "about:blank" && !isInternalPageUrl(h.url))
      .slice(0, 4)
      .map<OmniItem>((h) => ({
        id: `history-${h.id}`,
        icon: h.favicon ? (
          <img src={h.favicon} alt="" className="size-3.5 rounded-sm" />
        ) : (
          <History className="size-3.5" />
        ),
        label: h.title || h.url,
        detail: prettyUrl(h.url),
        action: () => go(h.url),
      }));

    const bookmarks = (bookmarksQuery.data ?? [])
      .filter((b) =>
        !isInternalPageUrl(b.url) && trimmed
          ? `${b.title} ${b.url}`.toLowerCase().includes(trimmed.toLowerCase())
          : !isInternalPageUrl(b.url),
      )
      .slice(0, Math.max(0, 4 - history.length))
      .map<OmniItem>((b) => ({
        id: `bookmark-${b.id}`,
        icon: <Bookmark className="size-3.5" />,
        label: b.title || b.url,
        detail: prettyUrl(b.url),
        action: () => go(b.url),
      }));

    return [...list, ...history, ...bookmarks];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarksQuery.data, historyQuery.data, trimmed]);

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length, query]);

  const showDropdown = open && items.length > 0;

  return (
    <div className="relative">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
      <Input
        ref={inputRef}
        value={value}
        spellCheck={false}
        placeholder="Search or Enter URL…"
        aria-label="Search or enter a URL"
        className="h-7 pr-1.5 pl-7 text-xs"
        onFocus={(e) => {
          if (blurTimer.current) window.clearTimeout(blurTimer.current);
          setFocused(true);
          setOpen(true);
          setQuery(currentUrl);
          // Select all so typing replaces the shown URL, like a real omnibox.
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => {
          // Defer so a mousedown on a suggestion still registers its click.
          blurTimer.current = window.setTimeout(() => {
            setFocused(false);
            setOpen(false);
          }, 120);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
            return;
          }
          if (e.key === "ArrowDown" && showDropdown) {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % items.length);
            return;
          }
          if (e.key === "ArrowUp" && showDropdown) {
            e.preventDefault();
            setActiveIndex((i) => (i - 1 + items.length) % items.length);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey && trimmed) {
              openTab(trimmed);
              close();
              return;
            }
            const item = showDropdown ? items[activeIndex] : undefined;
            if (item) item.action();
            else go(query);
          }
        }}
      />

      {showDropdown && (
        <div
          className="bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 absolute top-[calc(100%+3px)] right-0 left-0 z-50 origin-top rounded-md border p-0.5 shadow-md duration-150"
          role="listbox"
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              // Keep focus in the input so the dropdown doesn't blur shut first.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={item.action}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-left text-xs transition-colors",
                index === activeIndex
                  ? "bg-muted text-foreground"
                  : "text-foreground/80",
              )}
            >
              <span className="text-muted-foreground shrink-0">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.detail && (
                <span className="text-muted-foreground max-w-[45%] min-w-0 shrink truncate text-xs font-medium">
                  {item.detail}
                </span>
              )}
              {item.id === "go" && (
                <ArrowRight className="text-muted-foreground size-3 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
