import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  BookmarkPlus,
  Globe,
  History,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrowser } from "@/hooks/use-browser";
import type { BrowserTab } from "@/hooks/use-browser";
import { useTRPC } from "@/lib/trpc";
import { prettyUrl } from "@/lib/utils";
import { isInternalPageUrl } from "@/lib/internal-pages";

export function HistoryInternalPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { navigate } = useBrowser();

  const historyQuery = useQuery(trpc.history.list.queryOptions({ limit: 300 }));
  const clear = useMutation(
    trpc.history.clear.mutationOptions({
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: trpc.history.list.queryKey() }),
    }),
  );

  const entries = historyQuery.data ?? [];

  return (
    <InternalPageFrame
      icon={<History className="size-5" />}
      title="History"
      actions={
        entries.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clear.mutate()}
            className="text-muted-foreground"
          >
            <Trash2 className="size-4" /> Clear
          </Button>
        ) : null
      }
    >
      {entries.length === 0 ? (
        <EmptyState icon={<History className="size-8 opacity-40" />}>
          No history yet
        </EmptyState>
      ) : (
        <ul className="divide-border/60 divide-y">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => navigate(entry.url)}
                className="hover:bg-accent/50 flex w-full items-center gap-3 px-5 py-3 text-left"
              >
                {entry.favicon ? (
                  <img src={entry.favicon} alt="" className="size-4 rounded-sm" />
                ) : (
                  <Globe className="text-muted-foreground size-4" />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {entry.title || entry.url}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {prettyUrl(entry.url)}
                  </span>
                </div>
                <time className="text-muted-foreground shrink-0 text-xs">
                  {new Date(entry.visitedAt).toLocaleString()}
                </time>
              </button>
            </li>
          ))}
        </ul>
      )}
    </InternalPageFrame>
  );
}

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

function InternalPageFrame({
  icon,
  title,
  actions,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card absolute inset-0 z-20 flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <span className="text-muted-foreground">{icon}</span>
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function EmptyState({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2">
      {icon}
      <p className="text-sm">{children}</p>
    </div>
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
