import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrowser } from "@/hooks/use-browser";
import { cn } from "@/lib/utils";
import type { FoundInPageResult } from "@/types/webview";

/**
 * Chrome-style find-in-page bar. Mounts over the top-right of the browser area
 * while open, drives the active webview's findInPage/stopFindInPage, and reads
 * match counts off its `found-in-page` event. Cmd/Ctrl+F opens it, Cmd/Ctrl+G
 * and Shift+Cmd/Ctrl+G step through matches, Esc closes it.
 */
export function FindBar() {
  const {
    findBarOpen,
    findQuery,
    find,
    findNext,
    findPrevious,
    closeFindBar,
    getActiveWebview,
  } = useBrowser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [matches, setMatches] = useState<{ active: number; total: number } | null>(
    null,
  );

  // Mirror match counts from the active webview's find results.
  useEffect(() => {
    if (!findBarOpen) return;
    const el = getActiveWebview();
    if (!el) return;
    const onFound = (event: Event) => {
      const { activeMatchOrdinal, matches } = (
        event as unknown as { result: FoundInPageResult }
      ).result;
      setMatches({ active: activeMatchOrdinal, total: matches });
    };
    el.addEventListener("found-in-page", onFound);
    return () => el.removeEventListener("found-in-page", onFound);
  }, [findBarOpen, getActiveWebview]);

  // Focus the input on open so the user can type immediately, and drop any
  // stale match count when the bar closes.
  useEffect(() => {
    if (!findBarOpen) {
      setMatches(null);
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [findBarOpen]);

  if (!findBarOpen) return null;

  const hasQuery = findQuery.length > 0;
  const matchLabel = !hasQuery
    ? ""
    : matches
      ? `${matches.total === 0 ? 0 : matches.active}/${matches.total}`
      : "0/0";

  return (
    <div className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-md backdrop-blur-sm">
      <input
        ref={inputRef}
        value={findQuery}
        onChange={(event) => {
          const text = event.target.value;
          find(text);
          if (!text) setMatches(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) findPrevious();
            else findNext();
          } else if (event.key === "Escape") {
            event.preventDefault();
            closeFindBar();
          }
        }}
        placeholder="Find in page"
        aria-label="Find in page"
        className="h-6 w-44 min-w-0 rounded-md border-0 bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground"
      />
      <span
        className={cn(
          "min-w-10 px-1 text-right text-[0.625rem] tabular-nums",
          matches && matches.total === 0
            ? "text-destructive"
            : "text-muted-foreground",
        )}
      >
        {matchLabel}
      </span>
      <div className="bg-border h-4 w-px" aria-hidden />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous match"
        disabled={!hasQuery}
        onClick={findPrevious}
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next match"
        disabled={!hasQuery}
        onClick={findNext}
      >
        <ChevronDown />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close find bar"
        onClick={closeFindBar}
      >
        <X />
      </Button>
    </div>
  );
}
