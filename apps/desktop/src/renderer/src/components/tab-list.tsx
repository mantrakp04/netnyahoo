import { Globe, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useBrowser } from "@/hooks/use-browser";
import { cn } from "@/lib/utils";
import type { Tab } from "@netnyahoo/db";

function Favicon({ tab }: { tab: Tab }) {
  if (tab.favicon) {
    return (
      <img
        src={tab.favicon}
        alt=""
        className="size-4 shrink-0 rounded-sm"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }
  return <Globe className="text-muted-foreground size-4 shrink-0" />;
}

export function TabList() {
  const { tabs, activeTab, activateTab, closeTab } = useBrowser();
  const reduceMotion = useReducedMotion();
  const diaEase = [0.22, 1, 0.36, 1] as const;
  const tabMotion = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.12 },
      }
    : {
        initial: { opacity: 0, y: 7 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4 },
        transition: { duration: 0.18, ease: diaEase },
      };

  return (
    <div className="flex flex-col gap-0.5">
      <AnimatePresence initial={false}>
        {tabs.map((tab) => (
          <motion.button
            key={tab.id}
            layout="position"
            type="button"
            onClick={() => activateTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(tab.id); // middle-click closes
            }}
            className={cn(
              "group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors",
              tab.id === activeTab?.id
                ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50",
            )}
            {...tabMotion}
          >
            <Favicon tab={tab} />
            <span className="truncate">
              {tab.title || tab.url || "New Tab"}
            </span>
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="hover:bg-background/80 ml-auto hidden size-5 shrink-0 items-center justify-center rounded-md group-hover:flex"
            >
              <X className="size-3.5" />
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
