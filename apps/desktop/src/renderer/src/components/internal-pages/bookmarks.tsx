import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkPlus, Globe, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrowser, type BrowserTab } from "@/hooks/use-browser";
import { isInternalPageUrl } from "@/lib/internal-pages";
import { useTRPC } from "@/lib/trpc";
import { prettyUrl } from "@/lib/utils";
import { EmptyState, InternalPageFrame } from "./frame";

export function BookmarksInternalPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { activeTab, navigate, tabs } = useBrowser();

  const bookmarksQuery = useQuery(trpc.bookmarks.list.queryOptions());
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: trpc.bookmarks.list.queryKey() });

  const create = useMutation(
    trpc.bookmarks.create.mutationOptions({ onSuccess: invalidate }),
  );
  const remove = useMutation(
    trpc.bookmarks.remove.mutationOptions({ onSuccess: invalidate }),
  );

  const items = bookmarksQuery.data ?? [];
  const bookmarkableTab = getBookmarkableTab(activeTab, tabs);

  return (
    <InternalPageFrame
      icon={<Bookmark className="size-5" />}
      title="Bookmarks"
      actions={
        bookmarkableTab ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              create.mutate({
                url: bookmarkableTab.url,
                title: bookmarkableTab.title,
                favicon: bookmarkableTab.favicon,
              })
            }
          >
            <BookmarkPlus className="size-4" /> Add page
          </Button>
        ) : null
      }
    >
      {items.length === 0 ? (
        <EmptyState icon={<Bookmark className="size-8 opacity-40" />}>
          No bookmarks yet
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 p-5 xl:grid-cols-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="group bg-background hover:border-primary/50 relative flex min-h-24 flex-col gap-2 rounded-lg border p-3 transition-colors"
            >
              <button
                type="button"
                onClick={() => navigate(item.url)}
                className="flex min-w-0 flex-1 flex-col gap-2 text-left"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {item.favicon ? (
                    <img src={item.favicon} alt="" className="size-5 rounded" />
                  ) : (
                    <Globe className="text-muted-foreground size-5" />
                  )}
                  <span className="truncate text-sm font-medium">
                    {item.title || prettyUrl(item.url)}
                  </span>
                </div>
                <span className="text-muted-foreground truncate text-xs">
                  {prettyUrl(item.url)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove.mutate({ id: item.id })}
                className="bg-background hover:bg-accent absolute top-2 right-2 hidden size-6 items-center justify-center rounded-md border transition-colors group-hover:flex"
                aria-label={`Remove ${item.title || item.url}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </InternalPageFrame>
  );
}

function getBookmarkableTab(
  activeTab: BrowserTab | undefined,
  tabs: BrowserTab[],
) {
  if (activeTab && isBookmarkableUrl(activeTab.url)) return activeTab;

  return tabs
    .filter((tab) => isBookmarkableUrl(tab.url))
    .sort((a, b) => timeValue(b.lastAccessedAt) - timeValue(a.lastAccessedAt))[0];
}

function isBookmarkableUrl(url: string) {
  return !!url && url !== "about:blank" && !isInternalPageUrl(url);
}

function timeValue(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
