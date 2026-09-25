import { confirm } from "@netnyahoo/shell";
import { create } from "zustand";
import { focus, openWindow } from "../../lib/actions";
import { folderLinks } from "../../store/bookmarks";
import { useBrowser } from "../../store/browser";
import { activeTabId, bookmarkProfileId, resolveWindowId, viewTabIds } from "../../store/model";

/** How a click on a bookmark opens it (Dia/Chrome modifier conventions). */
export type OpenMode = "current" | "background" | "foreground" | "window" | "incognito" | "split";

/** ⌘ / middle-click: background tab (⇧⌘: foreground) · ⇧: new window · ⌥: split pane. */
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
    const created = openWindow({ url, profileId: w && !w.incognito ? w.profileId : undefined });
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

/** Open All: every link in a folder, in new tabs (Chrome asks first past 15). */
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
  if (mode !== "tabs" || !id) {
    const created = openWindow({ url: links[0]!.url, incognito: mode === "incognito" });
    for (const link of links.slice(1)) useBrowser.getState().newTab(created, { url: link.url, background: true });
    return focus(created);
  }
  links.forEach((link, i) => useBrowser.getState().newTab(id, { url: link.url, background: i > 0 }));
}

/** The profile whose bookmarks a window shows (incognito windows use the default profile's). */
export function windowBookmarkProfile(windowId: string | null | undefined): string {
  const s = useBrowser.getState();
  const id = resolveWindowId(s, windowId);
  return bookmarkProfileId(s, id ? s.windows[id] : undefined);
}

/** The save dialog (⌘D, Bookmark All Tabs…) — one per window at a time. */
export type BookmarkDialogState =
  | { kind: "page"; windowId: string; bookmarkId: string }
  | { kind: "allTabs"; windowId: string; profileId: string; tabs: { url: string; title: string }[] };

export const useBookmarkDialog = create<{ open: BookmarkDialogState | null; set(open: BookmarkDialogState | null): void }>((set) => ({
  open: null,
  set: (open) => set({ open }),
}));

/**
 * ⌘D (Tabs › Add to Bookmarks…): bookmarks the page right away, like Dia and
 * Chrome, then shows the dialog to rename it or pick a folder. An already
 * bookmarked page opens the dialog on its existing bookmark.
 */
export function bookmarkActivePage(windowId: string | null | undefined) {
  const s = useBrowser.getState();
  const id = resolveWindowId(s, windowId);
  const tabId = id ? activeTabId(s, id) : undefined;
  if (id && tabId) bookmarkTab(id, tabId);
}

/** ⌘D for any tab (the tab menu's Add to Bookmarks…): bookmark it, then the dialog. */
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

/** Bookmarks › Bookmark All Tabs…: a new folder with the window's tabs. */
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
