import { readDocument, writeDocument } from "@netnyahoo/shell";
import { create } from "zustand";
import type { CompletedItem, CompletionState, FolderStatus, LiveAccount, LiveFolder, LiveFolderKind, LiveItem, LiveSourceId } from "./types";

export type LiveConfig = {
  githubClientId: string;
  bitbucketUser: string;
  confluenceSite: string;
  confluenceEmail: string;
  googleClientId: string;
};

export type CalendarSettings = {
  alertLead: string;
  alertCondition: "always" | "activeOnly";
  showPreview: boolean;
  showTimeToNext: boolean;
  hiddenCalendarIds: string[];
  prompted: boolean;
};

export type MeetingGroup = {
  groupId: string;
  callTabId: string;
  occurrence: string | null;
  title: string;
  start: number | null;
  end: number | null;
  endedAt: number | null;
};

type LiveState = {
  folders: Record<string, LiveFolder>;
  folderOrder: string[];
  items: Record<string, LiveItem[]>;
  known: Record<string, string[]>;
  unread: Record<string, string[]>;
  completed: Record<string, CompletedItem[]>;
  completing: Record<string, string[]>;
  status: Record<string, FolderStatus>;
  expandedStacks: Record<string, boolean>;
  showAll: Record<string, boolean>;
  accounts: Partial<Record<LiveSourceId, LiveAccount>>;
  config: LiveConfig;
  calendar: CalendarSettings;
  meetingGroups: Record<string, MeetingGroup>;
  dismissedAlerts: string[];
};

export const DEFAULT_CONFIG: LiveConfig = { githubClientId: "", bitbucketUser: "", confluenceSite: "", confluenceEmail: "", googleClientId: "" };

export const DEFAULT_CALENDAR: CalendarSettings = {
  alertLead: "1",
  alertCondition: "always",
  showPreview: true,
  showTimeToNext: true,
  hiddenCalendarIds: [],
  prompted: false,
};

const DOC = "live.json";
const PERSISTED = ["folders", "folderOrder", "items", "known", "unread", "completed", "expandedStacks", "accounts", "config", "calendar", "meetingGroups", "dismissedAlerts"] as const;

function load(): Partial<LiveState> {
  try {
    const json = readDocument(DOC);
    return json ? (JSON.parse(json) as Partial<LiveState>) : {};
  } catch {
    return {};
  }
}

const saved = load();

export const useLive = create<LiveState>()(() => ({
  folders: saved.folders ?? {},
  folderOrder: saved.folderOrder ?? [],
  items: saved.items ?? {},
  known: saved.known ?? {},
  unread: saved.unread ?? {},
  completed: saved.completed ?? {},
  completing: {},
  status: {},
  expandedStacks: saved.expandedStacks ?? {},
  showAll: {},
  accounts: saved.accounts ?? {},
  config: { ...DEFAULT_CONFIG, ...saved.config },
  calendar: { ...DEFAULT_CALENDAR, ...saved.calendar },
  meetingGroups: saved.meetingGroups ?? {},
  dismissedAlerts: saved.dismissedAlerts ?? [],
}));

export const live = () => useLive.getState();
export const setLive = (patch: Partial<LiveState> | ((s: LiveState) => Partial<LiveState>)) => useLive.setState(patch);

let timer: ReturnType<typeof setTimeout> | undefined;
useLive.subscribe((s, prev) => {
  if (PERSISTED.every((k) => s[k] === prev[k])) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const s = live();
    try {
      writeDocument(DOC, JSON.stringify(Object.fromEntries(PERSISTED.map((k) => [k, s[k]]))));
    } catch (error) {
      console.warn("Couldn't save live folders", error);
    }
  }, 800);
});

let counter = 0;
const newId = () => `lf-${Date.now().toString(36)}-${(++counter).toString(36)}`;

export const FOLDER_DEFAULTS: Record<LiveFolderKind, { name: string; sources: LiveSourceId[] }> = {
  pullRequests: { name: "Pull Requests", sources: ["github"] },
  documents: { name: "Documents", sources: ["notion"] },
};

export function createFolder(profileId: string, kind: LiveFolderKind, sources?: LiveSourceId[]): string {
  const id = newId();
  const folder: LiveFolder = {
    id,
    profileId,
    kind,
    name: FOLDER_DEFAULTS[kind].name,
    icon: null,
    collapsed: false,
    sources: sources ?? FOLDER_DEFAULTS[kind].sources,
    filters: { authored: true, reviewRequests: true },
    createdAt: Date.now(),
  };
  setLive((s) => ({
    folders: { ...s.folders, [id]: folder },
    folderOrder: [...s.folderOrder, id],
    status: { ...s.status, [id]: { state: "initializing", lastFetch: null, error: null } },
  }));
  return id;
}

export function updateFolder(id: string, patch: Partial<Omit<LiveFolder, "id" | "profileId" | "kind">>) {
  setLive((s) => (s.folders[id] ? { folders: { ...s.folders, [id]: { ...s.folders[id]!, ...patch } } } : {}));
}

const without = <T>(record: Record<string, T>, key: string) => {
  const { [key]: _, ...rest } = record;
  return rest;
};

