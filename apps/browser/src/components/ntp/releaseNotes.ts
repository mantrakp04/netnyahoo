import { launchEnvironment, readDocument, systemInfo, writeDocument } from "@netnyahoo/shell";
import { create } from "zustand";

export type ReleaseNotes = {
  version: string;
  date: string;
  title: string;
  summary: string;
  items: { title: string; body: string }[];
};

export const RELEASE_NOTES: ReleaseNotes[] = [
  {
    version: "1.0",
    date: "September 2026",
    title: "Hello, Netnyahoo",
    summary: "The first release: a calm, fast browser that keeps your tabs, your pages and your focus in one place.",
    items: [
      { title: "A command bar for everything", body: "Search, type an address or jump to an open tab from the New Tab page, or from any page with ⌘L." },
      { title: "Split view", body: "Drag a tab onto the page to see two or three side by side, stacked or in columns." },
      { title: "Tab groups and pinned tabs", body: "Group related tabs, pin the ones you live in, and let Clean Up Tabs tidy the rest." },
      { title: "Picture in Picture that stays out of the way", body: "Stash a video at the edge of the screen; click its site name to jump back to the tab." },
      { title: "Bring everything with you", body: "Import bookmarks, history, passwords and open tabs from Chrome, Safari, Arc and more." },
      { title: "Profiles with their own colour", body: "Keep work and personal apart, each with its own theme on the New Tab page." },
    ],
  },
];

export const POSTCARD_SECONDS = 86_400;

const DOC = "release-notes.json";
type Saved = { version: 1; lastVersion: string; pending: { version: string; since: number } | null };

function readSaved(): Saved | null {
  try {
    const json = readDocument(DOC);
    return json ? (JSON.parse(json) as Saved) : null;
  } catch {
    return null;
  }
}

function save(saved: Omit<Saved, "version">) {
  try {
    writeDocument(DOC, JSON.stringify({ version: 1, ...saved } satisfies Saved));
  } catch (error) {
    console.warn("Couldn't save release notes state", error);
  }
}

export const notesFor = (version: string) => RELEASE_NOTES.find((n) => n.version === version) ?? null;

type State = {
  pending: Saved["pending"];
  page: { windowId: string; version: string } | null;
};

const useReleaseNotes = create<State>(() => ({ pending: null, page: null }));

export function trackAppVersion(): boolean {
  const version = systemInfo().appVersion;
  if (!version) return false;
  const saved = readSaved();
  const updated = saved ? saved.lastVersion !== version : !!readDocument("session.json");
  let pending = saved?.pending ?? null;
  if (__DEV__) {
    if (launchEnvironment("NETNYAHOO_WHATS_NEW") === "1") pending = { version, since: Date.now() };
  } else if (updated) {
    pending = notesFor(version) ? { version, since: Date.now() } : null;
  }
  if (pending && Date.now() - pending.since > POSTCARD_SECONDS * 1000) pending = null;
  save({ lastVersion: version, pending });
  useReleaseNotes.setState({ pending });
  return updated;
}

export function usePendingReleaseNotes(): ReleaseNotes | null {
  const version = useReleaseNotes((s) => s.pending?.version);
  return version ? notesFor(version) : null;
}

export function useReleaseNotesPage(windowId: string): ReleaseNotes | null {
  const version = useReleaseNotes((s) => (s.page?.windowId === windowId ? s.page.version : undefined));
  return version ? notesFor(version) : null;
}

export function openReleaseNotes(windowId: string, version = useReleaseNotes.getState().pending?.version ?? systemInfo().appVersion) {
  if (!notesFor(version)) return;
  retireReleaseNotes();
  useReleaseNotes.setState({ page: { windowId, version } });
}

export const closeReleaseNotes = () => useReleaseNotes.setState({ page: null });

export function retireReleaseNotes() {
  if (!useReleaseNotes.getState().pending) return;
  useReleaseNotes.setState({ pending: null });
  save({ lastVersion: readSaved()?.lastVersion ?? systemInfo().appVersion, pending: null });
}

export function queueReleaseNotes(version = systemInfo().appVersion) {
  const pending = notesFor(version) ? { version, since: Date.now() } : null;
  useReleaseNotes.setState({ pending });
  save({ lastVersion: systemInfo().appVersion, pending });
}

if (__DEV__) (globalThis as { nnReleaseNotes?: unknown }).nnReleaseNotes = { store: useReleaseNotes, queue: queueReleaseNotes, retire: retireReleaseNotes, open: openReleaseNotes };
