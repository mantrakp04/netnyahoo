import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrowser } from "@/hooks/use-browser";
import { useTRPC } from "@/lib/trpc";
import { prettyUrl } from "@/lib/utils";
import { EmptyState, InternalPageFrame } from "./frame";

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