export function removeFolder(id: string) {
  setLive((s) => ({
    folders: without(s.folders, id),
    folderOrder: s.folderOrder.filter((f) => f !== id),
    items: without(s.items, id),
    known: without(s.known, id),
    unread: without(s.unread, id),
    completed: without(s.completed, id),
    completing: without(s.completing, id),
    status: without(s.status, id),
  }));
}

export function moveFolder(id: string, delta: -1 | 1) {
  setLive((s) => {
    const order = [...s.folderOrder];
    const i = order.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return {};
    [order[i], order[j]] = [order[j]!, order[i]!];
    return { folderOrder: order };
  });
}

const MAX_KNOWN = 600;
const MAX_COMPLETED = 20;

export function applyFetch(folderId: string, next: LiveItem[], gone: Record<string, CompletionState>, now = Date.now(), quiet: Set<string> = new Set()) {
  setLive((s) => {
    if (!s.folders[folderId]) return {};
    const known = new Set(s.known[folderId] ?? []);
    const first = known.size === 0 && !s.status[folderId]?.lastFetch;
    const fresh = next.filter((it) => !known.has(it.id)).map((it) => it.id);
    const unreadFresh = fresh.filter((id) => !quiet.has(id));
    const ids = new Set(next.map((it) => it.id));
    const prev = s.items[folderId] ?? [];
    const animating = new Set(s.completing[folderId] ?? []);
    const leaving = prev.filter((it) => !ids.has(it.id) && gone[it.id] && !animating.has(it.id));
    const merged = [...next];
    for (const it of prev) if (!ids.has(it.id) && (animating.has(it.id) || leaving.includes(it))) merged.splice(Math.min(prev.indexOf(it), merged.length), 0, it);
    const completed = [
      ...leaving.map((item) => ({ item, state: gone[item.id]!, at: now })),
      ...(s.completed[folderId] ?? []).filter((c) => !ids.has(c.item.id) && !leaving.some((l) => l.id === c.item.id)),
    ].slice(0, MAX_COMPLETED);
    const stillThere = new Set(merged.map((it) => it.id));
    return {
      items: { ...s.items, [folderId]: merged },
      known: { ...s.known, [folderId]: [...known, ...fresh].slice(-MAX_KNOWN) },
      unread: { ...s.unread, [folderId]: first ? [] : [...new Set([...(s.unread[folderId] ?? []), ...unreadFresh])].filter((id) => stillThere.has(id)) },
      completed: leaving.length || (s.completed[folderId] ?? []).length !== completed.length ? { ...s.completed, [folderId]: completed } : s.completed,
      completing: leaving.length ? { ...s.completing, [folderId]: [...(s.completing[folderId] ?? []), ...leaving.map((l) => l.id)] } : s.completing,
      status: { ...s.status, [folderId]: { state: "idle", lastFetch: now, error: null } },
    };
  });
}

export function finishCompleting(folderId: string, ids: string[]) {
  setLive((s) => ({
    items: { ...s.items, [folderId]: (s.items[folderId] ?? []).filter((it) => !ids.includes(it.id)) },
    completing: { ...s.completing, [folderId]: (s.completing[folderId] ?? []).filter((id) => !ids.includes(id)) },
    unread: { ...s.unread, [folderId]: (s.unread[folderId] ?? []).filter((id) => !ids.includes(id)) },
  }));
}

export function setStatus(folderId: string, status: Partial<FolderStatus>) {
  setLive((s) => {
    const current = s.status[folderId] ?? { state: "idle" as const, lastFetch: null, error: null };
    return { status: { ...s.status, [folderId]: { ...current, ...status } } };
  });
}

export function markRead(folderId: string, itemIds?: string[]) {
  setLive((s) => {
    const unread = s.unread[folderId] ?? [];
    const next = itemIds ? unread.filter((id) => !itemIds.includes(id)) : [];
    return next.length === unread.length ? {} : { unread: { ...s.unread, [folderId]: next } };
  });
}

export function setAccount(source: LiveSourceId, account: LiveAccount | null) {
  setLive((s) => {
    const accounts = { ...s.accounts };
    if (account) accounts[source] = account;
    else delete accounts[source];
    return { accounts };
  });
}

export const updateConfig = (patch: Partial<LiveConfig>) => setLive((s) => ({ config: { ...s.config, ...patch } }));
export const updateCalendarSettings = (patch: Partial<CalendarSettings>) => setLive((s) => ({ calendar: { ...s.calendar, ...patch } }));

export function dismissAlert(occurrence: string) {
  setLive((s) => (s.dismissedAlerts.includes(occurrence) ? {} : { dismissedAlerts: [...s.dismissedAlerts, occurrence].slice(-200) }));
}

export function setMeetingGroup(group: MeetingGroup | null, groupId?: string) {
  setLive((s) => {
    if (group) return { meetingGroups: { ...s.meetingGroups, [group.groupId]: group } };
    return groupId && s.meetingGroups[groupId] ? { meetingGroups: without(s.meetingGroups, groupId) } : {};
  });
}

export const profileFolders = (s: LiveState, profileId: string) => s.folderOrder.filter((id) => s.folders[id]?.profileId === profileId);
