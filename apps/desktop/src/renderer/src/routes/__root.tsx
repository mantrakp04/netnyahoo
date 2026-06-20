import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { TRPCClient } from "@trpc/client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";
import { BrowserArea } from "@/components/browser-area";
import type { OmniboxHandle } from "@/components/omnibox";
import { BrowserProvider, useBrowser } from "@/hooks/use-browser";
import { ThemeProvider } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import type { BrowserCommand } from "../../../shared/browser-commands";
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

const sidebarCollapsedStorageKey = "netnyahoo:sidebar-collapsed";
const sidebarSide = "left" as const;
const sidebarMotionEase = [0.32, 0.72, 0, 1] as const;

function Shell() {
  const {
    openTab,
    reopenClosedTab,
    closeTab,
    reload,
    goBack,
    goForward,
    activeTab,
  } = useBrowser();
  const omniboxRef = useRef<OmniboxHandle>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    getInitialSidebarCollapsed,
  );
  const [sidebarPeeked, setSidebarPeeked] = useState(false);
  const sidebarShellRef = useRef<HTMLDivElement | null>(null);
  const sidebarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sidebarPeekCloseTimer = useRef<number | null>(null);
  const reduceMotion = useReducedMotion();

  const runBrowserCommand = useCallback(
    (command: BrowserCommand) => {
      switch (command) {
        case "new-tab":
          openTab();
          break;
        case "reopen-closed-tab":
          reopenClosedTab();
          break;
        case "close-tab":
          if (activeTab) closeTab(activeTab.id);
          break;
        case "focus-omnibox":
          omniboxRef.current?.focus();
          break;
        case "reload":
          reload();
          break;
        case "go-back":
          goBack();
          break;
        case "go-forward":
          goForward();
          break;
      }
    },
    [activeTab, closeTab, goBack, goForward, openTab, reload, reopenClosedTab],
  );

  useEffect(() => {
    window.localStorage.setItem(
      sidebarCollapsedStorageKey,
      sidebarCollapsed ? "true" : "false",
    );
    if (!sidebarCollapsed) setSidebarPeeked(false);
  }, [sidebarCollapsed]);

  useEffect(
    () => () => {
      if (sidebarPeekCloseTimer.current) {
        window.clearTimeout(sidebarPeekCloseTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod || event.altKey) return;

      const key = event.key.toLowerCase();
      const preventAndRun = (action: () => void) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (!event.repeat) action();
      };

      if (!event.shiftKey && key === "b") {
        preventAndRun(() => setSidebarCollapsed((value) => !value));
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, []);

  useEffect(() => {
    return window.netnyahooBrowserCommands?.onCommand(runBrowserCommand);
  }, [runBrowserCommand]);

  const sidebarVisible = !sidebarCollapsed || sidebarPeeked;

  const clearSidebarPeekClose = () => {
    if (!sidebarPeekCloseTimer.current) return;
    window.clearTimeout(sidebarPeekCloseTimer.current);
    sidebarPeekCloseTimer.current = null;
  };

  const keepSidebarPeeked = () => {
    clearSidebarPeekClose();
    if (sidebarCollapsed) setSidebarPeeked(true);
  };

  const scheduleSidebarPeekClose = () => {
    if (!sidebarCollapsed) return;
    clearSidebarPeekClose();
    sidebarPeekCloseTimer.current = window.setTimeout(() => {
      if (sidebarShellRef.current?.contains(document.activeElement)) {
        sidebarPeekCloseTimer.current = null;
        return;
      }
      setSidebarPeeked(false);
      sidebarPeekCloseTimer.current = null;
    }, 180);
  };

  type SidebarPeekEvent =
    | ReactPointerEvent<HTMLElement>
    | ReactMouseEvent<HTMLElement>;

  const pointerIsInSidebarPeekZone = (event: SidebarPeekEvent) => {
    const tolerance = 8;
    return [sidebarShellRef.current, sidebarTriggerRef.current].some((element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return (
        event.clientX >= rect.left - tolerance &&
        event.clientX <= rect.right + tolerance &&
        event.clientY >= rect.top - tolerance &&
        event.clientY <= rect.bottom + tolerance
      );
    });
  };

  const closePeekWhenOutside = (event: SidebarPeekEvent) => {
    if (!sidebarCollapsed) return;
    if (pointerIsInSidebarPeekZone(event)) {
      keepSidebarPeeked();
      return;
    }
    scheduleSidebarPeekClose();
  };

  return (
    <div className="theme-gradient relative flex h-full w-full overflow-hidden">
      {sidebarCollapsed && sidebarPeeked && (
        <div
          aria-hidden
          onPointerEnter={closePeekWhenOutside}
          onPointerMove={closePeekWhenOutside}
          onMouseEnter={closePeekWhenOutside}
          onMouseMove={closePeekWhenOutside}
          onPointerDown={() => setSidebarPeeked(false)}
          onMouseDown={() => setSidebarPeeked(false)}
          className="absolute inset-0 z-[35]"
        />
      )}
      <AnimatePresence initial={false}>
        {sidebarVisible && (
          <motion.div
            ref={sidebarShellRef}
            key="sidebar-shell"
            initial={getSidebarMotionState("hidden", reduceMotion)}
            animate={getSidebarMotionState("visible", reduceMotion)}
            exit={getSidebarMotionState("hidden", reduceMotion)}
            transition={{
              duration: reduceMotion ? 0.12 : 0.22,
              ease: sidebarMotionEase,
            }}
            onPointerEnter={keepSidebarPeeked}
            onPointerMove={keepSidebarPeeked}
            onPointerLeave={closePeekWhenOutside}
            onMouseEnter={keepSidebarPeeked}
            onMouseMove={keepSidebarPeeked}
            onMouseLeave={closePeekWhenOutside}
            className={cn(
              "z-40 flex shrink-0 will-change-transform",
              sidebarCollapsed && "absolute top-0 bottom-0 p-2",
              sidebarCollapsed && "left-0 origin-left",
            )}
          >
            <Sidebar
              omniboxRef={omniboxRef}
              side={sidebarSide}
              isCollapsed={sidebarCollapsed}
              onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {sidebarCollapsed && (
        <button
          ref={sidebarTriggerRef}
          type="button"
          aria-label="Show sidebar"
          onPointerEnter={keepSidebarPeeked}
          onPointerMove={keepSidebarPeeked}
          onPointerLeave={closePeekWhenOutside}
          onMouseEnter={keepSidebarPeeked}
          onMouseMove={keepSidebarPeeked}
          onMouseLeave={closePeekWhenOutside}
          onFocus={keepSidebarPeeked}
          onClick={() => setSidebarCollapsed(false)}
          className={cn(
            "app-no-drag absolute top-0 bottom-0 z-30 w-3 outline-none transition-colors hover:bg-sidebar-accent/35 focus-visible:bg-sidebar-accent/60",
            sidebarSide === "left" ? "left-0" : "right-0",
          )}
        />
      )}
      <main className="relative flex-1 p-1">
        <BrowserArea />
        <Outlet />
      </main>
    </div>
  );
}

function getInitialSidebarCollapsed() {
  return window.localStorage.getItem(sidebarCollapsedStorageKey) === "true";
}

function getSidebarMotionState(
  state: "hidden" | "visible",
  reduceMotion: boolean | null,
) {
  if (state === "visible") return { opacity: 1, x: 0, scale: 1 };

  const x = reduceMotion ? 0 : sidebarSide === "left" ? -18 : 18;
  return { opacity: 0, x, scale: reduceMotion ? 1 : 0.985 };
}
