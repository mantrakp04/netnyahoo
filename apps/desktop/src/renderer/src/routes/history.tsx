import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OverlayPanel } from "@/components/overlay-panel";
import { useBrowser } from "@/hooks/use-browser";
import { useTRPC } from "@/lib/trpc";
import { prettyUrl } from "@/lib/utils";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
});

function HistoryPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openTab } = useBrowser();

  const historyQuery = useQuery(trpc.history.list.queryOptions({ limit: 300 }));
  const clear = useMutation(
    trpc.history.clear.mutationOptions({
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: trpc.history.list.queryKey() }),
    }),
  );

  const entries = historyQuery.data ?? [];

  return (
    <OverlayPanel
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
        <Empty />
      ) : (
        <ul className="divide-border/60 divide-y">
          {entries.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  openTab(h.url);
                  navigate({ to: "/" });
                }}
                className="hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-2.5 text-left"
              >
                {h.favicon ? (
                  <img src={h.favicon} alt="" className="size-4 rounded-sm" />
                ) : (
                  <Globe className="text-muted-foreground size-4" />
                )}
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{h.title || h.url}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {prettyUrl(h.url)}
                  </span>
                </div>
                <time className="text-muted-foreground ml-auto shrink-0 text-xs">
                  {new Date(h.visitedAt).toLocaleString()}
                </time>
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
      <Globe className="size-8 opacity-40" />
      <p className="text-sm">No history yet</p>
    </div>
  );
}
