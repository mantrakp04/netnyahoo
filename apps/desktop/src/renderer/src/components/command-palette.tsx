import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bookmark, Globe, History, Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useBrowser } from "@/hooks/use-browser";
import { useTRPC } from "@/lib/trpc";
import { prettyUrl } from "@/lib/utils";

export type PaletteMode = "navigate" | "new-tab";

export function CommandPalette({
  open,
  onOpenChange,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PaletteMode;
}) {
  const trpc = useTRPC();
  const { navigate, openTab, activeTab } = useBrowser();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery(mode === "navigate" ? (activeTab?.url ?? "") : "");
  }, [open, mode, activeTab?.url]);

  const historyQuery = useQuery(
    trpc.history.list.queryOptions(
      { search: query, limit: 6 },
      { enabled: open && query.length > 0 },
    ),
  );
  const bookmarksQuery = useQuery(
    trpc.bookmarks.list.queryOptions(undefined, { enabled: open }),
  );

  const suggestions = (historyQuery.data ?? []).filter(
    (h) => h.url !== "about:blank",
  );
  const bookmarks = (bookmarksQuery.data ?? []).filter((b) =>
    query
      ? `${b.title} ${b.url}`.toLowerCase().includes(query.toLowerCase())
      : true,
  );

  const go = (value: string) => {
    if (!value.trim()) return;
    if (mode === "navigate") navigate(value);
    else openTab(value);
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      className="top-[28%] translate-y-0"
      showCloseButton={false}
    >
      <CommandInput
        placeholder="Search or Enter URL…"
        value={query}
        onValueChange={setQuery}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.defaultPrevented) {
            // Enter on the raw query (cmdk handles Enter on highlighted items).
            const active = document.querySelector('[cmdk-item][data-selected="true"]');
            if (!active) {
              e.preventDefault();
              go(query);
            }
          }
        }}
      />
      <CommandList>
        <CommandEmpty>Type a URL or search term.</CommandEmpty>
        {query.trim() && (
          <CommandGroup heading="Go">
            <CommandItem value={`__raw__${query}`} onSelect={() => go(query)}>
              {query.includes(".") && !query.includes(" ") ? (
                <Globe className="text-muted-foreground" />
              ) : (
                <Search className="text-muted-foreground" />
              )}
              <span className="truncate">{query}</span>
              <ArrowRight className="text-muted-foreground ml-auto size-4" />
            </CommandItem>
          </CommandGroup>
        )}

        {suggestions.length > 0 && (
          <CommandGroup heading="History">
            {suggestions.map((h) => (
              <CommandItem
                key={h.id}
                value={`h-${h.id}`}
                onSelect={() => go(h.url)}
              >
                <History className="text-muted-foreground" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{h.title || h.url}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {prettyUrl(h.url)}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {bookmarks.length > 0 && (
          <CommandGroup heading="Bookmarks">
            {bookmarks.slice(0, 6).map((b) => (
              <CommandItem
                key={b.id}
                value={`b-${b.id}`}
                onSelect={() => go(b.url)}
              >
                <Bookmark className="text-muted-foreground" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{b.title || b.url}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {prettyUrl(b.url)}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
