import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCw,
} from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { TabList } from "@/components/tab-list";
import { ThemeToggle } from "@/components/theme-toggle";
import { Omnibox, type OmniboxHandle } from "@/components/omnibox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBrowser } from "@/hooks/use-browser";
import { INTERNAL_PAGE_URLS, isInternalPageUrl } from "@/lib/internal-pages";
import { cn } from "@/lib/utils";

const sidebarWidthStorageKey = "netnyahoo:sidebar-width";
const sidebarMinWidth = 248;
const sidebarDefaultWidth = 248;
const sidebarMaxWidth = 380;
type SidebarSide = "left" | "right";

const sidebarPanelStyle = {
  expanded: {
    background: "transparent",
  },
  peeked: {
    background:
      "linear-gradient(180deg, var(--sidebar-material), color-mix(in oklch, var(--sidebar-material) 78%, transparent))",
    borderColor: "color-mix(in oklch, var(--sidebar-border) 88%, transparent)",
    boxShadow:
      "0 22px 64px var(--shadow-deep), inset 0 1px 0 color-mix(in oklch, var(--foreground) 7%, transparent)",
    WebkitBackdropFilter: "blur(26px) saturate(1.22) brightness(0.98)",
    backdropFilter: "blur(26px) saturate(1.22) brightness(0.98)",
  },
} satisfies Record<"expanded" | "peeked", CSSProperties>;

const newTabButtonStyle = {
  background: "var(--sidebar-button-surface)",
  borderColor: "color-mix(in oklch, var(--sidebar-border) 0%, transparent)",
  boxShadow: "none",
  color: "color-mix(in oklch, var(--sidebar-foreground) 86%, transparent)",
} satisfies CSSProperties;

const newTabButtonHoverStyle = {
  background: "var(--sidebar-button-hover-surface)",
  borderColor: "color-mix(in oklch, var(--sidebar-border) 44%, transparent)",
} satisfies CSSProperties;

