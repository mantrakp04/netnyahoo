import { useMemo, useRef, useState, type DragEvent } from "react";
import {
  Bookmark,
  ChevronRight,
  Globe,
  History,
  Trash2,
  Ungroup,
  X,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
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
  groupId?: string;
  placement: DropPlacement;
}

interface TabGroup {
  id: string;
  name: string | null;
  collapsed: boolean;
  tabs: BrowserTab[];
}

type TabListRow =
  | { type: "tab"; tab: BrowserTab }
  | { type: "group"; group: TabGroup };

const tabDragMime = "application/x-netnyahoo-tab";
const groupDragMime = "application/x-netnyahoo-group";

type DragSource = { type: "tab" | "group"; id: string };

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
  const {
    tabs,
    activeTab,
    activateTab,
    closeTab,
    moveTab,
    moveGroup,
    renameGroup,
    setGroupCollapsed,
    ungroupGroup,
    deleteGroup,
  } = useBrowser();
  const tabMotion = useTabMotion();
  const indicatorTransition = useActiveIndicatorTransition();
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const suppressClickUntil = useRef(0);
  const rows = useMemo(() => buildTabRows(tabs), [tabs]);

  const dragging = dragSource !== null;
  const draggingTabId = dragSource?.type === "tab" ? dragSource.id : null;
  const draggingGroupId = dragSource?.type === "group" ? dragSource.id : null;

  const startTabDrag = (event: DragEvent<HTMLElement>, tab: BrowserTab) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(tabDragMime, tab.id);
    setDragSource({ type: "tab", id: tab.id });
  };

  const startGroupDrag = (event: DragEvent<HTMLElement>, group: TabGroup) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(groupDragMime, group.id);
    setDragSource({ type: "group", id: group.id });
  };

  const finishDrag = () => {
    suppressClickUntil.current = Date.now() + 250;
    setDragSource(null);
    setDropTarget(null);
  };

  // Tab dragged over a tab row — used by standalone and group-member tabs alike.
  const updateTabDropTarget = (
    event: DragEvent<HTMLElement>,
    targetTab: BrowserTab,
  ) => {
    if (dragSource?.type !== "tab" || dragSource.id === targetTab.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({
      tabId: targetTab.id,
      placement: getTabDropPlacement(event),
    });
  };

  const dropOnTab = (event: DragEvent<HTMLElement>, targetTab: BrowserTab) => {
    if (dragSource?.type !== "tab") return;
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

  // Standalone tabs also accept a dragged group docking before/after them.
  const onStandaloneDragOver = (
    event: DragEvent<HTMLElement>,
    tab: BrowserTab,
  ) => {
    if (dragSource?.type !== "group") return updateTabDropTarget(event, tab);
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ tabId: tab.id, placement: getEdgePlacement(event) });
  };

  const onStandaloneDrop = (event: DragEvent<HTMLElement>, tab: BrowserTab) => {
    if (dragSource?.type !== "group") return dropOnTab(event, tab);
    event.preventDefault();
    const id = event.dataTransfer.getData(groupDragMime) || draggingGroupId;
    const placement =
      dropTarget?.tabId === tab.id ? dropTarget.placement : getEdgePlacement(event);
    if (id && (placement === "before" || placement === "after")) {
      moveGroup({ id, targetId: tab.id, placement });
    }
    finishDrag();
  };

  // A group can be reordered relative to another group (never nested into it).
  const updateGroupDropTarget = (
    event: DragEvent<HTMLElement>,
    group: TabGroup,
  ) => {
    if (dragSource?.type !== "group" || dragSource.id === group.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ groupId: group.id, placement: getEdgePlacement(event) });
  };

  const dropOnGroup = (event: DragEvent<HTMLElement>, group: TabGroup) => {
    if (dragSource?.type !== "group" || dragSource.id === group.id) return;
    event.preventDefault();
    const id = event.dataTransfer.getData(groupDragMime) || draggingGroupId;
    const placement =
      dropTarget?.groupId === group.id
        ? dropTarget.placement
        : getEdgePlacement(event);
    const boundary =
      placement === "before" ? group.tabs[0] : group.tabs[group.tabs.length - 1];
    if (id && boundary && (placement === "before" || placement === "after")) {
      moveGroup({ id, targetId: boundary.id, placement });
    }
    finishDrag();
  };

  const dropAtEnd = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (dragSource?.type === "group") {
      const id = event.dataTransfer.getData(groupDragMime) || draggingGroupId;
      if (id) moveGroup({ id, placement: "end" });
    } else {
      const id = event.dataTransfer.getData(tabDragMime) || draggingTabId;
      if (id) moveTab({ id, placement: "end" });
    }
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
      <LayoutGroup id="sidebar-tabs">
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map((row) =>
            row.type === "group" ? (
              <motion.div
                key={row.group.id}
                layout="position"
                transition={indicatorTransition}
                onDragOver={(event) => updateGroupDropTarget(event, row.group)}
                onDrop={(event) => dropOnGroup(event, row.group)}
                className={cn(
                  "relative my-0.5 rounded-md bg-sidebar-accent/25 px-1 py-1",
                  draggingGroupId === row.group.id && "opacity-45",
                )}
              >
                {dropTarget?.groupId === row.group.id &&
                  dropTarget.placement === "before" && <DropLine edge="top" />}
                {dropTarget?.groupId === row.group.id &&
                  dropTarget.placement === "after" && <DropLine edge="bottom" />}
                <div
                  draggable={renamingGroupId !== row.group.id}
                  onDragStart={(event) => startGroupDrag(event, row.group)}
                  onDragEnd={finishDrag}
                  className="group/header text-muted-foreground flex h-5 cursor-grab items-center gap-1.5 px-1 text-[0.625rem] font-medium active:cursor-grabbing"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setGroupCollapsed(row.group.id, !row.group.collapsed)
                    }
                    className="hover:text-sidebar-foreground flex size-3 shrink-0 items-center justify-center transition-colors"
                    aria-label={`${row.group.collapsed ? "Expand" : "Collapse"} ${getGroupTitle(row.group)}`}
                    aria-expanded={!row.group.collapsed}
                    title={row.group.collapsed ? "Expand" : "Collapse"}
                  >
                    <ChevronRight
                      className={cn(
                        "size-3 transition-transform",
                        !row.group.collapsed && "rotate-90",
                      )}
                    />
                  </button>
                  {renamingGroupId === row.group.id ? (
                    <input
                      autoFocus
                      value={groupNameDraft}
                      onChange={(event) =>
                        setGroupNameDraft(event.target.value)
                      }
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
                  <span className="tabular-nums group-hover/header:hidden">
                    {row.group.tabs.length}
                  </span>
                  <div className="hidden items-center gap-0.5 group-hover/header:flex">
                    <button
                      type="button"
                      onClick={() => ungroupGroup(row.group.id)}
                      className="hover:bg-background/80 hover:text-sidebar-foreground flex size-4 items-center justify-center rounded-sm transition-colors"
                      aria-label={`Ungroup ${getGroupTitle(row.group)}`}
                      title="Ungroup"
                    >
                      <Ungroup className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteGroup(row.group.id)}
                      className="hover:bg-destructive/15 hover:text-destructive flex size-4 items-center justify-center rounded-sm transition-colors"
                      aria-label={`Delete ${getGroupTitle(row.group)}`}
                      title="Delete group"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-0.5">
                  <AnimatePresence initial={false}>
                    {!row.group.collapsed &&
                      row.group.tabs.map((tab) => (
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
                          onDragStart={(event) => startTabDrag(event, tab)}
                          onDragEnd={finishDrag}
                          onDragOver={(event) => updateTabDropTarget(event, tab)}
                          onDrop={(event) => dropOnTab(event, tab)}
                        />
                      ))}
                  </AnimatePresence>
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
                onDragStart={(event) => startTabDrag(event, row.tab)}
                onDragEnd={finishDrag}
                onDragOver={(event) => onStandaloneDragOver(event, row.tab)}
                onDrop={(event) => onStandaloneDrop(event, row.tab)}
              />
            ),
          )}
        </AnimatePresence>
      </LayoutGroup>
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
        "group relative h-7 w-full rounded-md transition-colors",
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
          className="sidebar-active-row absolute inset-0 block rounded-md"
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

function getEdgePlacement(event: DragEvent<HTMLElement>): "before" | "after" {
  const rect = event.currentTarget.getBoundingClientRect();
  return (event.clientY - rect.top) / rect.height < 0.5 ? "before" : "after";
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
    if (emittedGroups.has(tab.groupId)) continue;
    emittedGroups.add(tab.groupId);
    rows.push({
      type: "group",
      group: {
        id: tab.groupId,
        name:
          groupTabs.find((groupTab) => groupTab.groupName)?.groupName ?? null,
        collapsed: groupTabs.some((groupTab) => groupTab.groupCollapsed),
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
