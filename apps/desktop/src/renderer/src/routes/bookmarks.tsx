import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkPlus, Globe, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OverlayPanel } from "@/components/overlay-panel";
import { useBrowser } from "@/hooks/use-browser";
import { useTRPC } from "@/lib/trpc";
import { prettyUrl } from "@/lib/utils";

export const Route = createFileRoute("/bookmarks")({
  component: BookmarksPage,
});

function BookmarksPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openTab, activeTab } = useBrowser();

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
  const canBookmark = activeTab && activeTab.url !== "about:blank";

  return (
    <OverlayPanel
      title="Bookmarks"
      actions={
        canBookmark ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              create.mutate({
                url: activeTab.url,
                title: activeTab.title,
                favicon: activeTab.favicon,
              })
            }
          >
            <BookmarkPlus className="size-4" /> Add current tab
          </Button>
        ) : null
      }
    >
      {items.length === 0 ? (
        <Empty />
      ) : (
        <ul className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-3">
          {items.map((b) => (
            <li
              key={b.id}
              className="group bg-background hover:border-primary/50 relative flex flex-col gap-2 rounded-xl border p-3 transition-colors"
            >
              <button
                type="button"
                onClick={() => {
                  openTab(b.url);
                  navigate({ to: "/" });
                }}
                className="flex flex-col gap-2 text-left"
              >
                <div className="flex items-center gap-2">
                  {b.favicon ? (
                    <img src={b.favicon} alt="" className="size-5 rounded" />
                  ) : (
                    <Globe className="text-muted-foreground size-5" />
                  )}
                  <span className="truncate text-sm font-medium">
                    {b.title || prettyUrl(b.url)}
                  </span>
                </div>
                <span className="text-muted-foreground truncate text-xs">
                  {prettyUrl(b.url)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove.mutate({ id: b.id })}
                className="bg-background absolute top-2 right-2 hidden size-6 items-center justify-center rounded-md border group-hover:flex"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </OverlayPanel>
  );
}

function Empty() {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2">
      <Bookmark className="size-8 opacity-40" />
      <p className="text-sm">No bookmarks yet</p>
      <p className="text-xs opacity-60">
        Open a page and add it from the active tab
      </p>
    </div>
  );
}