export function Sidebar({
  omniboxRef,
  side = "left",
  isCollapsed = false,
  onToggleCollapsed,
}: {
  omniboxRef: RefObject<OmniboxHandle | null>;
  side?: SidebarSide;
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const {
    spaceName,
    activeTab,
    nav,
    openTab,
    openInternalPage,
    goBack,
    goForward,
    reload,
  } = useBrowser();
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const tabsSectionRef = useRef<HTMLDivElement>(null);
  const tabContentRef = useRef<HTMLDivElement>(null);
  const newTabRowRef = useRef<HTMLDivElement>(null);
  const activeIsInternal = isInternalPageUrl(activeTab?.url);

  useEffect(() => {
    window.localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    const tabsSection = tabsSectionRef.current;
    const tabContent = tabContentRef.current;
    const newTabRow = newTabRowRef.current;
    if (!tabsSection || !tabContent || !newTabRow) return;

    let frame = 0;
    const updateTabsOverflow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const contentHeight = tabContent.scrollHeight;
        const newTabHeight = newTabRow.offsetHeight;
        const availableHeight = tabsSection.clientHeight;
        setTabsOverflow(contentHeight + newTabHeight > availableHeight + 1);
      });
    };

    updateTabsOverflow();

    const resizeObserver = new ResizeObserver(updateTabsOverflow);
    resizeObserver.observe(tabsSection);
    resizeObserver.observe(tabContent);
    resizeObserver.observe(newTabRow);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <motion.aside
      className={cn(
        "sidebar-panel text-sidebar-foreground relative z-10 flex h-full shrink-0 flex-col",
        isCollapsed &&
          "overflow-hidden rounded-xl border border-sidebar-border/70 shadow-[0_20px_54px_rgb(0_0_0/0.34),0_0_0_1px_rgb(255_255_255/0.04)_inset]",
      )}
      animate={isCollapsed ? "peeked" : "expanded"}
      initial={false}
      style={{ width: sidebarWidth }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      variants={sidebarPanelStyle}
      data-sidebar-state={isCollapsed ? "peeked" : "expanded"}
    >
      {/* Draggable header with nav controls, beside the traffic lights. */}
      <div
        className={cn(
          "app-drag flex h-9 shrink-0 items-center gap-0.5",
          side === "left" ? "pr-2 pl-20" : "pr-20 pl-2",
        )}
      >
        <div className="app-no-drag flex items-center gap-0.5">
          <NavButton onClick={goBack} disabled={!nav.canGoBack}>
            <ArrowLeft className="size-3.5" />
          </NavButton>
          <NavButton onClick={goForward} disabled={!nav.canGoForward}>
            <ArrowRight className="size-3.5" />
          </NavButton>
          <NavButton onClick={reload} disabled={!activeTab || activeIsInternal}>
            <RotateCw className={cn("size-3.5", nav.loading && "animate-spin")} />
          </NavButton>
        </div>
        {onToggleCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={isCollapsed ? "Keep sidebar open" : "Hide sidebar"}
                onClick={onToggleCollapsed}
                className={cn(
                  "app-no-drag ml-auto size-6",
                  side === "right" && "mr-auto ml-0",
                )}
              >
                {getSidebarToggleIcon(side, isCollapsed)}
              </Button>
            </TooltipTrigger>
            <TooltipContent side={side === "left" ? "right" : "left"} sideOffset={6}>
              {isCollapsed ? "Keep sidebar open" : "Hide sidebar"}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="app-no-drag flex flex-col gap-1.5 px-2 pb-1.5">
        {/* The omnibox / URL bar */}
        <Omnibox ref={omniboxRef} />
      </div>

      {/* Tabs */}
      <div ref={tabsSectionRef} className="min-h-0 flex-1">
        <div
          className={cn(
            "px-2 pt-2",
            tabsOverflow
              ? "no-scrollbar h-full overflow-y-auto pb-2 [scrollbar-gutter:auto]"
              : "shrink-0 overflow-visible pb-0",
          )}
        >
          <div ref={tabContentRef}>
            <div className="text-muted-foreground px-1.5 pb-1.5 text-xs font-semibold tracking-wide uppercase">
              {spaceName}
            </div>
            <TabList />
          </div>
          <div
            ref={newTabRowRef}
            className={cn(
              "app-no-drag pt-0.5",
              tabsOverflow && "sticky bottom-0",
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="lg"
              asChild
              onClick={() => openTab()}
              className="w-full justify-start border"
            >
              <motion.button
                style={newTabButtonStyle}
                whileHover={newTabButtonHoverStyle}
              >
                <Plus className="size-4" />
                New Tab
              </motion.button>
            </Button>
          </div>
        </div>
      </div>

      {/* Footer nav */}
      <div className="app-no-drag flex items-center gap-1 border-t p-2">
        <FooterButton
          active={activeTab?.url === INTERNAL_PAGE_URLS.history}
          onClick={() => openInternalPage("history")}
        >
          <History className="size-4" />
          History
        </FooterButton>
        <FooterButton
          active={activeTab?.url === INTERNAL_PAGE_URLS.bookmarks}
          onClick={() => openInternalPage("bookmarks")}
        >
          <Bookmark className="size-4" />
          Bookmarks
        </FooterButton>
        <ThemeToggle />
      </div>

      <SidebarResizeHandle
        width={sidebarWidth}
        side={side}
        onWidthChange={setSidebarWidth}
      />
    </motion.aside>
  );
}

function NavButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

function SidebarResizeHandle({
  width,
  side,
  onWidthChange,
}: {
  width: number;
  side: SidebarSide;
  onWidthChange: (width: number) => void;
}) {
  const resizeFrom = useCallback(
    (startX: number, startWidth: number) => {
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onPointerMove = (event: globalThis.PointerEvent) => {
        const delta =
          side === "left" ? event.clientX - startX : startX - event.clientX;
        onWidthChange(clampSidebarWidth(startWidth + delta));
      };
      const onPointerUp = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
    },
    [onWidthChange, side],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeFrom(event.clientX, width);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onWidthChange(clampSidebarWidth(width + (side === "right" ? 12 : -12)));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onWidthChange(clampSidebarWidth(width + (side === "right" ? -12 : 12)));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onWidthChange(sidebarMinWidth);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      onWidthChange(sidebarMaxWidth);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={sidebarMinWidth}
      aria-valuemax={sidebarMaxWidth}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "app-no-drag absolute top-0 bottom-0 z-30 w-2 cursor-col-resize outline-none after:absolute after:top-2 after:bottom-2 after:left-1/2 after:w-px after:-translate-x-1/2 after:rounded-full after:bg-border/0 after:transition-colors hover:after:bg-border focus-visible:after:bg-ring",
        side === "left" ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
      )}
    />
  );
}

function getInitialSidebarWidth() {
  const storedWidth = Number.parseFloat(
    window.localStorage.getItem(sidebarWidthStorageKey) ?? "",
  );
  return clampSidebarWidth(
    Number.isFinite(storedWidth) ? storedWidth : sidebarDefaultWidth,
  );
}

function clampSidebarWidth(width: number) {
  return Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, width));
}

function FooterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-sidebar-accent/80 text-sidebar-accent-foreground shadow-sm"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/45",
      )}
    >
      {children}
    </button>
  );
}

function getSidebarToggleIcon(side: SidebarSide, isCollapsed: boolean) {
  if (side === "right") {
    return isCollapsed ? (
      <PanelRightOpen className="size-3.5" />
    ) : (
      <PanelRightClose className="size-3.5" />
    );
  }

  return isCollapsed ? (
    <PanelLeftOpen className="size-3.5" />
  ) : (
    <PanelLeftClose className="size-3.5" />
  );
}
