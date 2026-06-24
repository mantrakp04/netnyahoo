import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  FolderPlus,
  PackageOpen,
  Puzzle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InstalledExtension } from "../../../../shared/extensions";
import { EmptyState, InternalPageFrame } from "./frame";

type ExtensionStatus =
  | { state: "idle"; message: string | null }
  | { state: "loading"; message: string | null }
  | { state: "error"; message: string };

export function ExtensionsInternalPage() {
  const [extensions, setExtensions] = useState<InstalledExtension[]>([]);
  const [status, setStatus] = useState<ExtensionStatus>({
    state: "loading",
    message: null,
  });
  const [webStoreInput, setWebStoreInput] = useState("");
  const api = window.netnyahooExtensions;

  const load = useCallback(async () => {
    if (!api) {
      setStatus({
        state: "error",
        message: "Extension support is not available in this window.",
      });
      return;
    }

    setStatus({ state: "loading", message: null });
    try {
      setExtensions(await api.list());
      setStatus({ state: "idle", message: null });
    } catch (error) {
      setStatus({ state: "error", message: getErrorMessage(error) });
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const installUnpacked = async () => {
    if (!api) return;
    setStatus({ state: "loading", message: "Installing extension..." });
    try {
      setExtensions(await api.installUnpacked());
      setStatus({
        state: "idle",
        message: "Extension installed. Reload matching pages to run new content scripts.",
      });
    } catch (error) {
      setStatus({ state: "error", message: getErrorMessage(error) });
    }
  };

  const installFromChromeWebStore = async () => {
    if (!api) return;
    setStatus({ state: "loading", message: "Downloading extension..." });
    try {
      setExtensions(await api.installFromChromeWebStore(webStoreInput));
      setWebStoreInput("");
      setStatus({
        state: "idle",
        message: "Extension installed. Reload matching pages to run new content scripts.",
      });
    } catch (error) {
      setStatus({ state: "error", message: getErrorMessage(error) });
    }
  };

  const remove = async (extension: InstalledExtension) => {
    if (!api) return;
    setStatus({ state: "loading", message: `Removing ${extension.name}...` });
    try {
      setExtensions(await api.remove(extension.id));
      setStatus({ state: "idle", message: `${extension.name} removed.` });
    } catch (error) {
      setStatus({ state: "error", message: getErrorMessage(error) });
    }
  };

  return (
    <InternalPageFrame
      icon={<Puzzle className="size-5" />}
      title="Extensions"
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={status.state === "loading"}
          >
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void installUnpacked()}
            disabled={status.state === "loading" || !api}
          >
            <FolderPlus className="size-4" /> Install unpacked
          </Button>
        </>
      }
    >
      <div className="flex min-h-full flex-col">
        <form
          className="grid gap-2 border-b p-5 sm:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void installFromChromeWebStore();
          }}
        >
          <Input
            value={webStoreInput}
            onChange={(event) => setWebStoreInput(event.currentTarget.value)}
            placeholder="Chrome Web Store URL or extension id"
            disabled={status.state === "loading" || !api}
          />
          <Button
            type="submit"
            variant="secondary"
            size="lg"
            disabled={
              status.state === "loading" || !api || webStoreInput.trim().length === 0
            }
          >
            <FolderPlus className="size-4" /> Install from store
          </Button>
        </form>

        {status.message && (
          <div className="border-b px-5 py-3">
            <div
              className={
                status.state === "error"
                  ? "text-destructive flex items-center gap-2 text-xs"
                  : "text-muted-foreground flex items-center gap-2 text-xs"
              }
            >
              {status.state === "error" && <AlertCircle className="size-4" />}
              {status.message}
            </div>
          </div>
        )}

        {extensions.length === 0 ? (
          <EmptyState icon={<PackageOpen className="size-8 opacity-40" />}>
            No extensions installed
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-3 p-5 xl:grid-cols-2">
            {extensions.map((extension) => (
              <li
                key={extension.id}
                className="bg-background/75 flex min-h-32 flex-col gap-3 rounded-lg border p-4 shadow-[inset_0_1px_0_color-mix(in_oklch,var(--foreground)_4%,transparent)]"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border">
                    <Puzzle className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 className="truncate text-sm font-semibold">
                        {extension.name}
                      </h2>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {extension.version}
                      </span>
                    </div>
                    {extension.description && (
                      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                        {extension.description}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${extension.name}`}
                    onClick={() => void remove(extension)}
                    disabled={status.state === "loading"}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>

                <div className="text-muted-foreground mt-auto min-w-0 space-y-1 text-xs">
                  <div className="truncate">{extension.id}</div>
                  <div className="truncate">{extension.path}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </InternalPageFrame>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Extension action failed.";
}
