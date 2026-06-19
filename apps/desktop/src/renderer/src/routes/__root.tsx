import { useCallback, useEffect, useState } from "react";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { TRPCClient } from "@trpc/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";
import { BrowserArea } from "@/components/browser-area";
import {
  CommandPalette,
  type PaletteMode,
} from "@/components/command-palette";
import { BrowserProvider, useBrowser } from "@/hooks/use-browser";
import { ThemeProvider } from "@/hooks/use-theme";
import type { AppRouter } from "@netnyahoo/backend";

export interface RouterContext {
  queryClient: QueryClient;
  trpcClient: TRPCClient<AppRouter>;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <BrowserProvider>
          <Shell />
        </BrowserProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

function Shell() {
  const { openTab, closeTab, reload, goBack, goForward, activeTab } =
    useBrowser();
  const [palette, setPalette] = useState<{ open: boolean; mode: PaletteMode }>({
    open: false,
    mode: "new-tab",
  });

  const openPalette = useCallback(
    (mode: PaletteMode) => setPalette({ open: true, mode }),
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod || event.altKey) return;

      const key = event.key.toLowerCase();
      const code = event.code.toLowerCase();
      const preventAndRun = (action: () => void) => {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) action();
      };

      if (!event.shiftKey && key === "t") {
        preventAndRun(() => openTab());
        return;
      }

      if (!event.shiftKey && key === "l") {
        preventAndRun(() => openPalette("navigate"));
        return;
      }

      if (!event.shiftKey && key === "w") {
        preventAndRun(() => {
          if (activeTab) closeTab(activeTab.id);
        });
        return;
      }

      if (!event.shiftKey && key === "r") {
        preventAndRun(reload);
        return;
      }

      if (!event.shiftKey && (key === "arrowleft" || code === "bracketleft")) {
        preventAndRun(goBack);
        return;
      }

      if (!event.shiftKey && (key === "arrowright" || code === "bracketright")) {
        preventAndRun(goForward);
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [
    activeTab,
    closeTab,
    goBack,
    goForward,
    openPalette,
    openTab,
    reload,
  ]);

  return (
    <div className="theme-gradient flex h-full w-full">
      <Sidebar onOpenPalette={openPalette} />
      <main className="relative flex-1 p-2 pl-0">
        <BrowserArea onOpenPalette={openPalette} />
        <Outlet />
      </main>
      <CommandPalette
        open={palette.open}
        mode={palette.mode}
        onOpenChange={(open) => setPalette((p) => ({ ...p, open }))}
      />
    </div>
  );
}
