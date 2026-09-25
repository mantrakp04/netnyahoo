import { launchEnvironment, readDocument, systemInfo, writeDocument } from "@netnyahoo/shell";
import { create } from "zustand";

/**
 * "What's new": after an update, the New Tab page shows a postcard for the new version's notes
 * (Dia's ReleaseNotesPostcard, 1.46+); opening it shows them as a full-page postcard. Fresh
 * installs don't get one (onboarding has its own welcome), and it goes away once opened or
 * dismissed, or after POSTCARD_SECONDS.
 */
export type ReleaseNotes = {
  version: string;
  date: string;
  title: string;
  summary: string;
  items: { title: string; body: string }[];
};

/** Newest first. */
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

/**
 * How long the postcard stays on the New Tab page after an update, unless opened or dismissed
 * (Dia's release-notes-postcard-duration-seconds default).
 */
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
  /** The full-page view, over one window's New Tab page. */
  page: { windowId: string; version: string } | null;
};

const useReleaseNotes = create<State>(() => ({ pending: null, page: null }));

/**
 * At launch, before the session is first saved (so a first launch can be told from an update):
 * notes the running version, and queues the postcard when it changed and has notes. Installs from
 * before this existed (a saved session, no record) count as updated. DEV builds only queue it with
 * NETNYAHOO_WHATS_NEW=1, so the many dev instances don't all show it.
 * Returns whether this launch is the first of a new version (never on a fresh install).
 */
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

/** The notes the postcard is for, if it's showing. */
export function usePendingReleaseNotes(): ReleaseNotes | null {
  const version = useReleaseNotes((s) => s.pending?.version);
  return version ? notesFor(version) : null;
}

/** The notes shown full-page over `windowId`'s New Tab page, if any. */
export function useReleaseNotesPage(windowId: string): ReleaseNotes | null {
  const version = useReleaseNotes((s) => (s.page?.windowId === windowId ? s.page.version : undefined));
  return version ? notesFor(version) : null;
}

/** Opens the notes full-page (which also retires the postcard). */
export function openReleaseNotes(windowId: string, version = useReleaseNotes.getState().pending?.version ?? systemInfo().appVersion) {
  if (!notesFor(version)) return;
  retireReleaseNotes();
  useReleaseNotes.setState({ page: { windowId, version } });
}

export const closeReleaseNotes = () => useReleaseNotes.setState({ page: null });

/** Opened or dismissed: the postcard doesn't come back for this version. */
export function retireReleaseNotes() {
  if (!useReleaseNotes.getState().pending) return;
  useReleaseNotes.setState({ pending: null });
  save({ lastVersion: readSaved()?.lastVersion ?? systemInfo().appVersion, pending: null });
}

/** Puts the postcard back for `version` (the running one by default). DEV tooling. */
export function queueReleaseNotes(version = systemInfo().appVersion) {
  const pending = notesFor(version) ? { version, since: Date.now() } : null;
  useReleaseNotes.setState({ pending });
  save({ lastVersion: systemInfo().appVersion, pending });
}

// DEV: tooling drives it through the dev harness (`globalThis.nnReleaseNotes`).
if (__DEV__) (globalThis as { nnReleaseNotes?: unknown }).nnReleaseNotes = { store: useReleaseNotes, queue: queueReleaseNotes, retire: retireReleaseNotes, open: openReleaseNotes };
