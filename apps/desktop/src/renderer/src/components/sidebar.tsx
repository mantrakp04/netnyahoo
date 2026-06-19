import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  History,
  Plus,
  RotateCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabList } from "@/components/tab-list";
import { ThemeToggle } from "@/components/theme-toggle";
import { useBrowser } from "@/hooks/use-browser";
import { cn, prettyUrl } from "@/lib/utils";
import type { PaletteMode } from "@/components/command-palette";

export function Sidebar({
  onOpenPalette,
}: {
  onOpenPalette: (mode: PaletteMode) => void;
}) {
  const { spaceName, activeTab, nav, openTab, goBack, goForward, reload } =
    useBrowser();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="text-sidebar-foreground flex w-64 shrink-0 flex-col">
      {/* Draggable header with nav controls, beside the traffic lights. */}
      <div className="app-drag flex h-11 shrink-0 items-center gap-1 pr-3 pl-20">
        <div className="app-no-drag flex items-center gap-0.5">
          <NavButton onClick={goBack} disabled={!nav.canGoBack}>
            <ArrowLeft className="size-3.5" />
          </NavButton>
          <NavButton onClick={goForward} disabled={!nav.canGoForward}>
            <ArrowRight className="size-3.5" />
          </NavButton>
          <NavButton onClick={reload} disabled={!activeTab}>
            <RotateCw className={cn("size-3.5", nav.loading && "animate-spin")} />
          </NavButton>
        </div>
      </div>

      <div className="app-no-drag flex flex-col gap-2 px-3 pb-2">
        {/* The omnibox / URL bar */}
        <button
          type="button"
          onClick={() => onOpenPalette("navigate")}
          className="bg-background/60 hover:bg-background text-muted-foreground flex h-9 items-center gap-2 rounded-lg border px-3 text-left text-sm transition-colors"
        >
          <Search className="size-4 shrink-0" />
          <span className="truncate">
            {activeTab && activeTab.url !== "about:blank"
              ? prettyUrl(activeTab.url)
              : "Search or Enter URL…"}
          </span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="text-muted-foreground px-2.5 pb-1.5 text-xs font-semibold tracking-wide uppercase">
          {spaceName}
        </div>
        <TabList />
        <button
          type="button"
          onClick={() => openTab()}
          className="text-muted-foreground hover:bg-sidebar-accent/50 mt-1 flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors"
        >
          <Plus className="size-4" />
          New Tab
        </button>
      </div>

      {/* Footer nav */}
      <div className="app-no-drag flex items-center gap-1 border-t p-3">
        <FooterLink to="/history" active={pathname === "/history"}>
          <History className="size-4" />
          History
        </FooterLink>
        <FooterLink to="/bookmarks" active={pathname === "/bookmarks"}>
          <Bookmark className="size-4" />
          Bookmarks
        </FooterLink>
        <ThemeToggle />
      </div>
    </aside>
  );
}

function NavButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

function FooterLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/50",
      )}
    >
      {children}
    </Link>
  );
}
