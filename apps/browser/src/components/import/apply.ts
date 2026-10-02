import { savePassword } from "@netnyahoo/nncore";
import type { BookmarkNode as ImportedNode, Credential, DiaTabsProfile, ImportedTab, ImportKind, ImportResult, SafariExport, SpaceSuggestion } from "@netnyahoo/import";
import type { BookmarkDraft } from "../../store/bookmarks";
import { useBrowser } from "../../store/browser";
import { engineProfile, isIncognitoProfile } from "../../store/model";
import { withNewTab } from "../../store/tabs";
import type { ProfileColor } from "../../store/types";
import { importModule } from "./module";

export type ImportCounts = { bookmarks: number; history: number; tabs: number; passwords: number; cookies: number; addresses: number; cards: number };

export const emptyCounts = (): ImportCounts => ({ bookmarks: 0, history: 0, tabs: 0, passwords: 0, cookies: 0, addresses: 0, cards: 0 });

const toDraft = (n: ImportedNode): BookmarkDraft =>
  n.type === "url"
    ? { title: n.title || n.url || "", url: n.url ?? "", addedAt: n.dateAdded }
    : { title: n.title, addedAt: n.dateAdded, children: (n.children ?? []).map(toDraft) };

const linkCount = (nodes: ImportedNode[]): number => nodes.reduce((n, c) => n + (c.type === "url" ? 1 : linkCount(c.children ?? [])), 0);

export function importBookmarks(profileId: string, root: ImportedNode | undefined, browserName: string): number {
  if (!root?.children?.length) return 0;
  if (!useBrowser.getState().bookmarks.roots[profileId]) useBrowser.getState().addBookmarkTree(profileId, []);
  const roots = useBrowser.getState().bookmarks.roots[profileId]!;
  const toolbar = root.children.filter((c) => c.role === "toolbar").flatMap((c) => c.children ?? []);
  const rest = root.children.filter((c) => c.role !== "toolbar");
  const other = rest.flatMap((c) => (c.role === "other" || !c.role ? (c.type === "folder" ? (c.children ?? []) : [c]) : [c]));
  const title = `Imported from ${browserName}`;
  const place = (nodes: ImportedNode[], parentId: string) => {
    if (!nodes.length) return;
    const parent = useBrowser.getState().bookmarks.nodes[parentId];
    const empty = parent?.kind === "folder" && parent.children.length === 0;
    const drafts = nodes.map(toDraft);
    useBrowser.getState().addBookmarkTree(profileId, empty ? drafts : [{ title, children: drafts }], parentId);
  };
  place(toolbar, roots.bar);
  place(other, roots.other);
  return linkCount([...toolbar, ...other]);
}

export function importSafariBookmarks(profileId: string, root: ImportedNode | undefined): number {
  return importBookmarks(profileId, root, "Safari");
}

export function importHistory(profileId: string, entries: { url: string; title: string; visits: number; lastVisit: number }[]): number {
  const before = useBrowser.getState().history[profileId]?.length ?? 0;
  useBrowser.getState().importHistory(profileId, entries);
  return (useBrowser.getState().history[profileId]?.length ?? 0) - before;
}

export async function importPasswords(profileId: string, credentials: Credential[]): Promise<number> {
  let saved = 0;
  for (const c of credentials) {
    const origin = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(c.realm?.startsWith("http") ? c.realm : c.url)?.[1];
    if (!origin || !c.password) continue;
    if (await savePassword(engineProfile(profileId), origin, c.username, c.password).catch(() => false)) saved++;
  }
  return saved;
}

/** Writes the cookies, addresses and cards an import kept natively (their values never reach JS) into the profile.
 * Never into a private profile: the token is dropped instead. `onFailed` hears the kinds the engine refused. */
export async function importNative(
  profileId: string,
  token: string | undefined,
  kinds: ("cookies" | "autofill")[],
  onFailed?: (kind: ImportKind) => void,
): Promise<Pick<ImportCounts, "cookies" | "addresses" | "cards">> {
  const none = { cookies: 0, addresses: 0, cards: 0 };
  const api = importModule();
  if (!api || !token) return none;
  if (!kinds.length || isIncognitoProfile(profileId) || useBrowser.getState().profiles[profileId] === undefined) {
    api.discardImported(token);
    return none;
  }
  try {
    const w = await api.writeImported(token, engineProfile(profileId), kinds);
    if (w.cookiesFailed) onFailed?.("cookies");
    if (w.autofillFailed) onFailed?.("autofill");
    return { cookies: w.cookies, addresses: w.addresses, cards: w.cards };
  } catch {
    kinds.forEach((k) => onFailed?.(k));
    return none;
  }
}

function windowFor(profileId: string): string {
  const s = useBrowser.getState();
  const regular = s.ui.focusOrder.find((id) => s.windows[id] && !s.windows[id]!.incognito) ?? s.windowOrder.find((id) => !s.windows[id]!.incognito);
  return regular ?? s.createWindow({ profileId });
}

/** Opens each extension's Chrome Web Store page in the profile, where the user adds the ones they want. */
export function openInWebStore(profileId: string, urls: string[]) {
  if (!urls.length) return;
  const windowId = windowFor(profileId);
  urls.forEach((url, i) => useBrowser.getState().newTab(windowId, { url, profileId, background: i > 0 }));
}

