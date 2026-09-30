import { confirm } from "@netnyahoo/shell";
import { create } from "zustand";
import { focus, openWindow } from "../../lib/actions";
import { folderLinks } from "../../store/bookmarks";
import { useBrowser } from "../../store/browser";
import { activeTabId, bookmarkProfileId, resolveWindowId, viewTabIds } from "../../store/model";

export type OpenMode = "current" | "background" | "foreground" | "window" | "incognito" | "split";

export function openModeFor(e: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean }): OpenMode {
  if (e.metaKey || e.middle) return e.shiftKey ? "foreground" : "background";
  if (e.altKey) return "split";
  if (e.shiftKey) return "window";
  return "current";
}

export function openUrl(url: string, windowId: string | null | undefined, mode: OpenMode) {
  const s = useBrowser.getState();
  const id = resolveWindowId(s, windowId);
  if (mode === "incognito") return void openWindow({ incognito: true, url });
  if (!id || mode === "window") {
    const w = id ? s.windows[id] : undefined;
    // From a private window, a new window stays private.
    const created = openWindow(w?.incognito ? { incognito: true, url } : { url, profileId: w?.profileId });
    return focus(created);
  }
  const tabId = activeTabId(s, id);
  if (mode === "split") {
    const result = s.openSplitPane(id, { url });
    if (result.ok) return;
    return void s.newTab(id, { url });
  }
  if (mode === "current" && tabId) return s.navigate(tabId, url);
  s.newTab(id, { url, background: mode === "background", openerId: mode === "background" ? tabId : undefined });
}

export async function openFolder(folderId: string, windowId: string | null | undefined, mode: "tabs" | "window" | "incognito" = "tabs") {
  const s = useBrowser.getState();
  const links = folderLinks(s.bookmarks, folderId);
  if (!links.length) return;
  if (links.length > 15) {
    const { confirmed } = await confirm({
      title: `Open ${links.length} tabs?`,
      message: "This folder has a lot of bookmarks.",
      confirmTitle: "Open All",
      windowId: resolveWindowId(s, windowId),
    });
    if (!confirmed) return;
  }
  const id = resolveWindowId(s, windowId);
  const source = id ? s.windows[id] : undefined;
  if (mode !== "tabs" || !id) {
    const incognito = mode === "incognito" || !!source?.incognito;
    const created = openWindow({ url: links[0]!.url, incognito, profileId: incognito ? undefined : source?.profileId });
    openInOrder(created, links.slice(1), activeTabId(useBrowser.getState(), created));
    return focus(created);
  }
  const first = useBrowser.getState().newTab(id, { url: links[0]!.url });
  openInOrder(id, links.slice(1), first);
}

// The folder's order, whatever the new-tab position setting.
function openInOrder(windowId: string, links: { url: string }[], after: string | undefined) {
  for (const link of links) {
    const tabIds = useBrowser.getState().windows[windowId]?.tabIds ?? [];
    const index = after && tabIds.includes(after) ? tabIds.indexOf(after) + 1 : undefined;
    after = useBrowser.getState().newTab(windowId, { url: link.url, background: true, index }) || after;
  }
}

export type BookmarkDialogState =
  | { kind: "page"; windowId: string; bookmarkId: string }
  | { kind: "allTabs"; windowId: string; profileId: string; tabs: { url: string; title: string }[] };

export const useBookmarkDialog = create<{ open: BookmarkDialogState | null; set(open: BookmarkDialogState | null): void }>((set) => ({
  open: null,
  set: (open) => set({ open }),
}));

export function bookmarkActivePage(windowId: string | null | undefined) {
  const s = useBrowser.getState();
  const id = resolveWindowId(s, windowId);
  const tabId = id ? activeTabId(s, id) : undefined;
  if (id && tabId) bookmarkTab(id, tabId);
}

export function bookmarkTab(windowId: string, tabId: string) {
  const s = useBrowser.getState();
  const id = windowId;
  const tab = s.tabs[tabId];
  if (!s.windows[id] || !tab?.url) return;
  const profileId = bookmarkProfileId(s, s.windows[id]);
  const roots = s.bookmarks.roots[profileId];
  const existing = Object.values(s.bookmarks.nodes).find(
    (n) => n.kind === "url" && n.url === tab.url && roots && isUnder(n.id, [roots.bar, roots.other]),
  );
  const bookmarkId =
    existing?.id ?? s.addBookmark({ profileId, url: tab.url, title: tab.customTitle || tab.title || tab.url, favicon: tab.favicon });
  useBookmarkDialog.getState().set({ kind: "page", windowId: id, bookmarkId });
}

export function bookmarkAllTabs(windowId: string | null | undefined) {
  const s = useBrowser.getState();
  const id = resolveWindowId(s, windowId);
  if (!id) return;
  const tabs = viewTabIds(s, id)
    .map((t) => s.tabs[t]!)
    .filter((t) => /^(https?|file):/.test(t.url))
    .map((t) => ({ url: t.url, title: t.customTitle || t.title || t.url }));
  if (!tabs.length) return;
  useBookmarkDialog.getState().set({ kind: "allTabs", windowId: id, profileId: bookmarkProfileId(s, s.windows[id]), tabs });
}

function isUnder(id: string, roots: string[]): boolean {
  const { nodes } = useBrowser.getState().bookmarks;
  let node = nodes[id];
  for (let i = 0; node && i < 64; i++) {
    if (roots.includes(node.id)) return true;
    node = node.parentId ? nodes[node.parentId] : undefined;
  }
  return false;
}
