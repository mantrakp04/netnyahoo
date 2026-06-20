import { useMemo, useRef, useState, type DragEvent } from "react";
import { Bookmark, Globe, History, Layers2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  SIDEBAR_ACTIVE_LAYOUT_ID,
  useActiveIndicatorTransition,
  useTabMotion,
} from "@/hooks/motion";
import { useBrowser, type BrowserTab } from "@/hooks/use-browser";
import { getInternalPage, getInternalPageTitle } from "@/lib/internal-pages";
import { cn } from "@/lib/utils";

type DropPlacement = "before" | "after" | "group" | "end";

interface DropTarget {
  tabId?: string;
  placement: DropPlacement;
}

interface TabGroup {
  id: string;
  name: string | null;
  tabs: BrowserTab[];
}

type TabListRow =
  | { type: "tab"; tab: BrowserTab }
  | { type: "group"; group: TabGroup };

const tabDragMime = "application/x-netnyahoo-tab";

function Favicon({ tab }: { tab: BrowserTab }) {
  const internalPage = getInternalPage(tab.url);
  if (internalPage === "history") {
    return <History className="text-muted-foreground size-4 shrink-0" />;
  }
  if (internalPage === "bookmarks") {
    return <Bookmark className="text-muted-foreground size-4 shrink-0" />;
  }

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
  const { tabs, activeTab, activateTab, closeTab, moveTab, renameGroup } =
    useBrowser();
  const tabMotion = useTabMotion();
  const indicatorTransition = useActiveIndicatorTransition();
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const suppressClickUntil = useRef(0);
  const rows = useMemo(() => buildTabRows(tabs), [tabs]);

  const dragging = draggingTabId !== null;

  const startDrag = (event: DragEvent<HTMLElement>, tab: BrowserTab) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(tabDragMime, tab.id);
    setDraggingTabId(tab.id);
  };

  const finishDrag = () => {
    suppressClickUntil.current = Date.now() + 250;
    setDraggingTabId(null);
    setDropTarget(null);
  };

  const updateRowDropTarget = (
    event: DragEvent<HTMLElement>,
    targetTab: BrowserTab,
  ) => {
    if (!dragging || draggingTabId === targetTab.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({
      tabId: targetTab.id,
      placement: getTabDropPlacement(event),
    });
  };

  const dropOnTab = (event: DragEvent<HTMLElement>, targetTab: BrowserTab) => {
    event.preventDefault();
    const id = event.dataTransfer.getData(tabDragMime) || draggingTabId;
    const placement = dropTarget?.tabId === targetTab.id
      ? dropTarget.placement
      : getTabDropPlacement(event);

    if (id && id !== targetTab.id) {
      moveTab({ id, targetId: targetTab.id, placement });
    }
    finishDrag();
  };

  const dropAtEnd = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const id = event.dataTransfer.getData(tabDragMime) || draggingTabId;
    if (id) moveTab({ id, placement: "end" });
    finishDrag();
  };

  const startRenamingGroup = (group: TabGroup) => {
    setRenamingGroupId(group.id);
    setGroupNameDraft(getGroupTitle(group));
  };

  const commitGroupRename = () => {
    if (!renamingGroupId) return;
    const name = groupNameDraft.trim();
    if (name) renameGroup(renamingGroupId, name);
    setRenamingGroupId(null);
    setGroupNameDraft("");
  };

  const cancelGroupRename = () => {
    setRenamingGroupId(null);
    setGroupNameDraft("");
  };

  return (
    <div
      className="flex w-full flex-col gap-0.5"
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropTarget(null);
        }
      }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {rows.map((row) =>
          row.type === "group" ? (
            <motion.div
              key={row.group.id}
              layout="position"
              transition={indicatorTransition}
              className="my-0.5 rounded-md bg-sidebar-accent/25 px-1 py-1"
            >
              <div className="text-muted-foreground flex h-5 items-center gap-1.5 px-1 text-[0.625rem] font-medium">
                <Layers2 className="size-3" />
                {renamingGroupId === row.group.id ? (
                  <input
                    autoFocus
                    value={groupNameDraft}
                    onChange={(event) => setGroupNameDraft(event.target.value)}
                    onBlur={commitGroupRename}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitGroupRename();
                      if (event.key === "Escape") cancelGroupRename();
                    }}
                    className="selection:bg-primary/20 min-w-0 flex-1 rounded-sm bg-transparent px-0 text-[0.625rem] font-medium text-sidebar-foreground outline-none"
                    aria-label="Rename tab group"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => startRenamingGroup(row.group)}
                    className="hover:text-sidebar-foreground min-w-0 flex-1 truncate text-left transition-colors"
                    aria-label={`Rename ${getGroupTitle(row.group)}`}
                  >
                    {getGroupTitle(row.group)}
                  </button>
                )}
                <span className="tabular-nums">{row.group.tabs.length}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                {row.group.tabs.map((tab) => (
                  <TabRow
                    key={tab.id}
                    tab={tab}
                    isActive={tab.id === activeTab?.id}
                    isDragging={tab.id === draggingTabId}
                    dropTarget={dropTarget}
                    tabMotion={tabMotion}
                    indicatorTransition={indicatorTransition}
                    onActivate={() => {
                      if (Date.now() < suppressClickUntil.current) return;
                      activateTab(tab.id);
                    }}
                    onClose={() => closeTab(tab.id)}
                    onDragStart={(event) => startDrag(event, tab)}
                    onDragEnd={finishDrag}
                    onDragOver={(event) => updateRowDropTarget(event, tab)}
                    onDrop={(event) => dropOnTab(event, tab)}
                  />
                ))}
              </div>
            </motion.div>
          ) : (
            <TabRow
              key={row.tab.id}
              tab={row.tab}
              isActive={row.tab.id === activeTab?.id}
              isDragging={row.tab.id === draggingTabId}
              dropTarget={dropTarget}
              tabMotion={tabMotion}
              indicatorTransition={indicatorTransition}
              onActivate={() => {
                if (Date.now() < suppressClickUntil.current) return;
                activateTab(row.tab.id);
              }}
              onClose={() => closeTab(row.tab.id)}
              onDragStart={(event) => startDrag(event, row.tab)}
              onDragEnd={finishDrag}
              onDragOver={(event) => updateRowDropTarget(event, row.tab)}
              onDrop={(event) => dropOnTab(event, row.tab)}
            />
          ),
        )}
      </AnimatePresence>
      {dragging && (
        <div
          className={cn(
            "h-3 rounded-md transition-colors",
            dropTarget?.placement === "end" && "bg-primary/20",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropTarget({ placement: "end" });
          }}
          onDrop={dropAtEnd}
        />
      )}
    </div>
  );
}