export function importTabs(profileId: string, tabs: Pick<ImportedTab, "url" | "title" | "pinned" | "customTitle">[], group: string | null): number {
  const usable = tabs.filter((t) => /^(https?|file):/.test(t.url));
  if (!usable.length) return 0;
  const windowId = windowFor(profileId);
  let s = useBrowser.getState();
  const unpinned: string[] = [];
  for (const t of usable) {
    const after = t.pinned ? undefined : unpinned.at(-1);
    const [next, id] = withNewTab(s, windowId, {
      url: t.url,
      profileId,
      background: true,
      pinned: t.pinned,
      snapshot: { title: t.title, customTitle: t.customTitle ?? null },
      index: after ? s.windows[windowId]!.tabIds.indexOf(after) + 1 : undefined,
    });
    if (!id) continue;
    s = { ...next, tabs: { ...next.tabs, [id]: { ...next.tabs[id]!, navigation: null } } };
    if (!t.pinned) unpinned.push(id);
  }
  useBrowser.setState(s);
  if (group && unpinned.length) useBrowser.getState().createGroup(unpinned, { name: group });
  return usable.length;
}

export function importArcSpace(profileId: string, space: SpaceSuggestion, spaceName: string): { tabs: number; bookmarks: number } {
  const links = space.pinned.filter((n) => n.type === "url" && n.url);
  const folders = space.pinned.filter((n) => n.type === "folder");
  let tabs = importTabs(
    profileId,
    links.map((n) => ({ url: n.url!, title: n.pageTitle ?? n.title, pinned: true, customTitle: n.pageTitle ? n.title : undefined })),
    null,
  );
  tabs += importTabs(profileId, space.tabs.map((t) => ({ ...t, pinned: false })), "Imported");
  let bookmarks = 0;
  if (folders.length) {
    const roots = useBrowser.getState().bookmarks.roots[profileId];
    if (roots) {
      useBrowser.getState().addBookmarkTree(profileId, [{ title: `${spaceName} (Arc)`, children: folders.map(toDraft) }], roots.bar);
      bookmarks = linkCount(folders);
    }
  }
  return { tabs, bookmarks };
}

function pageKey(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(url.trim());
  if (!m) return url;
  const rest = m[3]!.startsWith("/") ? m[3]! : `/${m[3]}`;
  return `${m[1]!.toLowerCase()}${m[2]!.toLowerCase()}${rest.replace(/#$/, "")}`;
}

export function importDiaProfile(profileId: string, profile: DiaTabsProfile, what: { pinned: boolean; open: boolean }): number {
  const have = new Set(
    Object.values(useBrowser.getState().tabs)
      .filter((t) => t.profileId === profileId)
      .flatMap((t) => [t.url, t.pinnedUrl ?? ""].filter(Boolean).map(pageKey)),
  );
  const fresh = (tabs: ImportedTab[]) => tabs.filter((t) => !have.has(pageKey(t.url)));
  let n = what.pinned ? importTabs(profileId, fresh(profile.pinned), null) : 0;
  if (what.open) n += importTabs(profileId, fresh(profile.tabs).map((t) => ({ ...t, pinned: false })), "Imported");
  return n;
}

export async function applyResult(
  profileId: string,
  result: ImportResult,
  browserName: string,
  onFailed?: (kind: ImportKind) => void,
): Promise<ImportCounts> {
  const counts = emptyCounts();
  counts.bookmarks += importBookmarks(profileId, result.bookmarks, browserName);
  if (result.history.length) counts.history += importHistory(profileId, result.history);
  // Sign-ins first, so the imported tabs load signed in.
  Object.assign(counts, await importNative(profileId, result.vaultToken, ["cookies", "autofill"], onFailed));
  if (result.tabs.length && !result.spaces.length) counts.tabs += importTabs(profileId, result.tabs, "Imported");
  if (result.favorites.length) counts.tabs += importTabs(profileId, result.favorites.map((t) => ({ ...t, pinned: true })), null);
  if (result.credentials.length) counts.passwords += await importPasswords(profileId, result.credentials);
  return counts;
}

/** `cookies`: whether the user kept Safari's cookies ticked (the export file has none; its cards always come). */
export async function applySafari(profileId: string, data: SafariExport, cookies = true, onFailed?: (kind: ImportKind) => void): Promise<ImportCounts> {
  const counts = emptyCounts();
  counts.bookmarks = importSafariBookmarks(profileId, data.bookmarks);
  const history = data.profiles.find((p) => !p.name)?.history ?? data.profiles[0]?.history ?? [];
  counts.history = importHistory(profileId, history);
  Object.assign(counts, await importNative(profileId, data.vaultToken, cookies ? ["cookies", "autofill"] : ["autofill"], onFailed));
  if (data.tabs.length) counts.tabs += importTabs(profileId, data.tabs, "Imported");
  counts.passwords = await importPasswords(profileId, data.credentials);
  return counts;
}

export function profileColorFor(hex: string | undefined): ProfileColor | undefined {
  const m = hex && /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return undefined;
  const v = parseInt(m[1]!, 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.08) return "neutral";
  let h = 0;
  if (max === r) h = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h *= 60;
  const hues: [ProfileColor, number][] = [
    ["red", 0],
    ["orange", 25],
    ["yellow", 45],
    ["green", 140],
    ["blue", 210],
    ["purple", 265],
    ["pink", 330],
    ["red", 360],
  ];
  return hues.reduce((best, c) => (Math.abs(c[1] - h) < Math.abs(best[1] - h) ? c : best))[0];
}
