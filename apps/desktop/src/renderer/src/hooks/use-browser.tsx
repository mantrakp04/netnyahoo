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
import { useTRPC } from "@/lib/trpc";
import { toUrl } from "@/lib/utils";
import type { Tab } from "@netnyahoo/db";
import type { WebviewTag } from "@/types/webview";

interface NavState {
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface BrowserContextValue {
  spaceId: string | undefined;
  spaceName: string;
  tabs: Tab[];
  activeTab: Tab | undefined;
  nav: NavState;
  registerWebview: (id: string, el: WebviewTag | null) => void;
  getWebview: (id: string) => WebviewTag | null;
  setNav: (id: string, state: Partial<NavState>) => void;
  openTab: (input?: string) => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  patchTab: (
    id: string,
    patch: Partial<Pick<Tab, "title" | "url" | "favicon">>,
  ) => void;
  recordVisit: (entry: { url: string; title: string; favicon?: string | null }) => void;
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
  const openTabGate = useRef<{ signature: string; at: number } | null>(null);
  const [navByTab, setNavByTab] = useState<Record<string, NavState>>({});

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

  const createTab = useMutation(
    trpc.tabs.create.mutationOptions({ onSuccess: invalidateTabs }),
  );
  const activateMut = useMutation(
    trpc.tabs.activate.mutationOptions({ onSuccess: invalidateTabs }),
  );
  const closeMut = useMutation(
    trpc.tabs.close.mutationOptions({ onSuccess: invalidateTabs }),
  );
  const updateMut = useMutation(trpc.tabs.update.mutationOptions());
  const recordMut = useMutation(trpc.history.record.mutationOptions());

  const registerWebview = useCallback((id: string, el: WebviewTag | null) => {
    webviews.current.set(id, el);
  }, []);
  const getWebview = useCallback(
    (id: string) => webviews.current.get(id) ?? null,
    [],
  );

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

  const openTab = useCallback(
    (input?: string) => {
      if (!spaceId) return;
      const url = input ? toUrl(input) : "about:blank";
      const signature = `${spaceId}:${url}`;
      const now = Date.now();
      const recentOpen = openTabGate.current;

      if (recentOpen?.signature === signature && now - recentOpen.at < 500) {
        return;
      }

      openTabGate.current = { signature, at: now };
      createTab.mutate({ spaceId, url, activate: true });
    },
    [spaceId, createTab],
  );

  const activateTab = useCallback(
    (id: string) => activateMut.mutate({ id }),
    [activateMut],
  );
  const closeTab = useCallback(
    (id: string) => {
      webviews.current.delete(id);
      closeMut.mutate({ id });
    },
    [closeMut],
  );

  const patchTab = useCallback(
    (id: string, patch: Partial<Pick<Tab, "title" | "url" | "favicon">>) => {
      // Optimistically update the cached list so the sidebar stays in sync
      // without a round-trip per keystroke of in-page navigation.
      qc.setQueriesData(
        { queryKey: trpc.tabs.list.queryKey() },
        (old: Tab[] | undefined) =>
          old?.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
      updateMut.mutate({ id, ...patch });
    },
    [qc, trpc.tabs.list, updateMut],
  );

  const recordVisit = useCallback(
    (entry: { url: string; title: string; favicon?: string | null }) => {
      recordMut.mutate(entry);
    },
    [recordMut],
  );

  const navigate = useCallback(
    (input: string) => {
      const url = toUrl(input);
      if (activeTab) {
        const el = webviews.current.get(activeTab.id);
        if (el) el.loadURL(url);
        patchTab(activeTab.id, { url });
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
    nav,
    registerWebview,
    getWebview,
    setNav,
    openTab,
    activateTab,
    closeTab,
    patchTab,
    recordVisit,
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
