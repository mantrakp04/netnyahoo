import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  INTERNAL_PAGE_URLS,
  getInternalPage,
  getInternalPageTitle,
  isInternalPageUrl,
  type InternalPage,
} from "@/lib/internal-pages";
import { useTRPC } from "@/lib/trpc";
import { toUrl } from "@/lib/utils";
import type { Tab } from "@netnyahoo/db";
import type { WebviewTag } from "@/types/webview";

type SerializedTab = Omit<Tab, "createdAt" | "lastAccessedAt"> & {
  createdAt: string;
  lastAccessedAt: string;
};

export type BrowserTab = SerializedTab & {
  groupName: string | null;
  groupCollapsed: boolean | null;
};

interface NavState {
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

type ClosedTab = Pick<Tab, "title" | "url" | "favicon" | "groupId" | "pinned">;
type CreateTabInput = {
  spaceId: string;
  url?: string;
  title?: string;
  favicon?: string | null;
  groupId?: string | null;
  pinned?: boolean;
  activate?: boolean;
};

interface BrowserContextValue {
  spaceId: string | undefined;
  spaceName: string;
  tabs: BrowserTab[];
  activeTab: BrowserTab | undefined;
  recentlyClosedTabs: ClosedTab[];
  nav: NavState;
  newTabAnimationId: string | null;
  newTabDrafts: Record<string, string>;
  setNewTabDraft: (id: string, value: string) => void;
  registerWebview: (id: string, el: WebviewTag | null) => void;
  setNav: (id: string, state: Partial<NavState>) => void;
  finishNewTabAnimation: (id: string) => void;
  openTab: (input?: string) => void;
  reopenClosedTab: () => void;
  openInternalPage: (page: InternalPage) => void;
  activateTab: (id: string) => void;
  activateNextTab: () => void;
  activatePreviousTab: () => void;
  closeTab: (id: string) => void;
  togglePinActiveTab: () => void;
  duplicateActiveTab: () => void;
  createGroupWithActiveTab: () => void;
  renameActiveTab: () => void;
  moveTab: (input: {
    id: string;
    targetId?: string;
    placement: "before" | "after" | "group" | "end";
  }) => void;
  moveGroup: (input: {
    id: string;
    targetId?: string;
    placement: "before" | "after" | "end";
  }) => void;
  renameGroup: (id: string, name: string) => void;
  setGroupCollapsed: (id: string, collapsed: boolean) => void;
  ungroupGroup: (id: string) => void;
  deleteGroup: (id: string) => void;
  patchTab: (
    id: string,
    patch: Partial<Pick<Tab, "title" | "url" | "favicon">>,
  ) => void;
  recordVisit: (entry: { url: string; title: string; favicon?: string | null }) => void;
  updateHistoryFavicon: (entry: { url: string; favicon: string }) => void;
  navigate: (input: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
}

const BrowserContext = createContext<BrowserContextValue | null>(null);

export function BrowserProvider({ children }: { children: ReactNode }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const webviews = useRef(new Map<string, WebviewTag | null>());
  const createTabQueue = useRef<Promise<void>>(Promise.resolve());
  const recentlyClosedTabsRef = useRef<ClosedTab[]>([]);
  const [navByTab, setNavByTab] = useState<Record<string, NavState>>({});
  const [recentlyClosedTabs, setRecentlyClosedTabs] = useState<ClosedTab[]>([]);
  const [newTabAnimationId, setNewTabAnimationId] = useState<string | null>(null);
  // Per-tab new-tab search drafts so switching tabs doesn't wipe what was typed.
  const [newTabDrafts, setNewTabDrafts] = useState<Record<string, string>>({});

  const spacesQuery = useQuery(trpc.spaces.list.queryOptions());
  const spaceId = spacesQuery.data?.[0]?.id;
  const spaceName = spacesQuery.data?.[0]?.name ?? "Space";

  const tabsQuery = useQuery(
    trpc.tabs.list.queryOptions(
      { spaceId: spaceId ?? "" },
      { enabled: !!spaceId },
    ),
  );
  const tabs = useMemo(() => tabsQuery.data ?? [], [tabsQuery.data]);
  const activeTab = tabs.find((t) => t.active) ?? tabs[tabs.length - 1];

  const invalidateTabs = useCallback(
    () => qc.invalidateQueries({ queryKey: trpc.tabs.list.queryKey() }),
    [qc, trpc.tabs.list],
  );

  // Tab mutations refetch the list on success — the local IPC + sqlite round-trip
  // is fast and the DB is the single source of truth. (Optimistic cache writes
  // were tried but accumulated phantom rows on rapid creates; snappiness comes
  // from not blocking on UI animation, not from the cache.) onMutate cancels any
  // in-flight list refetch so a stale one can't land after a newer write and
  // resurrect a just-closed tab.
  const cancelTabsRefetch = useCallback(
    () => qc.cancelQueries({ queryKey: trpc.tabs.list.queryKey() }),
    [qc, trpc.tabs.list],
  );
  const createTab = useMutation(
    trpc.tabs.create.mutationOptions({
      onMutate: cancelTabsRefetch,
      onSuccess: (tab) => {
        if (tab.url === "about:blank") setNewTabAnimationId(tab.id);
        return invalidateTabs();
      },
    }),
  );
  const activateMut = useMutation(
    trpc.tabs.activate.mutationOptions({
      onMutate: cancelTabsRefetch,
      onSuccess: invalidateTabs,
    }),
  );
  const closeMut = useMutation(
    trpc.tabs.close.mutationOptions({
      onMutate: cancelTabsRefetch,
      onSuccess: invalidateTabs,
    }),
  );
  const moveMut = useMutation(
    trpc.tabs.move.mutationOptions({
      onMutate: cancelTabsRefetch,
      onSuccess: invalidateTabs,
    }),
  );
  const moveGroupMut = useMutation(
    trpc.tabs.moveGroup.mutationOptions({
      onMutate: cancelTabsRefetch,
      onSuccess: invalidateTabs,
    }),
  );
  const renameGroupMut = useMutation(trpc.tabs.renameGroup.mutationOptions());
  const setGroupCollapsedMut = useMutation(
    trpc.tabs.setGroupCollapsed.mutationOptions(),
  );
  const createGroupWithTabMut = useMutation(
    trpc.tabs.createGroupWithTab.mutationOptions({
      onMutate: cancelTabsRefetch,
      onSuccess: invalidateTabs,
    }),
  );
  const ungroupMut = useMutation(
    trpc.tabs.ungroup.mutationOptions({
      onMutate: cancelTabsRefetch,
      onSuccess: invalidateTabs,
    }),
  );
  const deleteGroupMut = useMutation(
    trpc.tabs.deleteGroup.mutationOptions({
      onMutate: cancelTabsRefetch,
      onSuccess: invalidateTabs,
    }),
  );
  const updateMut = useMutation(trpc.tabs.update.mutationOptions());
  const invalidateHistory = useCallback(
    () => qc.invalidateQueries({ queryKey: trpc.history.list.queryKey() }),
    [qc, trpc.history.list],
  );
  const recordMut = useMutation(
    trpc.history.record.mutationOptions({ onSuccess: invalidateHistory }),
  );
  const updateHistoryFaviconMut = useMutation(
    trpc.history.updateFavicon.mutationOptions({
      onSuccess: invalidateHistory,
    }),
  );
  const enqueueCreateTab = useCallback(
    (input: CreateTabInput) => {
      const request = createTabQueue.current.then(() =>
        createTab.mutateAsync(input),
      );
      createTabQueue.current = request
        .catch(() => undefined)
        .then(() => undefined);
      return request;
    },
    [createTab],
  );

  const registerWebview = useCallback((id: string, el: WebviewTag | null) => {
    webviews.current.set(id, el);
  }, []);

  const setNav = useCallback((id: string, state: Partial<NavState>) => {
    setNavByTab((prev) => ({
      ...prev,
      [id]: {
        loading: false,
        canGoBack: false,
        canGoForward: false,
        ...prev[id],
        ...state,
      },
    }));
  }, []);

  const finishNewTabAnimation = useCallback((id: string) => {
    setNewTabAnimationId((current) => (current === id ? null : current));
  }, []);

  const setNewTabDraft = useCallback((id: string, value: string) => {
    setNewTabDrafts((prev) =>
      prev[id] === value ? prev : { ...prev, [id]: value },
    );
  }, []);

  const openTab = useCallback(
    (input?: string) => {
      if (!spaceId) return;
      const url = input ? toUrl(input) : "about:blank";
      const internalPage = getInternalPage(url);

      void enqueueCreateTab({
        spaceId,
        url,
        title: internalPage ? getInternalPageTitle(internalPage) : "New Tab",
        activate: true,
      }).catch(() => undefined);
    },
    [enqueueCreateTab, spaceId],
  );

  const openInternalPage = useCallback(
    (page: InternalPage) => {
      const url = INTERNAL_PAGE_URLS[page];
      const existing = tabs.find((tab) => tab.url === url);
      if (existing) {
        activateMut.mutate({ id: existing.id });
        return;
      }
      openTab(url);
    },
    [activateMut, openTab, tabs],
  );

  const reopenClosedTab = useCallback(() => {
    if (!spaceId) return;
    const tab = recentlyClosedTabsRef.current[0];
    if (!tab) return;
    recentlyClosedTabsRef.current = recentlyClosedTabsRef.current.slice(1);
    setRecentlyClosedTabs(recentlyClosedTabsRef.current);

    void enqueueCreateTab({
      spaceId,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      groupId: tab.groupId,
      pinned: tab.pinned,
      activate: true,
    }).catch(() => {
      recentlyClosedTabsRef.current = [tab, ...recentlyClosedTabsRef.current];
      setRecentlyClosedTabs(recentlyClosedTabsRef.current);
    });
  }, [enqueueCreateTab, spaceId]);

  const activateTab = useCallback(
    (id: string) => activateMut.mutate({ id }),
    [activateMut],
  );
  const activateTabByOffset = useCallback(
    (offset: number) => {
      if (tabs.length < 2) return;
      const activeIndex = Math.max(
        0,
        tabs.findIndex((tab) => tab.id === activeTab?.id),
      );
      const nextIndex = (activeIndex + offset + tabs.length) % tabs.length;
      const nextTab = tabs[nextIndex];
      if (nextTab) activateMut.mutate({ id: nextTab.id });
    },
    [activateMut, activeTab?.id, tabs],
  );
  const activateNextTab = useCallback(
    () => activateTabByOffset(1),
    [activateTabByOffset],
  );
  const activatePreviousTab = useCallback(
    () => activateTabByOffset(-1),
    [activateTabByOffset],
  );
  const togglePinActiveTab = useCallback(() => {
    if (!activeTab) return;
    qc.setQueriesData(
      { queryKey: trpc.tabs.list.queryKey() },
      (old: BrowserTab[] | undefined) =>
        old?.map((tab) =>
          tab.id === activeTab.id ? { ...tab, pinned: !activeTab.pinned } : tab,
        ),
    );
    updateMut.mutate(
      { id: activeTab.id, pinned: !activeTab.pinned },
      { onError: () => void invalidateTabs() },
    );
  }, [activeTab, invalidateTabs, qc, trpc.tabs.list, updateMut]);
  const duplicateActiveTab = useCallback(() => {
    if (!activeTab || !spaceId) return;
    void enqueueCreateTab({
      spaceId,
      url: activeTab.url,
      title: activeTab.title,
      favicon: activeTab.favicon,
      groupId: activeTab.groupId,
      pinned: activeTab.pinned,
      activate: true,
    }).catch(() => undefined);
  }, [activeTab, enqueueCreateTab, spaceId]);
  const createGroupWithActiveTab = useCallback(() => {
    if (!activeTab) return;
    createGroupWithTabMut.mutate({
      id: activeTab.id,
      name: activeTab.title?.trim() || "Tab Group",
    });
  }, [activeTab, createGroupWithTabMut]);
  const closeTab = useCallback(
    (id: string) => {
      const tab = tabs.find((candidate) => candidate.id === id);
      const isLastTab = tabs.length === 1 && tabs[0]?.id === id;
      webviews.current.delete(id);
      setNewTabAnimationId((current) => (current === id ? null : current));
      setNewTabDrafts((prev) => {
        if (!(id in prev)) return prev;
        const { [id]: _, ...rest } = prev;
        return rest;
      });
      closeMut.mutate(
        { id },
        {
          onSuccess: () => {
            if (tab) {
              recentlyClosedTabsRef.current = [
                {
                  title: tab.title,
                  url: tab.url,
                  favicon: tab.favicon,
                  groupId: tab.groupId,
                  pinned: tab.pinned,
                },
                ...recentlyClosedTabsRef.current,
              ].slice(0, 12);
              setRecentlyClosedTabs(recentlyClosedTabsRef.current);
            }
            if (isLastTab) window.close();
          },
        },
      );
    },
    [closeMut, tabs],
  );
  const moveTab = useCallback(
    (input: {
      id: string;
      targetId?: string;
      placement: "before" | "after" | "group" | "end";
    }) => {
      if (input.id === input.targetId) return;
      moveMut.mutate(input);
    },
    [moveMut],
  );
  const moveGroup = useCallback(
    (input: {
      id: string;
      targetId?: string;
      placement: "before" | "after" | "end";
    }) => moveGroupMut.mutate(input),
    [moveGroupMut],
  );
  const renameGroup = useCallback(
    (id: string, name: string) => {
      const nextName = name.trim();
      if (!nextName) return;

      qc.setQueriesData(
        { queryKey: trpc.tabs.list.queryKey() },
        (old: BrowserTab[] | undefined) =>
          old?.map((tab) =>
            tab.groupId === id ? { ...tab, groupName: nextName } : tab,
          ),
      );
      renameGroupMut.mutate(
        { id, name: nextName },
        { onError: () => void invalidateTabs() },
      );
    },
    [invalidateTabs, qc, renameGroupMut, trpc.tabs.list],
  );

  const setGroupCollapsed = useCallback(
    (id: string, collapsed: boolean) => {
      qc.setQueriesData(
        { queryKey: trpc.tabs.list.queryKey() },
        (old: BrowserTab[] | undefined) =>
          old?.map((tab) =>
            tab.groupId === id ? { ...tab, groupCollapsed: collapsed } : tab,
          ),
      );
      setGroupCollapsedMut.mutate(
        { id, collapsed },
        { onError: () => void invalidateTabs() },
      );
    },
    [invalidateTabs, qc, setGroupCollapsedMut, trpc.tabs.list],
  );

  const ungroupGroup = useCallback(
    (id: string) => ungroupMut.mutate({ id }),
    [ungroupMut],
  );
  const deleteGroup = useCallback(
    (id: string) => {
      const isLastTabs = tabs.every((tab) => tab.groupId === id);
      deleteGroupMut.mutate(
        { id },
        { onSuccess: () => isLastTabs && window.close() },
      );
    },
    [deleteGroupMut, tabs],
  );

  const patchTab = useCallback(
    (id: string, patch: Partial<Pick<Tab, "title" | "url" | "favicon">>) => {
      // Optimistically update the cached list so the sidebar stays in sync
      // without a round-trip per keystroke of in-page navigation.
      qc.setQueriesData(
        { queryKey: trpc.tabs.list.queryKey() },
        (old: BrowserTab[] | undefined) =>
          old?.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
      updateMut.mutate({ id, ...patch });
    },
    [qc, trpc.tabs.list, updateMut],
  );

  const renameActiveTab = useCallback(() => {
    if (!activeTab) return;
    const nextTitle = window.prompt("Rename tab", activeTab.title || activeTab.url);
    if (nextTitle == null) return;
    const title = nextTitle.trim();
    if (!title) return;
    patchTab(activeTab.id, { title });
  }, [activeTab, patchTab]);

  const recordVisit = useCallback(
    (entry: { url: string; title: string; favicon?: string | null }) => {
      if (isInternalPageUrl(entry.url)) return;
      recordMut.mutate(entry);
    },
    [recordMut],
  );

  const updateHistoryFavicon = useCallback(
    (entry: { url: string; favicon: string }) => {
      if (isInternalPageUrl(entry.url)) return;
      updateHistoryFaviconMut.mutate(entry);
    },
    [updateHistoryFaviconMut],
  );

  const navigate = useCallback(
    (input: string) => {
      const url = toUrl(input);
      const internalPage = getInternalPage(url);
      if (activeTab) {
        if (internalPage) {
          patchTab(activeTab.id, {
            url,
            title: getInternalPageTitle(internalPage),
            favicon: null,
          });
          return;
        }
        const el = webviews.current.get(activeTab.id);
        if (el) {
          try {
            el.loadURL(url);
          } catch {
            // Guest not ready yet (brand-new tab) — load as soon as it is.
            el.addEventListener(
              "dom-ready",
              () => {
                try {
                  el.loadURL(url);
                } catch {
                  /* ignore */
                }
              },
              { once: true },
            );
          }
        }
        patchTab(activeTab.id, { url, favicon: null });
      } else {
        openTab(input);
      }
    },
    [activeTab, patchTab, openTab],
  );

  const withActive = useCallback(
    (fn: (el: WebviewTag) => void) => {
      if (!activeTab) return;
      const el = webviews.current.get(activeTab.id);
      if (el) fn(el);
    },
    [activeTab],
  );

  const goBack = useCallback(() => withActive((el) => el.goBack()), [withActive]);
  const goForward = useCallback(
    () => withActive((el) => el.goForward()),
    [withActive],
  );
  const reload = useCallback(() => withActive((el) => el.reload()), [withActive]);

  const nav = (activeTab && navByTab[activeTab.id]) || {
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };

  const value: BrowserContextValue = {
    spaceId,
    spaceName,
    tabs,
    activeTab,
    recentlyClosedTabs,
    nav,
    newTabAnimationId,
    newTabDrafts,
    setNewTabDraft,
    registerWebview,
    setNav,
    finishNewTabAnimation,
    openTab,
    reopenClosedTab,
    openInternalPage,
    activateTab,
    activateNextTab,
    activatePreviousTab,
    closeTab,
    togglePinActiveTab,
    duplicateActiveTab,
    createGroupWithActiveTab,
    renameActiveTab,
    moveTab,
    moveGroup,
    renameGroup,
    setGroupCollapsed,
    ungroupGroup,
    deleteGroup,
    patchTab,
    recordVisit,
    updateHistoryFavicon,
    navigate,
    goBack,
    goForward,
    reload,
  };

  return (
    <BrowserContext.Provider value={value}>{children}</BrowserContext.Provider>
  );
}

export function useBrowser() {
  const ctx = useContext(BrowserContext);
  if (!ctx) throw new Error("useBrowser must be used within BrowserProvider");
  return ctx;
}