function TabRow({
  tab,
  isActive,
  isDragging,
  dropTarget,
  tabMotion,
  indicatorTransition,
  onActivate,
  onClose,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  tab: BrowserTab;
  isActive: boolean;
  isDragging: boolean;
  dropTarget: DropTarget | null;
  tabMotion: ReturnType<typeof useTabMotion>;
  indicatorTransition: ReturnType<typeof useActiveIndicatorTransition>;
  onActivate: () => void;
  onClose: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const targetPlacement =
    dropTarget?.tabId === tab.id ? dropTarget.placement : null;
  const title = getTabTitle(tab);

  return (
    <motion.div
      draggable
      onDragStartCapture={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "group relative h-7 w-full overflow-hidden rounded-md transition-colors",
        !isActive && "hover:bg-sidebar-accent/50",
        isDragging && "opacity-45",
      )}
      {...tabMotion}
    >
      {targetPlacement === "before" && <DropLine edge="top" />}
      {targetPlacement === "after" && <DropLine edge="bottom" />}
      {targetPlacement === "group" && (
        <span
          aria-hidden
          className="bg-primary/10 pointer-events-none absolute inset-0 z-20 rounded-md outline outline-1 -outline-offset-1 outline-primary/60"
        />
      )}
      {isActive && (
        <motion.span
          layoutId={SIDEBAR_ACTIVE_LAYOUT_ID}
          layout="position"
          transition={indicatorTransition}
          aria-hidden
          className="bg-sidebar-accent absolute inset-0 block rounded-md shadow-sm"
        />
      )}
      <button
        type="button"
        onClick={onActivate}
        onAuxClick={(e) => {
          if (e.button === 1) onClose(); // middle-click closes
        }}
        className={cn(
          "relative z-10 flex h-7 w-full appearance-none items-center gap-1.5 rounded-md bg-transparent pr-6 pl-1.5 text-left text-xs",
          isActive
            ? "text-sidebar-accent-foreground"
            : "text-sidebar-foreground/80",
        )}
      >
        <Favicon tab={tab} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      <button
        type="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="hover:bg-background/80 pointer-events-none absolute top-1/2 right-1 z-30 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
        aria-label={`Close ${title}`}
      >
        <X className="size-3" />
      </button>
    </motion.div>
  );
}

function getTabTitle(tab: BrowserTab) {
  const internalPage = getInternalPage(tab.url);
  if (internalPage) return getInternalPageTitle(internalPage);
  return tab.title || tab.url || "New Tab";
}

function DropLine({ edge }: { edge: "top" | "bottom" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary pointer-events-none absolute right-1 left-1 z-30 h-px",
        edge === "top" ? "top-0" : "bottom-0",
      )}
    />
  );
}

function getTabDropPlacement(event: DragEvent<HTMLElement>): DropPlacement {
  const rect = event.currentTarget.getBoundingClientRect();
  const offset = (event.clientY - rect.top) / rect.height;

  if (offset < 0.28) return "before";
  if (offset > 0.72) return "after";
  return "group";
}

function buildTabRows(tabs: BrowserTab[]): TabListRow[] {
  const groups = new Map<string, BrowserTab[]>();
  const rows: TabListRow[] = [];
  const emittedGroups = new Set<string>();

  for (const tab of tabs) {
    if (!tab.groupId) continue;
    const groupTabs = groups.get(tab.groupId) ?? [];
    groupTabs.push(tab);
    groups.set(tab.groupId, groupTabs);
  }

  for (const tab of tabs) {
    if (!tab.groupId) {
      rows.push({ type: "tab", tab });
      continue;
    }

    const groupTabs = groups.get(tab.groupId) ?? [tab];
    if (groupTabs.length < 2) {
      rows.push({ type: "tab", tab });
      continue;
    }

    if (emittedGroups.has(tab.groupId)) continue;
    emittedGroups.add(tab.groupId);
    rows.push({
      type: "group",
      group: {
        id: tab.groupId,
        name:
          groupTabs.find((groupTab) => groupTab.groupName)?.groupName ?? null,
        tabs: groupTabs,
      },
    });
  }

  return rows;
}

function getGroupTitle(group: TabGroup) {
  if (group.name?.trim()) return group.name;

  const firstNamedTab = group.tabs.find((tab) => {
    const title = tab.title.trim();
    return title && title !== "New Tab";
  });

  return firstNamedTab?.title ?? "Tab Group";
}
